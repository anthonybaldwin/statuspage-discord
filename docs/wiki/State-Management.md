# State Management

The bot persists its state to JSON files in the `data/` directory. In Docker deployments, this directory is backed by a named volume (`statuspage_data`).

## Files

| File | Purpose |
|------|---------|
| `data/state.json` | Incident tracking, posted update IDs, open incident list |
| `data/monitors.json` | Runtime-added monitors (via `/monitor add`) |

## State Schema

### `state.json`

```json
{
  "monitors": {
    "<monitor-id>": {
      "postedUpdateIds": ["update-id-1", "update-id-2"],
      "openIncidentIds": ["incident-id-1"],
      "lastPostedAt": "2026-03-02T15:50:31.184Z",
      "incidents": {
        "<incident-id>": {
          "parentMessageId": "discord-message-id",
          "threadId": "discord-thread-id",
          "postedUpdateIds": ["update-id-1"],
          "updateMessageIds": {
            "update-id-1": "discord-message-id"
          },
          "resolvedAt": "2026-03-02T15:47:09Z"
        }
      }
    }
  }
}
```

**Field details:**

| Field | Scope | Purpose |
|-------|-------|---------|
| `postedUpdateIds` | Monitor | Deduplication list (last 500) to avoid re-posting updates |
| `openIncidentIds` | Monitor | Running list of incident IDs the bot considers "open", used for ghost detection |
| `lastPostedAt` | Monitor | Timestamp of the last posted update |
| `incidents` | Monitor | Map of tracked incidents with Discord resource IDs |
| `parentMessageId` | Incident | The embed message in the channel that anchors the thread |
| `threadId` | Incident | The Discord thread ID for the incident |
| `postedUpdateIds` | Incident | Update IDs posted to this specific thread |
| `updateMessageIds` | Incident | Map of update IDs to their Discord message IDs (for editing/cleanup) |
| `resolvedAt` | Incident | When the incident was resolved or ghosted |

### `monitors.json`

```json
{
  "monitors": [
    {
      "id": "example",
      "channelId": "123456789",
      "baseUrl": "https://status.example.com",
      "label": "Example",
      "addedBy": "discord-user-id",
      "addedAt": "2026-03-05T12:00:00Z"
    }
  ]
}
```

## Migration

The bot supports legacy single-monitor state. If `state.json` has a flat structure (no `monitors` key), the bot automatically migrates it into a `monitors.default` bucket on first read.

## Concurrency Safety

### State File

State reads and writes are not locked because only one poll cycle runs at a time (sequential `for...of` over monitors within `postLatestUpdates`). Command handlers read state independently but only write during `/replay` and `/clean`, which are user-triggered and unlikely to race with polling.

### Monitors File

Runtime monitor mutations (`/monitor add`, `/monitor remove`) use a promise-chain lock (`withMonitorLock`) to ensure read-modify-write operations on `monitors.json` are serialized. This prevents two concurrent `/monitor add` calls from overwriting each other.

## State Limits

- `postedUpdateIds` (monitor-level) is trimmed to the last 500 entries per poll cycle
- `postedUpdateIds` (incident-level) is trimmed to the last 500 entries per replay
- Incident state entries are only deleted when Discord resources are confirmed missing
- `/clean` preserves monitor-level `postedUpdateIds` for resolved incidents to prevent re-posting, but strips them for active incidents so they re-create threads

## File Safety

- Both state files are written atomically (full JSON rewrite, not append)
- The `data/` directory is created with `mkdir({ recursive: true })` if missing
- Files use `utf8` encoding with a trailing newline for clean diffs
