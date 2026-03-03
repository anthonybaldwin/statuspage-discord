# statuspage-discord

A Bun-based Discord bot that:

- polls one or more Statuspage pages and groups each incident into its own Discord thread
- answers slash-command status questions with the current page health
- supports replay and preview flows so you can test notifications without waiting for a live incident

| 🚨 | 🧵 | 📌 | `/status` |
  |---|---|---|---|
  | <a href="https://github.com/user-attachments/assets/39b6ee5d-851b-42ea-b828-5c2aed2d54a7" target="_blank"><img width="160" alt="image" src="https://github.com/user-attachments/assets/39b6ee5d-851b-42ea-b828-5c2aed2d54a7" /></a> | <a href="https://github.com/user-attachments/assets/65c101c1-20ba-4c0a-83e0-c79266e274d4" target="_blank"><img width="120" alt="image" src="https://github.com/user-attachments/assets/65c101c1-20ba-4c0a-83e0-c79266e274d4" /></a> | <a href="https://github.com/user-attachments/assets/c6e762a4-2770-4149-adaa-7d01484cc316" target="_blank"><img width="140" alt="image" src="https://github.com/user-attachments/assets/c6e762a4-2770-4149-adaa-7d01484cc316" /></a> | <a href="https://github.com/user-attachments/assets/f9e32a7c-b167-4bd9-91aa-b99064f8a899" target="_blank"><img width="200" alt="image" src="https://github.com/user-attachments/assets/f9e32a7c-b167-4bd9-91aa-b99064f8a899" /></a> |

## Environment

Copy `.env.example` to `.env` and fill in:

- `DISCORD_TOKEN`: bot token
- `DISCORD_APPLICATION_ID`: Discord application ID
- `DISCORD_GUILD_ID`: optional; if set, commands register to one guild for fast iteration
- `DISCORD_CHANNEL_ID`: legacy single-monitor text channel where updates should be posted
- `STATUSPAGE_BASE_URL`: legacy single-monitor public Statuspage URL, for example `https://status.atlassian.com`
- `STATUSPAGE_MONITORS_JSON`: optional JSON array for multiple monitor targets; each object needs `id`, `channelId`, `baseUrl`, and optional `label`
- `POLL_INTERVAL_MS`: optional, defaults to `60000`
- `POST_EXISTING_UPDATES_ON_START`: optional, defaults to `false`; when `true`, the bot will backfill currently visible incident updates on first run
- `ENABLE_STATUS_COMMAND`: optional, defaults to `true`
- `ENABLE_TEST_COMMAND`: optional, defaults to `true`
- `ENABLE_REPLAY_COMMAND`: optional, defaults to `true`
- `ENABLE_CLEAN_COMMAND`: optional, defaults to `true`
- `ENABLE_MONITOR_COMMAND`: optional, defaults to `true`; enables the `/monitor` command for adding/removing monitors at runtime

Example multi-monitor config:

```env
STATUSPAGE_MONITORS_JSON=[{"id":"atlassian","channelId":"123456789012345678","baseUrl":"https://status.atlassian.com","label":"Atlassian"},{"id":"claude","channelId":"234567890123456789","baseUrl":"https://status.claude.com","label":"Claude"}]
```

## Commands

- `/status [target]`: show the current page status and active incidents
- `/testpost [target]`: post the current status snapshot into the configured channel without marking any update as sent
- `/replay [target]`: replay each active incident timeline into the relevant thread when enabled
- `/clean [limit]`: delete recent bot-authored messages in the current channel when enabled
- `/monitor add <url> [channel] [label] [id]`: add a new Statuspage monitor at runtime (requires **Manage Server**)
- `/monitor remove <id>`: remove a runtime monitor — env-configured monitors are protected (requires **Manage Server**)
- `/monitor list`: list all monitors with their source (`env` or `runtime`), URL, and channel (requires **Manage Server**)

## Run

```bash
bun install
bun dev
```

Or run without watch mode:

```bash
bun start
```

## Docker Compose

The simplest way to run in production. Secrets stay in your host-side `.env` and are injected at runtime via `env_file` — they are never copied into the image.

```bash
docker compose up -d
```

State persists in the `statuspage_data` named volume across restarts and container recreations (e.g. image updates via WUD or Watchtower).

## Docker (manual)

Build the image:

```bash
docker build -t statuspage-discord .
```

Run it with your local `.env` passed at runtime:

```bash
docker run --rm --env-file .env -v statuspage_data:/app/data statuspage-discord
```

A prebuilt image is also available from the GitHub Container Registry:

```bash
docker pull ghcr.io/anthonybaldwin/statuspage-discord:main
```

## Notes

- Posted incident update IDs are persisted in `data/state.json`.
- Runtime monitors added via `/monitor add` are persisted in `data/monitors.json` and survive restarts.
- Incident parent message IDs and thread IDs are persisted in `data/state.json`.
- The bot uses the public Statuspage API under `<base-url>/api/v2/...`, so a public page URL is enough.
- For development, setting `DISCORD_GUILD_ID` makes slash-command registration update faster than global commands.
- On first startup, the bot seeds current incident-update IDs without posting them unless `POST_EXISTING_UPDATES_ON_START=true`.
- New incidents create one parent message in the configured channel and a thread for follow-up updates. The parent message is pinned while the incident is active and unpinned when resolved.
- When multiple monitors are configured, command `target` values map to the monitor `id` fields.
- The bot needs permission to create and send messages in threads if you want incident threads to work. It also needs the Manage Messages permission to pin/unpin incident messages.
- For Docker, keep secrets in a host-side `.env` and pass them with `--env-file` instead of copying them into the image.
