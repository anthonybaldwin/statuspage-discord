# statuspage-discord

A Bun-based Discord bot that monitors public status pages — [Statuspage.io](https://www.atlassian.com/software/statuspage) and [incident.io](https://incident.io/) are supported — and posts incident updates to Discord as threaded conversations.

## What It Does

- **Polls** one or more public status pages on a configurable interval (auto-detects provider)
- **Creates Discord threads** for each incident, posting updates as they arrive
- **Pins** active incidents and unpins them when resolved
- **Ghosts** incidents that vanish from the API (strikethrough + grey)
- **Tracks open incidents** server-side for reliable ghost detection
- Provides **slash commands** for status checks, replays, cleanup, and runtime monitor management

## Wiki Pages

| Page | Description |
|------|-------------|
| [Architecture](Architecture.md) | System design, data flow, and module structure |
| [Configuration](Configuration.md) | Environment variables, multi-monitor setup, feature flags |
| [Commands](Commands.md) | All slash commands with usage and permissions |
| [Incident Lifecycle](Incident-Lifecycle.md) | How incidents are tracked from creation to resolution or deletion |
| [State Management](State-Management.md) | Persistence format, migration, and locking |
| [API Integration](API-Integration.md) | Supported providers, endpoints, and how to add a new provider |
| [Deployment](Deployment.md) | Docker, Docker Compose, CI/CD, and production notes |
| [Development](Development.md) | Local setup, tooling, and contribution guide |
| [Contributing](Contributing.md) | How to contribute, code conventions, and documentation rules |

## Quick Start

```bash
cp .env.example .env    # Fill in DISCORD_TOKEN, DISCORD_APPLICATION_ID, etc.
bun install
bun dev                 # Watch mode
```

Or with Docker:

```bash
docker compose up -d
```

See [Configuration](Configuration.md) and [Deployment](Deployment.md) for details.
