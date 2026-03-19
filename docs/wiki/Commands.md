# Commands

All commands are slash commands registered via the Discord API. Each can be individually enabled/disabled via [feature flags](Configuration.md#feature-flags).

## `/status [target]`

Show the current page status and active incidents.

- **Permission:** None (channel access check applies)
- **Response:** Ephemeral embed with overall status indicator, color-coded by severity, and a list of active incidents
- **Target resolution:** If `target` is omitted, resolves to all monitors matching the current channel, or the only configured monitor. Errors if ambiguous. When multiple monitors match, returns one embed per monitor.

## `/testpost [target]`

Post the current status snapshot into the configured channel as a visible message. Does **not** mark anything as sent in state.

- **Permission:** Manage Server
- **Response:** Ephemeral confirmation + visible status embed in the monitor's channel
- **Use case:** Verify embed rendering without affecting incident tracking

## `/replay [target]`

Replay active incident timelines into their threads.

- **Permission:** Manage Server
- **Response:** Ephemeral summary of replayed/skipped incidents
- **Behavior:**
  1. Fetches all active incidents from the API
  2. For each incident, checks for an existing thread
  3. Deduplicates against both tracked state and actual thread content (scans message footers for update IDs)
  4. Posts only missing updates, preserving chronological order
  5. Skips incidents that already have complete live threads
- **Use case:** Recover after state loss, manual cleanup, or to backfill a newly added monitor

## `/cleanup [target]`

Find and ghost dangling incident threads that are no longer in the Statuspage API.

- **Permission:** Manage Server
- **Response:** Ephemeral summary of ghosted incidents
- **Target resolution:** If `target` is omitted, cleans all monitors. Otherwise cleans only the specified monitor.
- **Behavior:**
  1. Fetches current incidents from the Statuspage API for each target monitor
  2. Identifies tracked incidents that are unresolved in state but absent from the API
  3. Ghosts them (grey embed + strikethrough text + unpin + archive thread)
  4. Syncs `openIncidentIds` from the API
- **Use case:** Remove dangling threads that persisted after incidents aged out of the API between polls

## `/clean [target] [limit]`

Delete recent bot-authored messages in the current channel.

- **Permission:** Manage Server
- **Channel:** Must be used in a configured monitor channel.
- **Target resolution:** If `target` is omitted, cleans all monitors in the channel. When a target is specified, only that monitor's threads and parent messages are removed.
- **Options:**
  - `limit` (integer, 1-100, default 100): How many recent messages to inspect
- **Behavior:**
  1. Deletes all incident threads and their bot-authored messages
  2. Bulk-deletes bot-authored channel messages (respects Discord's 14-day limit)
  3. Removes per-incident state entries; preserves monitor-level `postedUpdateIds` for resolved incidents (preventing re-post flooding) but strips them for active incidents (so they re-create threads on the next poll)
- **Use case:** Reset a channel after testing or reconfiguration

## `/monitor add <url> [channel] [label] [id] [icon_url]`

Add a new Statuspage monitor at runtime.

- **Permission:** Manage Server
- **Options:**
  - `url` (required): Public Statuspage URL (e.g. `https://status.atlassian.com`)
  - `channel` (optional): Target text channel; defaults to the current channel
  - `label` (optional): Display name for the monitor
  - `id` (optional): Unique monitor ID; auto-derived from the page name if omitted
  - `icon_url` (optional): Custom icon URL for embeds; overrides auto-detected favicon
- **Validation:**
  - Tests `<url>/api/v2/summary.json` to confirm a valid Statuspage
  - Checks bot permissions in the target channel
  - Rejects duplicate IDs or duplicate URLs (same Statuspage can only be tracked once per server; different statuspages in the same channel are allowed)
- **Side effects:**
  - Persists to `data/monitors.json`
  - Re-registers commands for updated autocomplete
  - Triggers an immediate first poll
  - Caches the page favicon (or `icon_url` override) for embed icons

## `/monitor remove <id>`

Remove a runtime-added monitor.

- **Permission:** Manage Server
- **Behavior:**
  - Environment-configured monitors are protected and cannot be removed
  - Existing threads are preserved; use `/clean` to remove them
  - Re-registers commands for updated autocomplete

## `/monitor list`

List all configured monitors with metadata.

- **Permission:** Manage Server
- **Response:** Ephemeral embed listing each monitor with:
  - Source (`env` or `runtime`)
  - URL and channel
  - Who added it and when (runtime monitors only)

## Autocomplete

- `/status`, `/testpost`, `/replay`, `/cleanup`, `/clean`: Autocompletes `target` from all configured monitors (ID and label)
- `/monitor remove`: Autocompletes `id` from runtime monitors only (env monitors are protected)
