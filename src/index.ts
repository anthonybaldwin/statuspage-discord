import {
  APIEmbedField,
  AutocompleteInteraction,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  DiscordAPIError,
  EmbedBuilder,
  GatewayIntentBits,
  Message,
  MessageFlags,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  TextChannel,
  ThreadAutoArchiveDuration,
  ThreadChannel,
} from "discord.js";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

const booleanFromEnv = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value, context) => {
    if (["true", "1", "yes", "on"].includes(value)) {
      return true;
    }

    if (["false", "0", "no", "off"].includes(value)) {
      return false;
    }

    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Expected a boolean-like value, received "${value}"`,
    });
    return z.NEVER;
  });

const monitorSchema = z.object({
  id: z.string().min(1),
  channelId: z.string().min(1),
  baseUrl: z.string().url(),
  label: z.string().min(1).optional(),
});

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_APPLICATION_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1).optional(),
  DISCORD_CHANNEL_ID: z.string().min(1).optional(),
  STATUSPAGE_BASE_URL: z.string().url().optional(),
  STATUSPAGE_MONITORS_JSON: z.string().optional(),
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  POST_EXISTING_UPDATES_ON_START: booleanFromEnv.default("false"),
  ENABLE_REPLAY_COMMAND: booleanFromEnv.default("true"),
  ENABLE_CLEAN_COMMAND: booleanFromEnv.default("true"),
  ENABLE_STATUS_COMMAND: booleanFromEnv.default("true"),
  ENABLE_TEST_COMMAND: booleanFromEnv.default("true"),
  ENABLE_MONITOR_COMMAND: booleanFromEnv.default("true"),
  ENABLE_CLEANUP_COMMAND: booleanFromEnv.default("true"),
});

type MonitorConfig = z.infer<typeof monitorSchema>;

type RuntimeMonitorEntry = MonitorConfig & {
  addedBy: string;
  addedAt: string;
};

type RuntimeMonitorFile = {
  monitors: RuntimeMonitorEntry[];
};

function loadMonitors(env: z.infer<typeof envSchema>): MonitorConfig[] {
  if (env.STATUSPAGE_MONITORS_JSON) {
    const parsed = JSON.parse(env.STATUSPAGE_MONITORS_JSON) as unknown;
    return z.array(monitorSchema).parse(parsed);
  }

  if (env.DISCORD_CHANNEL_ID && env.STATUSPAGE_BASE_URL) {
    return [
      {
        id: "default",
        channelId: env.DISCORD_CHANNEL_ID,
        baseUrl: env.STATUSPAGE_BASE_URL,
      },
    ];
  }

  throw new Error(
    "Configure either STATUSPAGE_MONITORS_JSON or both DISCORD_CHANNEL_ID and STATUSPAGE_BASE_URL.",
  );
}

const env = envSchema.parse(process.env);
const envMonitors = loadMonitors(env);
const envMonitorIds = new Set(envMonitors.map((m) => m.id));
let monitors: MonitorConfig[] = [...envMonitors];
const statePath = resolve("data", "state.json");
const runtimeMonitorsPath = resolve("data", "monitors.json");
const monitorIcons = new Map<string, string>();

// Simple promise-chain lock for read-modify-write safety on monitors.json.
let monitorLockChain = Promise.resolve();
function withMonitorLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = monitorLockChain.then(fn, fn);
  monitorLockChain = next.then(() => {}, () => {});
  return next;
}

async function readRuntimeMonitors(): Promise<RuntimeMonitorEntry[]> {
  try {
    const raw = await readFile(runtimeMonitorsPath, "utf8");
    const parsed = JSON.parse(raw) as RuntimeMonitorFile;
    return parsed.monitors ?? [];
  } catch {
    return [];
  }
}

async function writeRuntimeMonitors(entries: RuntimeMonitorEntry[]) {
  await mkdir(dirname(runtimeMonitorsPath), { recursive: true });
  const data: RuntimeMonitorFile = { monitors: entries };
  await writeFile(runtimeMonitorsPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function rebuildMonitors(runtime: RuntimeMonitorEntry[]) {
  // Env monitors take precedence — runtime supplements.
  const merged: MonitorConfig[] = [...envMonitors];
  for (const entry of runtime) {
    if (!envMonitorIds.has(entry.id)) {
      merged.push(entry);
    }
  }
  monitors = merged;
}

async function fetchMonitorIcon(monitor: MonitorConfig): Promise<string | undefined> {
  try {
    const response = await fetch(monitor.baseUrl);
    if (!response.ok) return undefined;
    const html = await response.text();
    // Look for <link rel="shortcut icon" href="..."> (standard Statuspage favicon).
    const match = html.match(/<link[^>]+rel=["']shortcut icon["'][^>]+href=["']([^"']+)["']/i);
    if (match?.[1]) {
      const href = match[1];
      return href.startsWith("//") ? `https:${href}` : href;
    }
  } catch {
    // Silently fall back to no icon.
  }
  return undefined;
}

async function cacheMonitorIcons() {
  await Promise.all(
    monitors.map(async (monitor) => {
      const icon = await fetchMonitorIcon(monitor);
      if (icon) {
        monitorIcons.set(monitor.id, icon);
        console.log(`Cached icon for "${monitor.id}": ${icon}`);
      }
    }),
  );
}

type PageStatus = {
  indicator: string;
  description: string;
};

type IncidentUpdate = {
  id: string;
  status: string;
  body: string;
  created_at: string;
  updated_at?: string;
};

type Incident = {
  id: string;
  name: string;
  status: string;
  impact: string;
  shortlink?: string;
  created_at: string;
  updated_at?: string;
  resolved_at?: string | null;
  incident_updates: IncidentUpdate[];
};

type Summary = {
  page: {
    id: string;
    name: string;
    url: string;
    updated_at?: string;
  };
  status: PageStatus;
  incidents: Incident[];
};

type IncidentsResponse = {
  page: Summary["page"];
  incidents: Incident[];
};

type MonitorState = {
  postedUpdateIds: string[];
  lastPostedAt?: string;
  /** Running set of incident IDs the bot considers "open". Used to reliably detect ghost closures. */
  openIncidentIds: string[];
  incidents: Record<
    string,
    {
      parentMessageId: string;
      threadId: string;
      postedUpdateIds: string[];
      updateMessageIds: Record<string, string>;
      resolvedAt?: string;
    }
  >;
};

type BotState = {
  monitors: Record<string, MonitorState>;
};

const defaultMonitorState = (): MonitorState => ({
  postedUpdateIds: [],
  openIncidentIds: [],
  incidents: {},
});

const defaultState: BotState = {
  monitors: {},
};

function buildCommands() {
  const built: Array<{ toJSON(): unknown }> = [];

  if (env.ENABLE_STATUS_COMMAND) {
    built.push(
      new SlashCommandBuilder()
        .setName("status")
        .setDescription("Get the current status for one configured Statuspage.")
        .addStringOption((option) =>
          option
            .setName("target")
            .setDescription("Optional monitor id when more than one status page is configured.")
            .setRequired(false)
            .setAutocomplete(true),
        ),
    );
  }

  if (env.ENABLE_TEST_COMMAND) {
    built.push(
      new SlashCommandBuilder()
        .setName("testpost")
        .setDescription("Post a preview of the current status without marking anything as sent.")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption((option) =>
          option
            .setName("target")
            .setDescription("Optional monitor id when more than one status page is configured.")
            .setRequired(false)
            .setAutocomplete(true),
        ),
    );
  }

  if (env.ENABLE_REPLAY_COMMAND) {
    built.push(
      new SlashCommandBuilder()
        .setName("replay")
        .setDescription("Replay active incident timelines into their configured threads for testing.")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption((option) =>
          option
            .setName("target")
            .setDescription("Optional monitor id when more than one status page is configured.")
            .setRequired(false)
            .setAutocomplete(true),
        ),
    );
  }

  if (env.ENABLE_CLEAN_COMMAND) {
    built.push(
      new SlashCommandBuilder()
        .setName("clean")
        .setDescription("Delete recent bot-authored messages in the current channel.")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption((option) =>
          option
            .setName("target")
            .setDescription("Optional monitor id. Omit to clean all monitors in this channel.")
            .setRequired(false)
            .setAutocomplete(true),
        )
        .addIntegerOption((option) =>
          option
            .setName("limit")
            .setDescription("How many recent messages to inspect. Defaults to 100.")
            .setMinValue(1)
            .setMaxValue(100)
            .setRequired(false),
        ),
    );
  }

  if (env.ENABLE_CLEANUP_COMMAND) {
    built.push(
      new SlashCommandBuilder()
        .setName("cleanup")
        .setDescription("Find and ghost dangling incident threads no longer in the status page API.")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addStringOption((option) =>
          option
            .setName("target")
            .setDescription("Optional monitor id. Omit to clean all monitors.")
            .setRequired(false)
            .setAutocomplete(true),
        ),
    );
  }

  if (env.ENABLE_MONITOR_COMMAND) {
    built.push(
      new SlashCommandBuilder()
        .setName("monitor")
        .setDescription("Manage runtime Statuspage monitors.")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((sub) =>
          sub
            .setName("add")
            .setDescription("Add a new Statuspage monitor.")
            .addStringOption((opt) =>
              opt.setName("url").setDescription("Public Statuspage URL (e.g. https://status.atlassian.com)").setRequired(true),
            )
            .addChannelOption((opt) =>
              opt
                .setName("channel")
                .setDescription("Channel to post updates in. Defaults to the current channel.")
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false),
            )
            .addStringOption((opt) =>
              opt.setName("label").setDescription("Display name for the monitor.").setRequired(false),
            )
            .addStringOption((opt) =>
              opt.setName("id").setDescription("Unique ID for the monitor. Auto-derived from page name if omitted.").setRequired(false),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName("remove")
            .setDescription("Remove a runtime monitor.")
            .addStringOption((opt) =>
              opt.setName("id").setDescription("Monitor ID to remove.").setRequired(true).setAutocomplete(true),
            ),
        )
        .addSubcommand((sub) =>
          sub.setName("list").setDescription("List all configured monitors."),
        ),
    );
  }

  return built.map((command) => command.toJSON());
}

let commands = buildCommands();

async function ensureStateFile() {
  await mkdir(dirname(statePath), { recursive: true });

  try {
    await readFile(statePath, "utf8");
  } catch {
    await writeState(defaultState);
  }
}

function getMonitorState(state: BotState, monitorId: string): MonitorState {
  if (!state.monitors[monitorId]) {
    state.monitors[monitorId] = defaultMonitorState();
  }

  const ms = state.monitors[monitorId];
  ms.openIncidentIds ??= [];

  for (const incidentState of Object.values(ms.incidents)) {
    incidentState.postedUpdateIds ??= [];
    incidentState.updateMessageIds ??= {};
  }

  return ms;
}

async function readState(): Promise<BotState> {
  await ensureStateFile();
  const raw = await readFile(statePath, "utf8");
  const parsed = JSON.parse(raw) as Partial<BotState>;
  if (parsed.monitors) {
    const normalized: BotState = {
      monitors: parsed.monitors,
    };

    for (const monitorId of Object.keys(normalized.monitors)) {
      getMonitorState(normalized, monitorId);
    }

    return normalized;
  }

  // Migrate legacy single-monitor state into the default monitor bucket.
  const legacyMonitor = defaultMonitorState();
  legacyMonitor.postedUpdateIds = (parsed as Partial<MonitorState>).postedUpdateIds ?? [];
  legacyMonitor.openIncidentIds = (parsed as Partial<MonitorState>).openIncidentIds ?? [];
  legacyMonitor.lastPostedAt = (parsed as Partial<MonitorState>).lastPostedAt;
  legacyMonitor.incidents = (parsed as Partial<MonitorState>).incidents ?? {};

  return {
    monitors: {
      default: legacyMonitor,
    },
  };
}

async function writeState(state: BotState) {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function fetchJson<T>(monitor: MonitorConfig, path: string): Promise<T> {
  const response = await fetch(`${monitor.baseUrl}/api/v2${path}`, {
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Statuspage request failed (${response.status}): ${body}`);
  }

  return (await response.json()) as T;
}

async function fetchSummary(monitor: MonitorConfig): Promise<Summary> {
  return fetchJson<Summary>(monitor, "/summary.json");
}

async function fetchIncidents(monitor: MonitorConfig): Promise<Incident[]> {
  const response = await fetchJson<IncidentsResponse>(monitor, "/incidents.json");
  return response.incidents;
}

function formatTimestamp(value?: string | null) {
  if (!value) {
    return "unknown";
  }

  return `<t:${Math.floor(new Date(value).getTime() / 1000)}:f>`;
}

function statusColor(status: string) {
  switch (status.toLowerCase()) {
    case "resolved":
    case "operational":
    case "none":
      return 0x2fb344;
    case "identified":
      return 0xf2c94c;
    case "monitoring":
      return 0x6aa9ff;
    case "investigating":
    case "update":
    case "minor":
    case "degraded_performance":
      return 0xf2994a;
    case "partial_outage":
    case "major":
    case "critical":
    case "major_outage":
      return 0xeb5757;
    case "under_maintenance":
      return 0x8e8e93;
    case "maintenance":
      return 0x7f8c8d;
    default:
      return 0x5865f2;
  }
}

function impactColor(impact: string, status?: string) {
  if (status?.toLowerCase() === "resolved") {
    return 0x2fb344;
  }

  switch (impact.toLowerCase()) {
    case "none":
      return 0x6aa9ff;
    case "minor":
      return 0xf2c94c;
    case "major":
      return 0xf2994a;
    case "critical":
      return 0xeb5757;
    default:
      return 0x5865f2;
  }
}

const MISSING_INCIDENT_COLOR = 0x95a5a6;

function incidentStateLabel(status: string) {
  switch (status.toLowerCase()) {
    case "investigating":
      return "Investigating";
    case "identified":
      return "Identified";
    case "monitoring":
      return "Monitoring";
    case "resolved":
      return "Resolved";
    case "update":
      return "Update";
    default:
      return titleCase(status);
  }
}

function statusLabel(indicator: string) {
  switch (indicator.toLowerCase()) {
    case "none":
      return "Operational";
    case "minor":
      return "Minor Issues";
    case "major":
      return "Major Issues";
    case "critical":
      return "Critical";
    case "maintenance":
    case "under_maintenance":
      return "Under Maintenance";
    default:
      return titleCase(indicator);
  }
}

function titleCase(value: string) {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}...`;
}

function monitorDisplayName(monitor: MonitorConfig, pageName?: string) {
  return monitor.label ?? pageName ?? monitor.id;
}

function renderUpdateEmbed(
  monitor: MonitorConfig,
  incident: Incident,
  update: IncidentUpdate,
  prefix?: string,
) {
  const embed = new EmbedBuilder()
    .setColor(impactColor(incident.impact, incident.status))
    .setAuthor({
      name: `${monitorDisplayName(monitor)} Incident Update`,
      iconURL: monitorIcons.get(monitor.id),
    })
    .setTitle(incident.name)
    .setDescription(truncate(update.body, 4000))
    .addFields(
      { name: "Status", value: incidentStateLabel(update.status), inline: true },
      { name: "Impact", value: titleCase(incident.impact), inline: true },
      { name: "Updated", value: formatTimestamp(update.created_at), inline: true },
    )
    .setFooter({
      text: update.id,
    })
    .setTimestamp(new Date(update.created_at));

  if (incident.shortlink) {
    embed.setURL(incident.shortlink);
  }

  return embed;
}

function renderParentEmbed(monitor: MonitorConfig, incident: Incident) {
  const latest = [...incident.incident_updates].sort(byNewestUpdate)[0];
  const description = incident.resolved_at
    ? "This incident has been resolved. Open the thread for the full timeline."
    : "Open the thread for the full timeline and follow-up updates.";
  const embed = new EmbedBuilder()
    .setColor(impactColor(incident.impact, incident.status))
    .setAuthor({
      name: `${monitorDisplayName(monitor)} Incident`,
      iconURL: monitorIcons.get(monitor.id),
    })
    .setTitle(incident.name)
    .setDescription(description)
    .addFields(
      { name: "Status", value: titleCase(incident.status), inline: true },
      { name: "Impact", value: titleCase(incident.impact), inline: true },
      { name: "Created", value: formatTimestamp(incident.created_at), inline: true },
      {
        name: "Latest Update",
        value: latest ? formatTimestamp(latest.created_at) : "unknown",
        inline: true,
      },
    )
    .setFooter({
      text: incident.resolved_at ? "Resolved" : "Active",
    })
    .setTimestamp(new Date(latest?.created_at ?? incident.created_at));

  if (incident.shortlink) {
    embed.setURL(incident.shortlink);
  }

  return embed;
}

function renderMissingParentEmbed(monitor: MonitorConfig, incidentName: string) {
  return new EmbedBuilder()
    .setColor(MISSING_INCIDENT_COLOR)
    .setAuthor({
      name: `${monitorDisplayName(monitor)} Incident`,
      iconURL: monitorIcons.get(monitor.id),
    })
    .setTitle(`~~${incidentName}~~`)
    .setDescription("~~This incident is no longer available on the status page.~~")
    .addFields(
      { name: "Status", value: "~~Removed~~", inline: true },
    )
    .setFooter({ text: "Removed" })
    .setTimestamp(new Date());
}

function renderDeletedUpdateEmbed(originalEmbed: EmbedBuilder) {
  const data = originalEmbed.toJSON();
  const embed = new EmbedBuilder()
    .setColor(MISSING_INCIDENT_COLOR)
    .setTimestamp(data.timestamp ? new Date(data.timestamp) : new Date());

  if (data.author) {
    embed.setAuthor({
      name: data.author.name,
      iconURL: data.author.icon_url,
    });
  }

  if (data.title) {
    embed.setTitle(`~~${data.title.replace(/~~/g, "")}~~`);
  }

  if (data.description) {
    embed.setDescription(`~~${data.description.replace(/~~/g, "").slice(0, 3996)}~~`);
  }

  if (data.fields) {
    embed.addFields(
      data.fields.map((field) => ({
        name: field.name,
        value: `~~${field.value.replace(/~~/g, "")}~~`,
        inline: field.inline,
      })),
    );
  }

  if (data.footer) {
    embed.setFooter({ text: data.footer.text });
  }

  if (data.url) {
    embed.setURL(data.url);
  }

  return embed;
}

function summaryFields(summary: Summary): APIEmbedField[] {
  const active = summary.incidents.filter((incident) => !incident.resolved_at);

  if (active.length === 0) {
    return [
      {
        name: "Active Incidents",
        value: "No active incidents.",
      },
    ];
  }

  return active.slice(0, 10).map((incident) => {
    const latest = [...incident.incident_updates].sort(byNewestUpdate)[0];
    const parts = [
      `Status: ${titleCase(incident.status)}`,
      `Impact: ${titleCase(incident.impact)}`,
      `Created: ${formatTimestamp(incident.created_at)}`,
    ];

    if (latest) {
      parts.push(`Latest: ${formatTimestamp(latest.created_at)}`);
    }

    if (incident.shortlink) {
      parts.push(`[Open incident](${incident.shortlink})`);
    }

    return {
      name: incident.name,
      value: truncate(parts.join("\n"), 1024),
    };
  });
}

function renderStatusEmbed(monitor: MonitorConfig, summary: Summary, prefix?: string) {
  return new EmbedBuilder()
    .setColor(statusColor(summary.status.indicator))
    .setAuthor({
      name: prefix
        ? `${prefix} • ${monitorDisplayName(monitor, summary.page.name)}`
        : monitorDisplayName(monitor, summary.page.name),
      url: summary.page.url,
      iconURL: monitorIcons.get(monitor.id),
    })
    .setTitle(titleCase(summary.status.description))
    .setDescription(`Overall status: **${statusLabel(summary.status.indicator)}**`)
    .addFields(summaryFields(summary))
    .setFooter({
      text: summary.page.url,
    })
    .setTimestamp(summary.page.updated_at ? new Date(summary.page.updated_at) : new Date());
}

function byNewestUpdate(a: IncidentUpdate, b: IncidentUpdate) {
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

async function getReplayTargets(monitor: MonitorConfig) {
  const [summary, incidents] = await Promise.all([fetchSummary(monitor), fetchIncidents(monitor)]);
  const incidentById = new Map(incidents.map((incident) => [incident.id, incident]));
  const candidates = incidents
    .flatMap((incident) =>
      incident.incident_updates.map((update) => ({
        incident,
        update,
      })),
    )
    .sort((left, right) => byNewestUpdate(left.update, right.update));

  if (candidates.length === 0) {
    throw new Error("No incident updates are available to replay.");
  }

  const activeIncidents = summary.incidents
    .map((summaryIncident) => incidentById.get(summaryIncident.id) ?? summaryIncident)
    .map((incident) => ({
      incident,
      updates: [...incident.incident_updates].sort(
        (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
      ),
    }))
    .filter((candidate) => candidate.updates.length > 0)
    .sort((left, right) => new Date(left.incident.created_at).getTime() - new Date(right.incident.created_at).getTime());

  if (activeIncidents.length === 0) {
    throw new Error("No active incidents to replay.");
  }

  return activeIncidents;
}

async function replayIncidentTimeline(
  channel: TextChannel,
  monitorState: MonitorState,
  monitor: MonitorConfig,
  incident: Incident,
  updates: IncidentUpdate[],
) {
  const { parentMessage, thread } = await ensureIncidentThread(channel, monitorState, monitor, incident);
  await syncIncidentParentMessage(channel, monitorState, monitor, incident, parentMessage);
  const incidentState = monitorState.incidents[incident.id];
  if (!incidentState) {
    throw new Error(`Incident state for ${incident.id} was not initialized.`);
  }
  incidentState.resolvedAt = incident.resolved_at ?? undefined;

  if (thread.archived) {
    await thread.setArchived(false, "Replay requested");
  }

  for (const update of updates) {
    const message = await thread.send({
      embeds: [renderUpdateEmbed(monitor, incident, update, "Replay")],
    });
    if (!incidentState.postedUpdateIds.includes(update.id)) {
      incidentState.postedUpdateIds.push(update.id);
    }
    incidentState.updateMessageIds[update.id] = message.id;
  }

  incidentState.postedUpdateIds = incidentState.postedUpdateIds.slice(-500);
  if (incident.resolved_at && !thread.archived) {
    await thread.setArchived(true, "Incident resolved");
  }
  return thread;
}

async function hasLiveIncidentMessages(channel: TextChannel, monitorState: MonitorState, incident: Incident) {
  const mapping = monitorState.incidents[incident.id];
  if (!mapping) {
    return false;
  }

  try {
    const [parentMessage, fetchedThread] = await Promise.all([
      channel.messages.fetch(mapping.parentMessageId),
      channel.client.channels.fetch(mapping.threadId),
    ]);

    if (!parentMessage || !fetchedThread?.isThread()) {
      delete monitorState.incidents[incident.id];
      return false;
    }

    const threadMessages = await fetchedThread.messages.fetch({ limit: 10 });
    return threadMessages.size > 0;
  } catch (error) {
    if (
      error instanceof DiscordAPIError &&
      (error.code === 10003 || error.code === 10008 || error.code === 50001)
    ) {
      delete monitorState.incidents[incident.id];
      return false;
    }

    throw error;
  }
}

async function getMissingIncidentUpdates(
  thread: ThreadChannel,
  incidentState: MonitorState["incidents"][string],
  updates: IncidentUpdate[],
) {
  const missing: IncidentUpdate[] = [];

  for (const update of updates) {
    const messageId = incidentState.updateMessageIds[update.id];
    if (!messageId) {
      missing.push(update);
      continue;
    }

    try {
      await thread.messages.fetch(messageId);
    } catch (error) {
      if (
        error instanceof DiscordAPIError &&
        (error.code === 10008 || error.code === 10003 || error.code === 50001)
      ) {
        delete incidentState.updateMessageIds[update.id];
        incidentState.postedUpdateIds = incidentState.postedUpdateIds.filter((postedId) => postedId !== update.id);
        missing.push(update);
        continue;
      }

      throw error;
    }
  }

  return missing;
}

function extractUpdateIdFromMessage(message: Message) {
  const footerText = message.embeds[0]?.footer?.text;
  if (!footerText) {
    return undefined;
  }

  return footerText.trim() || undefined;
}

async function getPresentThreadUpdateIds(thread: ThreadChannel, botUserId: string) {
  const present = new Set<string>();
  let before: string | undefined;

  while (true) {
    const batch = await thread.messages.fetch({ limit: 100, before });
    if (batch.size === 0) {
      break;
    }

    for (const message of batch.values()) {
      if (message.author.id !== botUserId) {
        continue;
      }

      const updateId = extractUpdateIdFromMessage(message);
      if (updateId) {
        present.add(updateId);
      }
    }

    if (batch.size < 100) {
      break;
    }

    before = batch.last()?.id;
  }

  return present;
}

async function getReplaySummaryText(
  replayTargets: Array<{ incident: Incident; updates: IncidentUpdate[] }>,
) {
  const replayedCount = replayTargets.reduce((total, target) => total + target.updates.length, 0);
  const incidentNames = replayTargets.map((target) => `\`${target.incident.name}\``);

  if (replayTargets.length === 1) {
    return `Replayed ${replayedCount} update${replayedCount === 1 ? "" : "s"} for ${incidentNames[0]}.`;
  }

  return `Replayed ${replayedCount} updates across ${replayTargets.length} incidents: ${incidentNames.join(", ")}.`;
}

function getReplaySkippedText(skippedIncidents: Incident[]) {
  if (skippedIncidents.length === 0) {
    return "";
  }

  const incidentNames = skippedIncidents.map((incident) => `\`${incident.name}\``).join(", ");
  return `Skipped incidents that already have live thread messages: ${incidentNames}.`;
}

async function handleAutocomplete(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused(true);
  const query = focused.value.toLowerCase();

  if (interaction.commandName === "monitor" && focused.name === "id") {
    // Only show runtime monitors for /monitor remove
    const runtimeEntries = await readRuntimeMonitors();
    const filtered = runtimeEntries
      .filter((entry) => entry.id.toLowerCase().includes(query) || (entry.label?.toLowerCase().includes(query) ?? false))
      .slice(0, 25)
      .map((entry) => ({ name: entry.label ? `${entry.id} (${entry.label})` : entry.id, value: entry.id }));
    await interaction.respond(filtered);
    return;
  }

  // For target option on /status, /testpost, /replay — show all monitors
  if (focused.name === "target") {
    const filtered = monitors
      .filter((m) => m.id.toLowerCase().includes(query) || (m.label?.toLowerCase().includes(query) ?? false))
      .slice(0, 25)
      .map((m) => ({ name: m.label ? `${m.id} (${m.label})` : m.id, value: m.id }));
    await interaction.respond(filtered);
  }
}

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);
  const route = env.DISCORD_GUILD_ID
    ? Routes.applicationGuildCommands(env.DISCORD_APPLICATION_ID, env.DISCORD_GUILD_ID)
    : Routes.applicationCommands(env.DISCORD_APPLICATION_ID);

  await rest.put(route, { body: commands });
}

async function getTargetChannel(client: Client, monitor: MonitorConfig) {
  const channel = await client.channels.fetch(monitor.channelId);
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error(`Configured channel ${monitor.channelId} for monitor "${monitor.id}" must point to a text channel.`);
  }

  return channel as TextChannel;
}

function resolveMonitors(interaction: ChatInputCommandInteraction): MonitorConfig[] {
  const requested = interaction.options.getString("target") ?? undefined;

  if (requested) {
    const match = monitors.find((monitor) => monitor.id === requested);
    if (!match) {
      throw new Error(`Unknown target "${requested}". Configured targets: ${monitors.map((monitor) => monitor.id).join(", ")}`);
    }
    return [match];
  }

  if (monitors.length === 1) {
    return [monitors[0]];
  }

  const channelMatches = monitors.filter((monitor) => monitor.channelId === interaction.channelId);
  if (channelMatches.length > 0) {
    return channelMatches;
  }

  throw new Error(`Multiple monitors are configured. Pass a target: ${monitors.map((monitor) => monitor.id).join(", ")}`);
}

async function assertMonitorChannelAccess(
  interaction: ChatInputCommandInteraction,
  monitor: MonitorConfig,
  state: BotState,
) {
  if (interaction.channelId === monitor.channelId) {
    return;
  }

  const monitorState = getMonitorState(state, monitor.id);
  const allowedThreadIds = new Set(
    Object.values(monitorState.incidents).map((incidentMapping) => incidentMapping.threadId),
  );

  if (interaction.channelId && allowedThreadIds.has(interaction.channelId)) {
    return;
  }

  throw new Error(`This command can only be used in <#${monitor.channelId}> or its incident threads.`);
}


async function ensureIncidentThread(
  channel: TextChannel,
  monitorState: MonitorState,
  monitor: MonitorConfig,
  incident: Incident,
): Promise<{ parentMessage: Message; thread: ThreadChannel }> {
  const existing = monitorState.incidents[incident.id];

  if (existing) {
    try {
      const [parentMessage, fetchedThread] = await Promise.all([
        channel.messages.fetch(existing.parentMessageId),
        channel.client.channels.fetch(existing.threadId),
      ]);

      if (!fetchedThread?.isThread()) {
        throw new Error(`Stored thread ${existing.threadId} for incident ${incident.id} is missing.`);
      }

      return {
        parentMessage,
        thread: fetchedThread,
      };
    } catch (error) {
      // Self-heal after manual cleanup or deleted threads/messages.
      if (
        error instanceof DiscordAPIError &&
        (error.code === 10003 || error.code === 10008 || error.code === 50001)
      ) {
        delete monitorState.incidents[incident.id];
      } else {
        throw error;
      }
    }
  }

  const parentMessage = await channel.send({
    embeds: [renderParentEmbed(monitor, incident)],
  });

  if (!incident.resolved_at) {
    await parentMessage.pin().catch(() => null);

  }

  const thread = await parentMessage.startThread({
    name: truncate(incident.name, 100),
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    reason: `Statuspage incident ${incident.id}`,
  });

  monitorState.incidents[incident.id] = {
    parentMessageId: parentMessage.id,
    threadId: thread.id,
    postedUpdateIds: [],
    updateMessageIds: {},
    resolvedAt: incident.resolved_at ?? undefined,
  };

  return { parentMessage, thread };
}

async function syncIncidentParentMessage(
  channel: TextChannel,
  monitorState: MonitorState,
  monitor: MonitorConfig,
  incident: Incident,
  parentMessage?: Message,
) {
  const mapping = monitorState.incidents[incident.id];
  if (!mapping) {
    return;
  }

  try {
    const message = parentMessage ?? (await channel.messages.fetch(mapping.parentMessageId));
    await message.edit({
      embeds: [renderParentEmbed(monitor, incident)],
    });

    if (!incident.resolved_at && !message.pinned) {
      await message.pin().catch(() => null);
  
    } else if (incident.resolved_at && message.pinned) {
      await message.unpin().catch(() => null);
    }
  } catch (error) {
    if (
      error instanceof DiscordAPIError &&
      (error.code === 10008 || error.code === 10003 || error.code === 50001)
    ) {
      delete monitorState.incidents[incident.id];
      return;
    }

    throw error;
  }
}

async function handleMissingIncidents(
  client: Client,
  channel: TextChannel,
  monitorState: MonitorState,
  monitor: MonitorConfig,
  apiIncidentIds: Set<string>,
  vanishedIncidentIds: Set<string>,
) {
  for (const [incidentId, incidentState] of Object.entries(monitorState.incidents)) {
    if (incidentState.resolvedAt) continue;
    if (apiIncidentIds.has(incidentId)) continue;
    // Only ghost incidents we explicitly know were open, or that are tracked but gone.
    if (!vanishedIncidentIds.has(incidentId)) continue;

    console.log(
      `Incident "${incidentId}" for monitor "${monitor.id}" is no longer in the API. Marking as removed.`,
    );

    try {
      const parentMessage = await channel.messages.fetch(incidentState.parentMessageId);

      // If the embed is already green (resolved), the incident was properly resolved
      // before it aged out of the API. Just update state and skip ghosting.
      const RESOLVED_GREEN = 0x2fb344;
      if (parentMessage.embeds[0]?.color === RESOLVED_GREEN) {
        incidentState.resolvedAt = new Date().toISOString();
        continue;
      }

      const thread = await client.channels.fetch(incidentState.threadId);

      const incidentName = thread?.isThread() ? thread.name : "Unknown Incident";
      await parentMessage.edit({ embeds: [renderMissingParentEmbed(monitor, incidentName)] });

      if (parentMessage.pinned) {
        await parentMessage.unpin().catch(() => null);
      }

      if (thread?.isThread()) {
        for (const messageId of Object.values(incidentState.updateMessageIds)) {
          try {
            const msg = await thread.messages.fetch(messageId);
            if (msg.embeds.length > 0) {
              const strickenEmbed = renderDeletedUpdateEmbed(EmbedBuilder.from(msg.embeds[0]));
              await msg.edit({ embeds: [strickenEmbed] });
            }
          } catch {
            // Update message may have been deleted, skip.
          }
        }

        if (!thread.archived) {
          await thread.setArchived(true, "Incident no longer available on status page");
        }
      }

      incidentState.resolvedAt = new Date().toISOString();
    } catch (error) {
      if (
        error instanceof DiscordAPIError &&
        (error.code === 10003 || error.code === 10008 || error.code === 50001)
      ) {
        delete monitorState.incidents[incidentId];
      } else {
        console.error(
          `Failed to handle missing incident "${incidentId}" for monitor "${monitor.id}":`,
          error,
        );
      }
    }
  }
}

async function handleCleanupCommand(interaction: ChatInputCommandInteraction) {
  if (!env.ENABLE_CLEANUP_COMMAND) throw new Error("/cleanup is disabled.");

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const state = await readState();

  const requested = interaction.options.getString("target") ?? undefined;
  const targetsToClean: MonitorConfig[] = [];
  if (requested) {
    const match = monitors.find((m) => m.id === requested);
    if (!match) throw new Error(`Unknown target "${requested}".`);
    targetsToClean.push(match);
  } else {
    targetsToClean.push(...monitors);
  }

  let totalGhosted = 0;

  for (const monitor of targetsToClean) {
    const [incidents, channel] = await Promise.all([
      fetchIncidents(monitor),
      getTargetChannel(interaction.client, monitor),
    ]);
    const monitorState = getMonitorState(state, monitor.id);
    const apiIncidentIds = new Set(incidents.map((i) => i.id));

    const vanishedIncidentIds = new Set<string>();
    for (const [id, inc] of Object.entries(monitorState.incidents)) {
      if (!inc.resolvedAt && !apiIncidentIds.has(id)) {
        vanishedIncidentIds.add(id);
      }
    }

    const before = Object.values(monitorState.incidents).filter((i) => !i.resolvedAt).length;
    await handleMissingIncidents(interaction.client, channel, monitorState, monitor, apiIncidentIds, vanishedIncidentIds);
    const after = Object.values(monitorState.incidents).filter((i) => !i.resolvedAt).length;
    totalGhosted += before - after;

    monitorState.openIncidentIds = incidents.filter((i) => !i.resolved_at).map((i) => i.id);
  }

  await writeState(state);

  const label = targetsToClean.length === 1
    ? targetsToClean[0].id
    : `${targetsToClean.length} monitors`;
  await interaction.editReply({
    content: totalGhosted === 0
      ? `No dangling incidents found for ${label}.`
      : `Ghosted ${totalGhosted} dangling incident${totalGhosted === 1 ? "" : "s"} for ${label}.`,
  });
}

async function postLatestUpdatesForMonitor(client: Client, monitor: MonitorConfig, state: BotState) {
  const [incidents, channel] = await Promise.all([
    fetchIncidents(monitor),
    getTargetChannel(client, monitor),
  ]);
  const monitorState = getMonitorState(state, monitor.id);

  const allUpdates = incidents
    .flatMap((incident) =>
      incident.incident_updates.map((update) => ({
        incident,
        update,
      })),
    )
    .sort((left, right) => new Date(left.update.created_at).getTime() - new Date(right.update.created_at).getTime());

  if (monitorState.postedUpdateIds.length === 0 && !env.POST_EXISTING_UPDATES_ON_START) {
    const resolvedUpdates = allUpdates.filter(({ incident }) => incident.resolved_at);
    monitorState.postedUpdateIds = resolvedUpdates.map(({ update }) => update.id).slice(-500);
    monitorState.openIncidentIds = incidents.filter((i) => !i.resolved_at).map((i) => i.id);
    monitorState.lastPostedAt = new Date().toISOString();
    console.log(`Seeded ${monitorState.postedUpdateIds.length} resolved incident updates without posting for "${monitor.id}".`);
    return;
  }

  const unseen = allUpdates.filter(({ update }) => !monitorState.postedUpdateIds.includes(update.id));

  for (const { incident, update } of unseen) {
    const { parentMessage, thread } = await ensureIncidentThread(channel, monitorState, monitor, incident);
    const incidentState = monitorState.incidents[incident.id];
    incidentState.resolvedAt = incident.resolved_at ?? undefined;

    if (thread.archived) {
      await thread.setArchived(false, "New incident update received");
    }

    if (!incidentState.postedUpdateIds.includes(update.id)) {
      const message = await thread.send({
        embeds: [renderUpdateEmbed(monitor, incident, update)],
      });
      incidentState.postedUpdateIds.push(update.id);
      incidentState.updateMessageIds[update.id] = message.id;
      incidentState.postedUpdateIds = incidentState.postedUpdateIds.slice(-500);
    }

    await syncIncidentParentMessage(channel, monitorState, monitor, incident, parentMessage);

    if (incident.resolved_at && !thread.archived) {
      await parentMessage.unpin().catch(() => null);
      await thread.setArchived(true, "Incident resolved");
    }

    monitorState.postedUpdateIds.push(update.id);
    monitorState.lastPostedAt = new Date().toISOString();
  }

  const apiIncidentIds = new Set(incidents.map((incident) => incident.id));

  // Reconcile server-side open incident list against what the API reports.
  // Incidents the bot tracked as "open" but no longer in the API are candidates for ghosting.
  const previouslyOpen = new Set(monitorState.openIncidentIds);
  const vanishedIds = [...previouslyOpen].filter((id) => !apiIncidentIds.has(id));
  const vanishedIncidentIds = new Set(vanishedIds);

  // Also check for tracked incidents that disappeared (covers pre-openIncidentIds state).
  for (const id of Object.keys(monitorState.incidents)) {
    if (!monitorState.incidents[id].resolvedAt && !apiIncidentIds.has(id)) {
      vanishedIncidentIds.add(id);
    }
  }

  await handleMissingIncidents(client, channel, monitorState, monitor, apiIncidentIds, vanishedIncidentIds);

  // Update the canonical open incident list from the API.
  monitorState.openIncidentIds = incidents.filter((i) => !i.resolved_at).map((i) => i.id);
  monitorState.postedUpdateIds = monitorState.postedUpdateIds.slice(-500);
}

async function postLatestUpdates(client: Client) {
  const state = await readState();
  for (const monitor of monitors) {
    await postLatestUpdatesForMonitor(client, monitor, state);
  }
  await writeState(state);
}

async function handleStatusCommand(interaction: ChatInputCommandInteraction) {
  if (!env.ENABLE_STATUS_COMMAND) {
    throw new Error("/status is disabled.");
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const targets = resolveMonitors(interaction);
  const state = await readState();
  await assertMonitorChannelAccess(interaction, targets[0], state);
  const embeds = await Promise.all(
    targets.map(async (monitor) => {
      const summary = await fetchSummary(monitor);
      return renderStatusEmbed(monitor, summary);
    }),
  );
  await interaction.editReply({ embeds });
}

async function handleReplayCommand(interaction: ChatInputCommandInteraction) {
  if (!env.ENABLE_REPLAY_COMMAND) {
    throw new Error("/replay is disabled.");
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const targets = resolveMonitors(interaction);
  const state = await readState();
  await assertMonitorChannelAccess(interaction, targets[0], state);

  const botUserId = interaction.client.user?.id;
  if (!botUserId) {
    throw new Error("Bot user is not available.");
  }

  const replayedTargets: Array<{ incident: Incident; updates: IncidentUpdate[] }> = [];
  const skippedIncidents: Incident[] = [];

  for (const monitor of targets) {
    const [replayTargets, channel] = await Promise.all([
      getReplayTargets(monitor),
      getTargetChannel(interaction.client, monitor),
    ]);

    const monitorState = getMonitorState(state, monitor.id);

    for (const { incident, updates } of replayTargets) {
      const existing = monitorState.incidents[incident.id];
      const thread = existing ? await channel.client.channels.fetch(existing.threadId).catch(() => null) : null;
      let missingUpdates = updates;

      if (existing && thread?.isThread()) {
        const missingFromTrackedState = await getMissingIncidentUpdates(thread, existing, updates);
        const presentThreadUpdateIds = await getPresentThreadUpdateIds(thread, botUserId);
        const missingFromThreadScan = updates.filter((update) => !presentThreadUpdateIds.has(update.id));
        const missingIds = new Set([
          ...missingFromTrackedState.map((update) => update.id),
          ...missingFromThreadScan.map((update) => update.id),
        ]);
        missingUpdates = updates.filter((update) => missingIds.has(update.id));
      }

      if (
        missingUpdates.length === 0 &&
        (await hasLiveIncidentMessages(channel, monitorState, incident))
      ) {
        skippedIncidents.push(incident);
        continue;
      }

      await replayIncidentTimeline(channel, monitorState, monitor, incident, missingUpdates);
      replayedTargets.push({ incident, updates: missingUpdates });
    }
  }

  await writeState(state);

  if (replayedTargets.length === 0) {
    await interaction.editReply({
      content: getReplaySkippedText(skippedIncidents) || "Nothing to replay.",
    });
    return;
  }

  const replayText = await getReplaySummaryText(replayedTargets);
  const skippedText = getReplaySkippedText(skippedIncidents);
  await interaction.editReply({
    content: skippedText ? `${replayText}\n${skippedText}` : replayText,
  });
}

async function handleTestPostCommand(interaction: ChatInputCommandInteraction) {
  if (!env.ENABLE_TEST_COMMAND) {
    throw new Error("/testpost is disabled.");
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const targets = resolveMonitors(interaction);
  const state = await readState();
  await assertMonitorChannelAccess(interaction, targets[0], state);

  const channelIds = new Set<string>();
  for (const monitor of targets) {
    const [summary, channel] = await Promise.all([
      fetchSummary(monitor),
      getTargetChannel(interaction.client, monitor),
    ]);

    await channel.send({
      embeds: [renderStatusEmbed(monitor, summary, "Test")],
    });
    channelIds.add(monitor.channelId);
  }

  const channelMentions = [...channelIds].map((id) => `<#${id}>`).join(", ");
  await interaction.editReply({
    content: `Posted ${targets.length} status preview${targets.length === 1 ? "" : "s"} into ${channelMentions}.`,
  });
}

async function handleCleanCommand(interaction: ChatInputCommandInteraction) {
  if (!env.ENABLE_CLEAN_COMMAND) {
    throw new Error("/clean is disabled.");
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const state = await readState();

  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildText) {
    throw new Error("/clean can only be used in a guild text channel.");
  }

  const requested = interaction.options.getString("target") ?? undefined;
  let channelMonitors: MonitorConfig[];
  if (requested) {
    const match = monitors.find((m) => m.id === requested);
    if (!match) {
      throw new Error(`Unknown target "${requested}". Configured targets: ${monitors.map((m) => m.id).join(", ")}`);
    }
    channelMonitors = [match];
  } else {
    channelMonitors = monitors.filter((monitor) => monitor.channelId === channel.id);
    if (channelMonitors.length === 0) {
      throw new Error("/clean can only be used in a configured monitor channel.");
    }
  }

  await assertMonitorChannelAccess(interaction, channelMonitors[0], state);

  const limit = interaction.options.getInteger("limit") ?? 100;
  const messages = await channel.messages.fetch({ limit });
  const botUserId = interaction.client.user?.id;

  if (!botUserId) {
    throw new Error("Bot user is not available.");
  }

  // When targeting a specific monitor, only delete its tracked parent messages.
  // When cleaning all monitors in a channel, delete all bot messages.
  const trackedParentIds = requested
    ? new Set(
        channelMonitors.flatMap((m) =>
          Object.values(getMonitorState(state, m.id).incidents).map((inc) => inc.parentMessageId),
        ),
      )
    : undefined;

  const deletableMessages = messages.filter((message) => {
    if (message.author.id !== botUserId) {
      return false;
    }

    if (trackedParentIds && !trackedParentIds.has(message.id)) {
      return false;
    }

    // Discord bulk delete rejects messages older than 14 days.
    return Date.now() - message.createdTimestamp < 14 * 24 * 60 * 60 * 1000;
  });

  let deletedThreadMessageCount = 0;
  for (const channelMonitor of channelMonitors) {
    const monitorState = getMonitorState(state, channelMonitor.id);
    for (const [incidentId, mapping] of Object.entries(monitorState.incidents)) {
      const fetchedThread = await interaction.client.channels.fetch(mapping.threadId).catch(() => null);
      if (!fetchedThread?.isThread()) {
        delete monitorState.incidents[incidentId];
        continue;
      }

      const threadMessages = await fetchedThread.messages.fetch({ limit: 100 });
      const threadBotMessages = threadMessages.filter((message) => message.author.id === botUserId);

      if (threadBotMessages.size > 0) {
        const deleted = await fetchedThread.bulkDelete(threadBotMessages, true).catch(() => null);
        deletedThreadMessageCount += deleted?.size ?? 0;
      }

      await fetchedThread.delete("Clean command requested").catch(() => null);
      // Only strip update IDs for unresolved incidents so they re-post and
      // get new threads. Resolved ones stay "seen" to prevent flooding.
      if (!mapping.resolvedAt) {
        monitorState.postedUpdateIds = monitorState.postedUpdateIds.filter(
          (updateId) => !mapping.postedUpdateIds.includes(updateId),
        );
      }
      delete monitorState.incidents[incidentId];
    }
  }

  if (deletableMessages.size === 0) {
    await writeState(state);
    await interaction.editReply({
      content:
        deletedThreadMessageCount > 0
          ? `Deleted ${deletedThreadMessageCount} bot-authored thread message${deletedThreadMessageCount === 1 ? "" : "s"} and removed incident threads for <#${channel.id}>.`
          : `No recent bot-authored messages found in <#${channel.id}>.`,
    });
    return;
  }

  const deleted = await channel.bulkDelete(deletableMessages, true);
  for (const channelMonitor of channelMonitors) {
    const monitorState = getMonitorState(state, channelMonitor.id);
    for (const [incidentId, mapping] of Object.entries(monitorState.incidents)) {
      if (deleted.has(mapping.parentMessageId)) {
        // Only strip update IDs for unresolved incidents so they re-post and
        // get new threads. Resolved ones stay "seen" to prevent flooding.
        if (!mapping.resolvedAt) {
          monitorState.postedUpdateIds = monitorState.postedUpdateIds.filter(
            (updateId) => !mapping.postedUpdateIds.includes(updateId),
          );
        }
        delete monitorState.incidents[incidentId];
      }
    }
  }
  await writeState(state);

  await interaction.editReply({
    content: `Deleted ${deleted.size} bot-authored channel message${deleted.size === 1 ? "" : "s"} and ${deletedThreadMessageCount} bot-authored thread message${deletedThreadMessageCount === 1 ? "" : "s"} in <#${channel.id}>.`,
  });
}

function deriveMonitorId(pageName: string): string {
  return pageName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

async function handleMonitorAdd(interaction: ChatInputCommandInteraction, client: Client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const rawUrl = interaction.options.getString("url", true);
  const baseUrl = rawUrl.replace(/\/+$/, "");
  const channel = interaction.options.getChannel("channel") ?? interaction.channel;
  const channelId = channel?.id;

  if (!channelId) {
    throw new Error("Could not determine a target channel.");
  }

  // Validate the URL by fetching the summary endpoint.
  let summary: Summary;
  try {
    const response = await fetch(`${baseUrl}/api/v2/summary.json`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    summary = (await response.json()) as Summary;
  } catch {
    throw new Error(`Could not reach a valid Statuspage at \`${baseUrl}\`. Make sure the URL points to a public Statuspage (e.g. \`https://status.atlassian.com\`).`);
  }

  // Check bot permissions in target channel.
  const targetChannel = await client.channels.fetch(channelId);
  if (!targetChannel || targetChannel.type !== ChannelType.GuildText) {
    throw new Error(`<#${channelId}> must be a text channel.`);
  }
  const botMember = (targetChannel as TextChannel).guild.members.me;
  if (botMember) {
    const perms = (targetChannel as TextChannel).permissionsFor(botMember);
    if (!perms?.has("SendMessages") || !perms.has("EmbedLinks") || !perms.has("CreatePublicThreads")) {
      throw new Error(`I'm missing permissions in <#${channelId}>. I need **Send Messages**, **Embed Links**, and **Create Public Threads**.`);
    }
  }

  const label = interaction.options.getString("label") ?? undefined;
  const providedId = interaction.options.getString("id") ?? undefined;
  const monitorId = providedId ?? deriveMonitorId(summary.page.name);

  if (!monitorId) {
    throw new Error("Could not derive a monitor ID. Please provide one with the `id` option.");
  }

  // Collision check.
  if (monitors.some((m) => m.id === monitorId)) {
    const source = envMonitorIds.has(monitorId) ? " (configured via environment)" : "";
    throw new Error(`A monitor with ID \`${monitorId}\` already exists${source}.`);
  }

  // Duplicate URL check — same Statuspage should only be tracked once per server.
  const existingUrl = monitors.find((m) => m.baseUrl.replace(/\/+$/, "") === baseUrl);
  if (existingUrl) {
    throw new Error(`A monitor for \`${baseUrl}\` already exists (\`${existingUrl.id}\` in <#${existingUrl.channelId}>).`);
  }

  const entry: RuntimeMonitorEntry = {
    id: monitorId,
    channelId,
    baseUrl,
    label,
    addedBy: interaction.user.id,
    addedAt: new Date().toISOString(),
  };

  await withMonitorLock(async () => {
    const existing = await readRuntimeMonitors();
    existing.push(entry);
    await writeRuntimeMonitors(existing);
    rebuildMonitors(existing);
  });

  // Cache icon for the new monitor.
  const icon = await fetchMonitorIcon(entry);
  if (icon) {
    monitorIcons.set(monitorId, icon);
  }

  // Re-register commands so autocomplete picks up the new monitor.
  commands = buildCommands();
  await registerCommands();

  // Trigger immediate first poll.
  try {
    const state = await readState();
    await postLatestUpdatesForMonitor(client, entry, state);
    await writeState(state);
  } catch (error) {
    console.error(`First poll for new monitor "${monitorId}" failed.`, error);
  }

  const embed = new EmbedBuilder()
    .setColor(statusColor(summary.status.indicator))
    .setAuthor({
      name: "Monitor Added",
      iconURL: monitorIcons.get(monitorId),
    })
    .setTitle(monitorDisplayName(entry, summary.page.name))
    .addFields(
      { name: "ID", value: `\`${monitorId}\``, inline: true },
      { name: "URL", value: baseUrl, inline: true },
      { name: "Channel", value: `<#${channelId}>`, inline: true },
      { name: "Status", value: statusLabel(summary.status.indicator), inline: true },
    )
    .setTimestamp();

  await interaction.editReply({ embeds: [embed] });
}

async function handleMonitorRemove(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const monitorId = interaction.options.getString("id", true);

  if (envMonitorIds.has(monitorId)) {
    throw new Error(`Monitor \`${monitorId}\` is configured via environment variables. Remove it from your config instead.`);
  }

  let removed = false;
  let removedChannelId: string | undefined;

  await withMonitorLock(async () => {
    const existing = await readRuntimeMonitors();
    const index = existing.findIndex((entry) => entry.id === monitorId);
    if (index === -1) {
      throw new Error(`No runtime monitor with ID \`${monitorId}\` found.`);
    }
    removedChannelId = existing[index].channelId;
    existing.splice(index, 1);
    await writeRuntimeMonitors(existing);
    rebuildMonitors(existing);
    removed = true;
  });

  if (removed) {
    monitorIcons.delete(monitorId);
    commands = buildCommands();
    await registerCommands();
  }

  const channelMention = removedChannelId ? ` Use \`/clean\` in <#${removedChannelId}> to remove them.` : "";
  await interaction.editReply({
    content: `Removed monitor \`${monitorId}\`. Existing threads preserved.${channelMention}`,
  });
}

async function handleMonitorList(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (monitors.length === 0) {
    await interaction.editReply({
      content: "No monitors configured. Use `/monitor add` or set `STATUSPAGE_MONITORS_JSON`.",
    });
    return;
  }

  const runtimeEntries = await readRuntimeMonitors();
  const runtimeMap = new Map(runtimeEntries.map((e) => [e.id, e]));

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Configured Monitors")
    .setTimestamp();

  for (const monitor of monitors) {
    const isEnv = envMonitorIds.has(monitor.id);
    const source = isEnv ? "env" : "runtime";
    const lines = [
      `**Source:** \`${source}\``,
      `**URL:** ${monitor.baseUrl}`,
      `**Channel:** <#${monitor.channelId}>`,
    ];

    if (!isEnv) {
      const runtime = runtimeMap.get(monitor.id);
      if (runtime) {
        lines.push(`**Added by:** <@${runtime.addedBy}>`);
        lines.push(`**Added:** ${formatTimestamp(runtime.addedAt)}`);
      }
    }

    embed.addFields({
      name: `${monitorDisplayName(monitor)} (\`${monitor.id}\`)`,
      value: lines.join("\n"),
    });
  }

  await interaction.editReply({ embeds: [embed] });
}

async function main() {
  await ensureStateFile();
  const runtimeEntries = await readRuntimeMonitors();
  rebuildMonitors(runtimeEntries);
  await cacheMonitorIcons();
  await registerCommands();

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once("clientReady", async () => {
    console.log(`Logged in as ${client.user?.tag}`);

    try {
      await postLatestUpdates(client);
    } catch (error) {
      console.error("Initial poll failed.", error);
    }

    setInterval(() => {
      void postLatestUpdates(client).catch((error) => {
        console.error("Polling failed.", error);
      });
    }, env.POLL_INTERVAL_MS);
  });

  client.on("interactionCreate", async (interaction) => {
    if (interaction.isAutocomplete()) {
      try {
        await handleAutocomplete(interaction);
      } catch (error) {
        console.error("Autocomplete handler failed.", error);
      }
      return;
    }

    if (!interaction.isChatInputCommand()) {
      return;
    }

    try {
      if (interaction.commandName === "status") {
        await handleStatusCommand(interaction);
        return;
      }

      if (interaction.commandName === "replay") {
        await handleReplayCommand(interaction);
        return;
      }

      if (interaction.commandName === "testpost") {
        await handleTestPostCommand(interaction);
        return;
      }

      if (interaction.commandName === "clean") {
        await handleCleanCommand(interaction);
        return;
      }

      if (interaction.commandName === "cleanup") {
        await handleCleanupCommand(interaction);
        return;
      }

      if (interaction.commandName === "monitor") {
        const sub = interaction.options.getSubcommand();
        if (sub === "add") {
          await handleMonitorAdd(interaction, client);
        } else if (sub === "remove") {
          await handleMonitorRemove(interaction);
        } else if (sub === "list") {
          await handleMonitorList(interaction);
        }
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
      }
    }
  });

  await client.login(env.DISCORD_TOKEN);
}

await main();
