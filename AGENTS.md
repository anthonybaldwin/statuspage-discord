# AGENTS.md

Instructions for AI coding agents working on this project. **All agents MUST read and follow this file.** Update it whenever project structure, patterns, or conventions change.

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
AGENTS.md                 # Agent instructions (cross-tool)
CLAUDE.md                 # Claude-specific instructions (points here)
CONTRIBUTING.md           # Symlink → docs/wiki/Contributing.md
docs/wiki/                # GitHub-style wiki documentation
  Home.md                 # Wiki landing page
  Architecture.md         # System design and data flow
  Configuration.md        # Environment variables and setup
  Commands.md             # Slash command reference
  Contributing.md         # How to contribute and code conventions
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
2. **`README.md`** — Keep Quick Start, Docker, and documentation links in sync.
3. **`AGENTS.md`** (this file) — Update the project structure, key patterns, or any instructions that change.

### When to update what:

| Change | Update |
|--------|--------|
| New/changed env variable | `README.md`, `Configuration.md`, `.env.example`, `AGENTS.md` (if structural) |
| New/changed command | `README.md`, `Commands.md`, `Development.md` (adding a command guide) |
| Incident lifecycle change | `Incident-Lifecycle.md`, `Architecture.md` |
| State format change | `State-Management.md` |
| New dependency | `Architecture.md` (dependencies table) |
| Deployment change | `Deployment.md`, `README.md` |
| API integration change | `API-Integration.md` |
| New file or structural change | `AGENTS.md` (project structure), `Architecture.md` |

## Key Patterns

### Single-File Architecture
All logic is in `src/index.ts`. Functions are ordered by dependency (callees above callers). Don't split into modules unless the file exceeds ~3000 lines.

### Error Handling
- Use `isDiscordCleanupError()` helper for Discord state cleanup (consolidates codes 10003, 10008, 50001, 50013, 50035)
- Never catch-all delete state on generic errors — only on confirmed missing Discord resources
- Statuspage API calls use `retryWithBackoff` (3 attempts, exponential: 1s/2s/4s) for transient errors (network failures, HTTP 429/500/502/503/504). Permanent errors fail immediately.
- Thread archive/unarchive failures are logged but non-fatal

### State Management
- State is saved after each monitor processes (not just at the end of the full cycle) to prevent partial loss
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
- `ENABLE_*_COMMAND` feature flags (all default true, includes `ENABLE_CLEANUP_COMMAND`)

## Git Workflow

### Branch Prefixes

```
feat/, fix/, chore/, perf/, refactor/, docs/, ci/
```

### PR Title Rules

- Use a clear, generic scope title that covers all commits in the PR.
- Do **not** use conventional commit prefixes in PR titles (`fix:`, `feat:`, `refactor:`, etc.).
- Use plain-language summary titles; commit messages provide release typing.
- Agents must keep the PR title current as commits are added.
- Agents must keep the PR description current as commits are added or removed.
- If the PR is no longer single-scope/single-type, update to a shared summary title.

### PR Description Rules

- Include a short summary of what changed and why.
- Keep the description current when adding/removing commits.
- Note any workflow/deploy impact when relevant.

### Commit Message Format

Use [Conventional Commits](https://conventionalcommits.org):

```
<type>(<scope>): <short summary>
```

Allowed types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `perf`, `ci`

Rules:
- Use imperative tense ("add feature", not "added feature").
- Keep subject line under ~72 characters.
- Use scope when meaningful (e.g., `fix(polling): handle 429 rate limits`).
- Add a body for **why** / risk / validation when the subject alone isn't sufficient.
- Commit message bodies must use real newlines, not escaped `\n` sequences.

### Commit Hygiene

- Keep only commits that should reach `main`; drop experimental/no-op commits before merge.
- Squash or fixup branch commits when it improves clarity and reduces noise.
- Keep commit subjects meaningful — release labels are inferred from commit messages.
- Commit after every meaningful change; avoid massive "everything changed" commits.

### Git Staging

Always stage files explicitly by name. Never use `git commit -am`, `git add -A`, or `git add .`. Only stage the files you actually modified for the current task.

### Shell Notes (PR Body)

- Never use `--body @-` with a heredoc for `gh pr create` or `gh pr edit` — in bash-on-Windows the body becomes the literal string `@-`.
- Always pass PR body content directly via `--body '...'` (single-quoted string).

### Merge Strategy

```bash
gh pr merge --rebase --delete-branch
```

## CI/CD

- Docker image built on push to `main` (multi-arch: ARM64 + AMD64)
- Dependabot updates weekly for npm, Docker, and GitHub Actions
- Lockfile auto-regenerated on Dependabot PRs
