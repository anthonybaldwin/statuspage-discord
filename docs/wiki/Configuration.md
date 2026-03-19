# Configuration

All configuration is via environment variables. Copy `.env.example` to `.env` and fill in the required values.

## Required Variables

| Variable | Description |
|----------|-------------|
| `DISCORD_TOKEN` | Bot token from the [Discord Developer Portal](https://discord.com/developers/applications) |
| `DISCORD_APPLICATION_ID` | Application ID from the same portal |

## Monitor Configuration

You must configure monitors using **one** of these two approaches:

### Option A: Multi-Monitor (Recommended)

```env
STATUSPAGE_MONITORS_JSON=[{"id":"atlassian","channelId":"123456789","baseUrl":"https://status.atlassian.com","label":"Atlassian"},{"id":"claude","channelId":"987654321","baseUrl":"https://status.claude.com","label":"Claude"}]
```

Each monitor object requires:

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique identifier used in commands and state |
| `channelId` | Yes | Discord text channel ID for posting updates |
| `baseUrl` | Yes | Public Statuspage URL (e.g. `https://status.atlassian.com`) |
| `label` | No | Display name shown in embeds and command output |
| `iconUrl` | No | Custom icon URL for embeds. Overrides auto-detected favicon. Useful when a page's favicon doesn't work in Discord (e.g. extensionless URLs). |

### Option B: Legacy Single-Monitor

```env
DISCORD_CHANNEL_ID=123456789
STATUSPAGE_BASE_URL=https://status.atlassian.com
```

This creates a single monitor with ID `default`. If `STATUSPAGE_MONITORS_JSON` is set, these two variables are ignored.

### Runtime Monitors

Monitors can also be added at runtime via `/monitor add`. These are persisted in `data/monitors.json` and survive restarts. Environment-configured monitors take precedence over runtime monitors with the same ID.

## Optional Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DISCORD_GUILD_ID` | — | Guild ID for faster command registration during development. When set, commands are guild-scoped instead of global. |
| `POLL_INTERVAL_MS` | `60000` | How often (in ms) to poll each Statuspage |
| `POST_EXISTING_UPDATES_ON_START` | `false` | When `true`, posts all visible incident updates on first startup instead of silently seeding them |
| `APP_VERSION` | `package.json` version | Version string displayed in the bot's rotating Discord presence. Auto-set during Docker builds via build arg. |

## Feature Flags

All default to `true`. Set to `false` to disable the corresponding command.

| Variable | Command |
|----------|---------|
| `ENABLE_STATUS_COMMAND` | `/status` |
| `ENABLE_TEST_COMMAND` | `/testpost` |
| `ENABLE_REPLAY_COMMAND` | `/replay` |
| `ENABLE_CLEAN_COMMAND` | `/clean` |
| `ENABLE_MONITOR_COMMAND` | `/monitor` |
| `ENABLE_CLEANUP_COMMAND` | `/cleanup` |

Boolean values accept: `true`, `1`, `yes`, `on` (truthy) or `false`, `0`, `no`, `off` (falsy).

## Discord Bot Permissions

The bot requires these permissions in each monitor channel:

| Permission | Purpose |
|------------|---------|
| Send Messages | Post incident embeds |
| Embed Links | Render rich embeds |
| Create Public Threads | Create incident threads |
| Manage Messages | Pin/unpin incident parent messages |
| Read Message History | Scan threads for deduplication during replay |

The `/monitor add` command validates these permissions before adding a new monitor.

Administrative commands (`/testpost`, `/replay`, `/clean`, `/cleanup`, `/monitor`) require the **Manage Server** permission.

## Gateway Intents

The bot only needs the `Guilds` intent. No message content or presence intents are required.
