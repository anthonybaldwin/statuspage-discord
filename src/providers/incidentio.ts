import type {
  Incident,
  IncidentUpdate,
  PageStatus,
  Provider,
  ProviderMonitor,
  Summary,
} from "./types";

/**
 * incident.io exposes its public widget data through a proxy at
 * `<baseUrl>/proxy/<host>`, where `<host>` is the hostname of the status page
 * (e.g. `https://status.openai.com/proxy/status.openai.com`). Everything
 * hangs off that prefix:
 *   - <proxyBase>            → current summary (ongoing_incidents, components, ...)
 *   - <proxyBase>/incidents  → full incident history with update messages
 */

type IncidentIoImpact = "none" | "minor" | "degraded" | "partial_outage" | "major" | "full_outage" | "critical" | string;

type IncidentIoUpdateMessage =
  | string
  | {
      type?: string;
      text?: string;
      content?: IncidentIoUpdateMessage[];
    };

type IncidentIoUpdate = {
  id: string;
  status?: string;
  message?: IncidentIoUpdateMessage;
  message_text?: string;
  body?: string;
  created_at?: string;
  updated_at?: string;
  published_at?: string;
};

type IncidentIoComponentImpact = {
  id?: string;
  component_id?: string;
  component_name?: string;
  impact?: IncidentIoImpact;
  status?: string;
};

type IncidentIoIncident = {
  id: string;
  name: string;
  status?: string;
  impact?: IncidentIoImpact;
  published_at?: string;
  created_at?: string;
  updated_at?: string;
  resolved_at?: string | null;
  updates?: IncidentIoUpdate[];
  component_impacts?: IncidentIoComponentImpact[];
  affected_components?: IncidentIoComponentImpact[];
  status_summaries?: Array<{ impact?: IncidentIoImpact; status?: string }>;
  url?: string;
};

type IncidentIoSummaryResponse = {
  summary?: {
    id?: string;
    name?: string;
    public_url?: string;
    ongoing_incidents?: IncidentIoIncident[];
    scheduled_maintenances?: IncidentIoIncident[];
    in_progress_maintenances?: IncidentIoIncident[];
    affected_components?: IncidentIoComponentImpact[];
  };
};

type IncidentIoIncidentsResponse = {
  incidents?: IncidentIoIncident[];
};

function proxyBase(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  const host = new URL(trimmed).host;
  return `${trimmed}/proxy/${host}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`incident.io request failed (${response.status}): ${body}`);
  }
  return (await response.json()) as T;
}

/**
 * Recursively walk incident.io's rich-doc message format and return plain text.
 * Handles both the nested `{ type: "doc", content: [...] }` shape and plain
 * strings (which some older or simpler messages use).
 */
function flattenMessage(message: IncidentIoUpdateMessage | undefined): string {
  if (message == null) return "";
  if (typeof message === "string") return message;

  const isBlock = message.type === "doc" || message.type === "paragraph" || message.type === "bulletList" || message.type === "listItem";

  let out = "";
  if (typeof message.text === "string") {
    out += message.text;
  }
  if (Array.isArray(message.content)) {
    for (const child of message.content) {
      out += flattenMessage(child);
    }
  }
  if (isBlock && out.length > 0 && !out.endsWith("\n")) {
    out += "\n\n";
  }
  return out;
}

function cleanBody(body: string): string {
  return body.replace(/\n{3,}/g, "\n\n").trim();
}

const IMPACT_RANK: Record<string, number> = {
  none: 0,
  operational: 0,
  minor: 1,
  degraded: 1,
  degraded_performance: 1,
  partial_outage: 2,
  major: 2,
  full_outage: 3,
  critical: 3,
};

function canonicalImpact(raw: string | undefined): string {
  if (!raw) return "none";
  const key = String(raw).toLowerCase();
  switch (key) {
    case "none":
    case "operational":
      return "none";
    case "minor":
    case "degraded":
    case "degraded_performance":
      return "minor";
    case "partial_outage":
    case "major":
      return "major";
    case "full_outage":
    case "critical":
      return "critical";
    default:
      return "minor";
  }
}

function maxImpact(impacts: Array<string | undefined>): string {
  let best = "none";
  let bestRank = 0;
  for (const impact of impacts) {
    const canonical = canonicalImpact(impact);
    const rank = IMPACT_RANK[canonical] ?? 0;
    if (rank > bestRank) {
      best = canonical;
      bestRank = rank;
    }
  }
  return best;
}

function canonicalStatus(raw: string | undefined): string {
  if (!raw) return "investigating";
  const key = String(raw).toLowerCase();
  switch (key) {
    case "investigating":
    case "triage":
      return "investigating";
    case "identified":
    case "fixing":
      return "identified";
    case "monitoring":
      return "monitoring";
    case "resolved":
    case "closed":
    case "postmortem":
      return "resolved";
    default:
      return "investigating";
  }
}

function deriveIncidentImpact(incident: IncidentIoIncident): string {
  if (incident.impact) return canonicalImpact(incident.impact);
  const componentImpacts = (incident.component_impacts ?? incident.affected_components ?? []).map((c) => c.impact);
  const summaryImpacts = (incident.status_summaries ?? []).map((s) => s.impact);
  return maxImpact([...componentImpacts, ...summaryImpacts]);
}

function mapUpdate(update: IncidentIoUpdate, incidentStatus: string): IncidentUpdate {
  const rawBody = (() => {
    if (typeof update.body === "string" && update.body.trim()) return update.body;
    if (typeof update.message_text === "string" && update.message_text.trim()) return update.message_text;
    return flattenMessage(update.message);
  })();
  const body = cleanBody(rawBody) || "No message provided.";
  const createdAt = update.created_at ?? update.published_at ?? update.updated_at ?? new Date(0).toISOString();
  return {
    id: update.id,
    status: canonicalStatus(update.status ?? incidentStatus),
    body,
    created_at: createdAt,
    updated_at: update.updated_at ?? createdAt,
  };
}

function mapIncident(incident: IncidentIoIncident, publicUrl?: string): Incident {
  const status = canonicalStatus(incident.status);
  const updates = (incident.updates ?? []).map((u) => mapUpdate(u, status));
  updates.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  const createdAt = incident.published_at ?? incident.created_at ?? updates[0]?.created_at ?? new Date(0).toISOString();
  const latestUpdate = updates[updates.length - 1];
  const updatedAt = incident.updated_at ?? latestUpdate?.created_at ?? createdAt;

  let resolvedAt: string | null = null;
  if (incident.resolved_at) {
    resolvedAt = incident.resolved_at;
  } else if (status === "resolved") {
    resolvedAt = latestUpdate?.created_at ?? updatedAt;
  }

  let shortlink = incident.url;
  if (!shortlink && publicUrl) {
    const base = publicUrl.replace(/\/+$/, "");
    shortlink = `${base}/incident/${incident.id}`;
  }

  return {
    id: incident.id,
    name: incident.name,
    status,
    impact: deriveIncidentImpact(incident),
    shortlink,
    created_at: createdAt,
    updated_at: updatedAt,
    resolved_at: resolvedAt,
    incident_updates: updates,
  };
}

function derivePageStatus(summary: NonNullable<IncidentIoSummaryResponse["summary"]>): PageStatus {
  const ongoing = summary.ongoing_incidents ?? [];
  const affected = summary.affected_components ?? [];
  const inProgressMaintenance = summary.in_progress_maintenances ?? [];

  if (ongoing.length === 0 && affected.length === 0 && inProgressMaintenance.length === 0) {
    return { indicator: "none", description: "All Systems Operational" };
  }

  if (ongoing.length === 0 && affected.length === 0 && inProgressMaintenance.length > 0) {
    return { indicator: "maintenance", description: "Under Maintenance" };
  }

  const impacts: string[] = [];
  for (const incident of ongoing) {
    impacts.push(deriveIncidentImpact(incident));
  }
  for (const component of affected) {
    impacts.push(canonicalImpact(component.impact ?? component.status));
  }
  const worst = maxImpact(impacts);
  const description =
    worst === "critical"
      ? "Critical Outage"
      : worst === "major"
        ? "Major Outage"
        : worst === "minor"
          ? "Minor Issues"
          : "Issues Detected";
  return { indicator: worst === "none" ? "minor" : worst, description };
}

function normalizePage(summary: NonNullable<IncidentIoSummaryResponse["summary"]>): Summary["page"] {
  return {
    id: summary.id ?? "",
    name: summary.name ?? "incident.io status page",
    url: summary.public_url ?? "",
  };
}

export const incidentio: Provider = {
  id: "incidentio",
  displayName: "incident.io",

  async probe(baseUrl) {
    try {
      const url = proxyBase(baseUrl);
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) return null;
      const data = (await response.json()) as IncidentIoSummaryResponse;
      const summary = data?.summary;
      if (!summary?.id || !summary?.public_url) return null;
      return { page: normalizePage(summary), status: derivePageStatus(summary) };
    } catch {
      return null;
    }
  },

  async fetchSummary(monitor: ProviderMonitor): Promise<Summary> {
    const url = proxyBase(monitor.baseUrl);
    const data = await fetchJson<IncidentIoSummaryResponse>(url);
    const summary = data?.summary;
    if (!summary) {
      throw new Error("incident.io summary response was empty.");
    }
    const page = normalizePage(summary);
    const status = derivePageStatus(summary);
    const incidents = (summary.ongoing_incidents ?? []).map((i) => mapIncident(i, summary.public_url));
    return { page, status, incidents };
  },

  async fetchIncidents(monitor: ProviderMonitor): Promise<Incident[]> {
    const url = `${proxyBase(monitor.baseUrl)}/incidents`;
    const data = await fetchJson<IncidentIoIncidentsResponse>(url);
    const raw = data?.incidents ?? [];
    // Fetch the page's public URL once for shortlink construction.
    let publicUrl: string | undefined;
    try {
      const summaryData = await fetchJson<IncidentIoSummaryResponse>(proxyBase(monitor.baseUrl));
      publicUrl = summaryData?.summary?.public_url;
    } catch {
      // Non-fatal; shortlinks will fall back to incident.url if present.
    }
    return raw.map((incident) => mapIncident(incident, publicUrl));
  },
};
