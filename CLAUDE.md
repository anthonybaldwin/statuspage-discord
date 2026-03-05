# CLAUDE.md

Instructions for Claude Code when working on this project.

## Project Overview

statuspage-discord is a Bun-based Discord bot that polls Statuspage.io pages and posts incident updates as threaded conversations in Discord. It supports multiple monitors, runtime monitor management, and persistent state.

## Tech Stack

- **Runtime:** Bun
- **Language:** TypeScript (strict mode)
- **Dependencies:** discord.js, zod
- **Deployment:** Docker (Alpine-based), Docker Compose, GHCR

## Project Structure

```
src/index.ts              # All bot logic (~1700 lines, single file)
data/state.json           # Runtime state (git-ignored, auto-created)
data/monitors.json        # Runtime monitors (git-ignored, auto-created)
docs/wiki/                # GitHub-style wiki documentation
  Home.md                 # Wiki landing page
  Architecture.md         # System design and data flow
  Configuration.md        # Environment variables and setup
  Commands.md             # Slash command reference
  Incident-Lifecycle.md   # How incidents are tracked and displayed
  State-Management.md     # Persistence format and behavior
  API-Integration.md      # Statuspage API usage
  Deployment.md           # Docker, CI/CD, production notes
  Development.md          # Local setup and contribution guide
```

## Build & Run

```bash
bun install               # Install dependencies
bun dev                   # Watch mode
bun start                 # Production run
bun run tsc --noEmit      # Type-check
docker compose up -d      # Docker deployment
```

## Documentation Maintenance (MANDATORY)

**Every commit that changes behavior, configuration, commands, or architecture MUST include corresponding updates to:**

1. **`docs/wiki/`** — Update the relevant wiki page(s). If a new concept is introduced, add it to the appropriate page or create a new one and link it from `Home.md`.
2. **`README.md`** — Keep the environment variable list, command reference, and usage examples in sync.
3. **`CLAUDE.md`** (this file) — Update the project structure, key patterns, or any instructions that change.

### When to update what:

| Change | Update |
|--------|--------|
| New/changed env variable | `README.md`, `Configuration.md`, `.env.example`, `CLAUDE.md` (if structural) |
| New/changed command | `README.md`, `Commands.md`, `Development.md` (adding a command guide) |
| Incident lifecycle change | `Incident-Lifecycle.md`, `Architecture.md` |
| State format change | `State-Management.md` |
| New dependency | `Architecture.md` (dependencies table) |
| Deployment change | `Deployment.md`, `README.md` |
| API integration change | `API-Integration.md` |
| New file or structural change | `CLAUDE.md` (project structure), `Architecture.md` |

## Key Patterns

### Single-File Architecture
All logic is in `src/index.ts`. Functions are ordered by dependency (callees above callers). Don't split into modules unless the file exceeds ~3000 lines.

### Error Handling
- Use specific `DiscordAPIError` codes (10003, 10008, 50001) for state cleanup
- Never catch-all delete state on generic errors — only on confirmed missing Discord resources
- Log and skip on transient failures; the next poll cycle will retry

### State Management
- State is read at the start of a poll cycle and written at the end
- `openIncidentIds` tracks what the bot considers "open" for ghost detection
- `postedUpdateIds` is capped at 500 entries per monitor
- Runtime monitors use a promise-chain lock for safe concurrent writes

### Embed Rendering
- All embeds are built by `render*()` functions
- Color is derived from impact/status using `impactColor()` and `statusColor()`
- Removed/ghosted incidents use `MISSING_INCIDENT_COLOR` (grey) with strikethrough text
- Favicons are cached at startup in the `monitorIcons` Map

### Incident Lifecycle
- New incident → parent embed + thread + pin
- Update → post to thread + sync parent
- Resolved → unpin + archive thread
- Vanished from API → ghost (grey + strikethrough) + archive thread

### Command Pattern
Every command handler follows:
1. Check feature flag
2. `deferReply({ flags: MessageFlags.Ephemeral })`
3. Resolve monitor target
4. Assert channel access
5. Perform action
6. `editReply()` with result

## Environment Variables

See `.env.example` for the full list. Key ones:
- `DISCORD_TOKEN`, `DISCORD_APPLICATION_ID` (required)
- `STATUSPAGE_MONITORS_JSON` or `DISCORD_CHANNEL_ID` + `STATUSPAGE_BASE_URL`
- `POLL_INTERVAL_MS` (default 60000)
- `ENABLE_*_COMMAND` feature flags (all default true)

## CI/CD

- Docker image built on push to `main` (multi-arch: ARM64 + AMD64)
- Dependabot updates weekly for npm, Docker, and GitHub Actions
- Lockfile auto-regenerated on Dependabot PRs
