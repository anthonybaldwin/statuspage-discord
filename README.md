# statuspage-discord

A Bun-based Discord bot that:

- polls one or more public status pages (Statuspage.io and incident.io are supported) and groups each incident into its own Discord thread
- answers slash-command status questions with the current page health
- supports replay and preview flows so you can test notifications without waiting for a live incident

Supported providers are auto-detected at `/monitor add` time — drop in any public Statuspage.io URL (e.g. `https://status.atlassian.com`) or any public incident.io URL (e.g. `https://status.openai.com`) and the bot picks the right adapter.

| 🚨 | 🧵 | 📌 | `/status` |
  |---|---|---|---|
  | <!-- img --> | <!-- img --> | <!-- img --> | <!-- img --> |

## Quick Start

```bash
cp .env.example .env      # Fill in DISCORD_TOKEN, DISCORD_APPLICATION_ID, etc.
bun install
bun dev                    # Watch mode (or `bun start` for production)
```

## Docker

```bash
docker compose up -d       # Production deployment with Docker Compose
```

A prebuilt image is available at `ghcr.io/anthonybaldwin/statuspage-discord:main`.

## Documentation

Full docs live in the [wiki](https://github.com/anthonybaldwin/statuspage-discord/wiki):

| Page | Description |
|------|-------------|
| [Architecture](https://github.com/anthonybaldwin/statuspage-discord/wiki/Architecture) | System design, data flow, and module structure |
| [Configuration](https://github.com/anthonybaldwin/statuspage-discord/wiki/Configuration) | Environment variables, multi-monitor setup, feature flags |
| [Commands](https://github.com/anthonybaldwin/statuspage-discord/wiki/Commands) | All slash commands with usage and permissions |
| [Incident Lifecycle](https://github.com/anthonybaldwin/statuspage-discord/wiki/Incident-Lifecycle) | How incidents are tracked from creation to resolution or removal |
| [State Management](https://github.com/anthonybaldwin/statuspage-discord/wiki/State-Management) | Persistence format, migration, and locking |
| [API Integration](https://github.com/anthonybaldwin/statuspage-discord/wiki/API-Integration) | Supported providers, endpoints, and how to add a new provider |
| [Deployment](https://github.com/anthonybaldwin/statuspage-discord/wiki/Deployment) | Docker, Docker Compose, CI/CD, and production notes |
| [Development](https://github.com/anthonybaldwin/statuspage-discord/wiki/Development) | Local setup, tooling, and contribution guide |
| [Contributing](https://github.com/anthonybaldwin/statuspage-discord/wiki/Contributing) | How to contribute, code conventions, and documentation rules |

## Notes

- The bot uses public APIs only — Statuspage.io's v2 API (`<base-url>/api/v2/...`) or incident.io's widget proxy (`<base-url>/proxy/<host>`) — so a public page URL is all you need.
- For development, setting `DISCORD_GUILD_ID` makes slash-command registration update faster than global commands.
- On first startup, the bot seeds current incident-update IDs without posting them unless `POST_EXISTING_UPDATES_ON_START=true`.
- The bot needs Send Messages, Embed Links, Create Public Threads, and Manage Messages permissions.
