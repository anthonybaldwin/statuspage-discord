# API Integration

The bot supports multiple status page providers. Each provider lives in its own adapter under `src/providers/` and normalizes its API responses into the same canonical shapes (`Incident`, `IncidentUpdate`, `Summary`, `PageStatus`) so the polling loop, rendering, and state management are completely provider-agnostic.

## Supported Providers

| Provider | ID | Example URL | API Type |
|----------|----|-----------| ---------|
| Statuspage.io (Atlassian) | `statuspage` | `https://status.atlassian.com` | Public v2 API, no key required |
| incident.io | `incidentio` | `https://status.openai.com` | Public widget proxy, no key required |

No API key is required for any supported provider — all endpoints are public.

## Provider Detection

When a user runs `/monitor add <url>`, the bot probes each provider in order (see `PROBE_ORDER` in `src/providers/index.ts`). The first provider whose `probe()` returns a non-null result wins and is saved to the monitor's `provider` field in `data/monitors.json`.

Current probe order:

1. **incident.io** — probed first because many incident.io pages also expose a Statuspage-compatible `/api/v2/` shim, but the shim returns empty update bodies and a truncated history. Probing incident.io first ensures we use the richer native widget API when available.
2. **Statuspage.io** — fallback for pages that are not on incident.io.

Monitors loaded from `data/monitors.json` or `STATUSPAGE_MONITORS_JSON` that pre-date multi-provider support default to `statuspage` for backwards compatibility.

## Statuspage.io Adapter

File: `src/providers/statuspage.ts`

| Endpoint | Used By | Purpose |
|----------|---------|---------|
| `<baseUrl>/api/v2/summary.json` | `probe()`, `fetchSummary()` | Overall page status + active incidents |
| `<baseUrl>/api/v2/incidents.json` | `fetchIncidents()` | Full incident list with all updates (for polling, `/replay`) |

Both endpoints return responses that already match the canonical shapes — the adapter is a thin pass-through.

### Canonical types

```typescript
type Summary = {
  page: { id: string; name: string; url: string; updated_at?: string };
  status: { indicator: string; description: string };
  incidents: Incident[];   // active only in /summary.json
};

type Incident = {
  id: string;
  name: string;
  status: string;          // "investigating" | "identified" | "monitoring" | "resolved"
  impact: string;          // "none" | "minor" | "major" | "critical"
  shortlink?: string;
  created_at: string;
  updated_at?: string;
  resolved_at?: string | null;
  incident_updates: IncidentUpdate[];
};

type IncidentUpdate = {
  id: string;
  status: string;
  body: string;
  created_at: string;
  updated_at?: string;
};
```

## incident.io Adapter

File: `src/providers/incidentio.ts`

incident.io exposes its public status page data through a proxy at `<baseUrl>/proxy/<host>`, where `<host>` is the hostname of the base URL. For example:

```
https://status.openai.com/proxy/status.openai.com            # summary
https://status.openai.com/proxy/status.openai.com/incidents  # full history
```

| Endpoint | Used By | Purpose |
|----------|---------|---------|
| `<baseUrl>/proxy/<host>` | `probe()`, `fetchSummary()` | `summary` object with ongoing incidents, affected components, page metadata |
| `<baseUrl>/proxy/<host>/incidents` | `fetchIncidents()` | `{ incidents: [...] }` with resolved incidents and full update messages |

### Normalization details

- **Page status** (`PageStatus.indicator`) is derived from the highest severity across `ongoing_incidents` + `affected_components`. An empty list with no in-progress maintenance maps to `none` / "All Systems Operational".
- **Incident status** is lowercased and mapped onto the canonical set: `investigating`, `identified` (incident.io's `fixing` also maps here), `monitoring`, `resolved`.
- **Incident impact** comes from `incident.impact` when present, otherwise derived from the max severity across `component_impacts[]` and `status_summaries[]`. incident.io's raw impact strings (`degraded`, `partial_outage`, `full_outage`, etc.) are collapsed onto the canonical `none` / `minor` / `major` / `critical` set.
- **Update message bodies** use a nested rich-doc structure (`{ type: "doc", content: [{ type: "paragraph", content: [...] }] }`). The adapter's `flattenMessage()` walks this recursively and returns plain text with paragraph breaks.
- **Shortlinks** come from `incident.url` when present, otherwise constructed as `<public_url>/incident/<id>`.

### Instatus status (skipped)

Instatus (e.g. `https://status.kagi.com`) is **not** currently supported. Its only public endpoint is `/summary.json`, which returns flat active-incident metadata without message bodies or history. Adding it would require either synthesizing updates from polled state diffs (degraded fidelity) or scraping the HTML incident pages (fragile). The provider interface is designed to make dropping Instatus in later a one-file addition if a richer public API appears.

## Favicon Fetching

Provider-agnostic. On startup and when adding a runtime monitor, the bot resolves an icon for embed author fields:

1. If `iconUrl` is set on the monitor config, use it directly (skips all fetching).
2. Otherwise, `GET <baseUrl>` (HTML page).
3. Scan every `<link>` tag whose `rel` contains `icon` (matches `rel="icon"`, `rel="shortcut icon"`, and `rel="apple-touch-icon"` in any attribute order).
4. Rank candidates: non-SVG first (Discord embed author icons don't render SVG), then largest `sizes="WxH"` wins.
5. Decode common HTML entities (`&amp;`, `&#38;`, `&quot;`) and resolve relative/protocol-relative hrefs against the base URL.
6. Cached in memory (`monitorIcons` Map) for embed author icons.

Use `iconUrl` to override auto-detection when a page's icon is injected by JavaScript, hosted on a CDN that rejects hotlinking, or otherwise unreachable for Discord's image fetcher.

## Error Handling

- **Non-200 responses:** Adapters throw with status code and response body for debugging.
- **Network errors:** Caught at the poll level; logged and retried on next cycle.
- **Invalid status page URL:** `/monitor add` runs every provider's `probe()` and only accepts URLs where at least one returns success.
- **API rate limits:** Not explicitly handled; public APIs are generous and the 60s default poll interval keeps request volume low.
- **Probe failures:** A provider's `probe()` should return `null` rather than throwing when the URL is not its own. `detectProvider()` swallows thrown probe errors and moves on to the next provider.

## Color Mapping

The bot maps status indicators to Discord embed colors. The mapping handles the union of statuses across all providers (after canonicalization).

| Status/Impact | Color | Hex |
|---------------|-------|-----|
| Operational / Resolved / None | Green | `#2fb344` |
| Identified | Yellow | `#f2c94c` |
| Monitoring | Blue | `#6aa9ff` |
| Investigating / Minor / Degraded | Orange | `#f2994a` |
| Major / Critical / Major Outage | Red | `#eb5757` |
| Under Maintenance | Grey | `#8e8e93` |
| Maintenance | Dark Grey | `#7f8c8d` |
| Removed (ghost) | Light Grey | `#95a5a6` |
| Unknown/Default | Discord Blurple | `#5865f2` |
