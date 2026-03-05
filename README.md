# statuspage-discord

A Bun-based Discord bot that:

- polls one or more Statuspage pages and groups each incident into its own Discord thread
- answers slash-command status questions with the current page health
- supports replay and preview flows so you can test notifications without waiting for a live incident

| 🚨 | 🧵 | 📌 | `/status` |
  |---|---|---|---|
  | <a href="https://github.com/user-attachments/assets/39b6ee5d-851b-42ea-b828-5c2aed2d54a7" target="_blank"><img width="160" alt="image" src="https://github.com/user-attachments/assets/39b6ee5d-851b-42ea-b828-5c2aed2d54a7" /></a> | <a href="https://github.com/user-attachments/assets/65c101c1-20ba-4c0a-83e0-c79266e274d4" target="_blank"><img width="120" alt="image" src="https://github.com/user-attachments/assets/65c101c1-20ba-4c0a-83e0-c79266e274d4" /></a> | <a href="https://github.com/user-attachments/assets/c6e762a4-2770-4149-adaa-7d01484cc316" target="_blank"><img width="140" alt="image" src="https://github.com/user-attachments/assets/c6e762a4-2770-4149-adaa-7d01484cc316" /></a> | <a href="https://github.com/user-attachments/assets/f9e32a7c-b167-4bd9-91aa-b99064f8a899" target="_blank"><img width="200" alt="image" src="https://github.com/user-attachments/assets/f9e32a7c-b167-4bd9-91aa-b99064f8a899" /></a> |

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
| [API Integration](https://github.com/anthonybaldwin/statuspage-discord/wiki/API-Integration) | Statuspage API endpoints and response handling |
| [Deployment](https://github.com/anthonybaldwin/statuspage-discord/wiki/Deployment) | Docker, Docker Compose, CI/CD, and production notes |
| [Development](https://github.com/anthonybaldwin/statuspage-discord/wiki/Development) | Local setup, tooling, and contribution guide |
| [Contributing](https://github.com/anthonybaldwin/statuspage-discord/wiki/Contributing) | How to contribute, code conventions, and documentation rules |

## Notes

- The bot uses the public Statuspage API under `<base-url>/api/v2/...`, so a public page URL is enough.
- For development, setting `DISCORD_GUILD_ID` makes slash-command registration update faster than global commands.
- On first startup, the bot seeds current incident-update IDs without posting them unless `POST_EXISTING_UPDATES_ON_START=true`.
- The bot needs Send Messages, Embed Links, Create Public Threads, and Manage Messages permissions.
