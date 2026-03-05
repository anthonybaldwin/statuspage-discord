# API Integration

The bot uses the public [Statuspage.io API v2](https://developer.statuspage.io/). No API key is required for public pages.

## Endpoints Used

All requests go to `<baseUrl>/api/v2/...` with `Accept: application/json`.

| Endpoint | Used By | Purpose |
|----------|---------|---------|
| `/api/v2/summary.json` | `fetchSummary()` | Overall page status + active incidents (for `/status`, `/testpost`, validation) |
| `/api/v2/incidents.json` | `fetchIncidents()` | Full incident list with all updates (for polling, `/replay`) |

## Response Types

### Summary (`/summary.json`)

```typescript
type Summary = {
  page: {
    id: string;
    name: string;
    url: string;
    updated_at?: string;
  };
  status: {
    indicator: string;   // "none" | "minor" | "major" | "critical" | "maintenance"
    description: string;
  };
  incidents: Incident[];  // Active (unresolved) incidents only
};
```

### Incidents (`/incidents.json`)

```typescript
type IncidentsResponse = {
  page: Summary["page"];
  incidents: Incident[];  // All incidents (including resolved, up to API limit)
};

type Incident = {
  id: string;
  name: string;
  status: string;             // "investigating" | "identified" | "monitoring" | "resolved"
  impact: string;             // "none" | "minor" | "major" | "critical"
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

## Favicon Fetching

On startup (and when adding a runtime monitor), the bot fetches the Statuspage's HTML to extract the favicon URL:

1. `GET <baseUrl>` (HTML page)
2. Regex match: `<link rel="shortcut icon" href="...">`
3. Protocol-relative URLs (`//`) are normalized to `https://`
4. Cached in memory (`monitorIcons` Map) for embed author icons

## Error Handling

- **Non-200 responses:** Throws with status code and response body for debugging
- **Network errors:** Caught at the poll level; logged and retried on next cycle
- **Invalid Statuspage URL:** `/monitor add` validates by testing the summary endpoint before accepting
- **API rate limits:** Not explicitly handled (public Statuspage APIs are generous). The 60s poll interval keeps request volume low.

## Color Mapping

The bot maps Statuspage status indicators to Discord embed colors:

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
