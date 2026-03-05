# Contributing

Thanks for your interest in contributing to statuspage-discord!

## Getting Started

1. **Open an issue** to discuss the change before starting work on anything non-trivial
2. **Fork the repo** and create a feature branch off `main`
3. **Set up your environment** — see the [Development](Development.md) page for local setup
4. **Make your changes**, ensuring they follow the conventions below
5. **Open a pull request** against `main`

## Code Conventions

### Single-File Architecture

All bot logic lives in `src/index.ts`. Functions are ordered by dependency (callees above callers). Do not split into separate modules unless the file exceeds ~3000 lines.

### Error Handling

- Use `isDiscordCleanupError()` for Discord state cleanup (codes 10003, 10008, 50001, 50013, 50035)
- Only clean up state on confirmed missing Discord resources — never on generic errors
- Statuspage API calls use `retryWithBackoff` for transient errors (network failures, HTTP 429/500/502/503/504)
- Thread archive/unarchive failures are logged but non-fatal

### Command Pattern

Every slash command handler follows this order:

1. Check feature flag
2. `deferReply({ flags: MessageFlags.Ephemeral })`
3. Resolve monitor target
4. Assert channel access
5. Perform action
6. `editReply()` with result

### TypeScript

- Strict mode is enabled
- Use Zod schemas for runtime validation of external data (env vars, API responses)
- Prefer explicit types over `any`

## Documentation Maintenance

**Every commit that changes behavior, configuration, commands, or architecture MUST include corresponding documentation updates.**

| Change | Update |
|--------|--------|
| New/changed env variable | `Configuration.md`, `.env.example`, `README.md` |
| New/changed command | `Commands.md`, `README.md` |
| Incident lifecycle change | `Incident-Lifecycle.md`, `Architecture.md` |
| State format change | `State-Management.md` |
| New dependency | `Architecture.md` (dependencies table) |
| Deployment change | `Deployment.md`, `README.md` |
| API integration change | `API-Integration.md` |
| New file or structural change | `AGENTS.md` (project structure), `Architecture.md` |

## Git Workflow

### Branch Naming

Use one of these prefixes:

```
feat/, fix/, chore/, perf/, refactor/, docs/, ci/
```

### Commit Message Format

Use [Conventional Commits](https://conventionalcommits.org):

```
<type>(<scope>): <short summary>
```

Allowed types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `perf`, `ci`

- Use imperative tense ("add feature", not "added feature")
- Keep subject line under ~72 characters
- Use scope when meaningful (e.g., `fix(polling): handle 429 rate limits`)
- Add a body for **why** / risk / validation when the subject alone isn't sufficient
- Keep commits focused — one logical change per commit
- If a commit touches code, include any required documentation updates in the same commit
- Keep only commits that should reach `main`; drop experimental/no-op commits before merge
- Squash or fixup branch commits when it improves clarity and reduces noise

### Pull Request Rules

- Use a clear, plain-language title that summarizes the overall PR scope
- Do **not** use conventional commit prefixes in PR titles (`fix:`, `feat:`, etc.)
- Include a short summary of what changed and why in the description
- Keep the title and description current as commits are added or removed

### Merge Strategy

PRs are merged with rebase:

```bash
gh pr merge --rebase --delete-branch
```

## Questions?

Open a [GitHub issue](https://github.com/anthonybaldwin/statuspage-discord/issues) or start a [discussion](https://github.com/anthonybaldwin/statuspage-discord/discussions).
