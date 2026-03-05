# Deployment

## Docker Compose (Recommended)

The simplest production deployment. Secrets stay in your host-side `.env` and are injected at runtime.

```bash
docker compose up -d
```

The `compose.yml` configures:
- `env_file: .env` for secret injection (never baked into the image)
- `statuspage_data` named volume mounted at `/app/data` for persistent state
- `restart: unless-stopped` for automatic recovery

State survives container restarts, recreations, and image updates (e.g., via [Watchtower](https://containrrr.dev/watchtower/) or [WUD](https://github.com/fmartinou/whats-up-docker)).

## Docker (Manual)

Build:

```bash
docker build -t statuspage-discord .
```

Run:

```bash
docker run --rm --env-file .env -v statuspage_data:/app/data statuspage-discord
```

## Prebuilt Image

A multi-arch image (ARM64 + AMD64) is published to GitHub Container Registry on every push to `main`:

```bash
docker pull ghcr.io/anthonybaldwin/statuspage-discord:latest
```

Tags:
- `latest` — current main branch
- `1.0.<run_number>` — incremental build number
- `v*` semver tags (when git-tagged)
- `sha-<commit>` — exact commit

## CI/CD

### Docker Build (`.github/workflows/docker.yml`)

Triggers on push to `main` or `v*` tags when source files change:
- `src/**`, `Dockerfile`, `.dockerignore`, `package.json`, `bun.lock`, `tsconfig.json`

Steps:
1. Checkout
2. Setup QEMU + Buildx (multi-platform)
3. Login to GHCR
4. Generate metadata tags
5. Build and push for `linux/arm64` and `linux/amd64`

Concurrency: cancels previous runs on the same branch.

### Lockfile Sync (`.github/workflows/lockfile.yml`)

When Dependabot opens a PR that changes `package.json`, this workflow automatically regenerates `bun.lock` and commits it back.

### Dependabot (`.github/dependabot.yml`)

Weekly updates for:
- npm dependencies (grouped)
- Docker base images
- GitHub Actions (grouped)

## Dockerfile Details

```dockerfile
FROM oven/bun:1.3.10-alpine
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src ./src
CMD ["bun", "src/index.ts"]
```

- Alpine base for minimal image size
- Frozen lockfile ensures reproducible builds
- Production flag skips devDependencies
- Only `src/` is copied (no dev files, docs, or tests)

## Production Considerations

- **Secrets:** Never bake `.env` or tokens into the Docker image. Use `env_file` or environment variables at runtime.
- **State volume:** Always mount `data/` as a persistent volume. Without it, the bot will re-seed on every restart and may re-post updates.
- **Polling interval:** The default 60s is a good balance. Lower intervals increase API load; higher intervals delay notifications.
- **Multiple instances:** Do not run multiple instances against the same Discord channel. They will fight over thread ownership and duplicate posts.
- **Logging:** The bot logs to stdout. Use `docker logs` or your container orchestrator's logging to monitor health.
