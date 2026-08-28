# Anyway

A prescription-and-logging PWA for one person following a fixed 6-month training programme. Built around a delayed/cumulative pain signal, sub-2-second mid-session logging, and deliberate withholding of outcome numbers. See `docs/vision.md` for the why.

## Layout

- `app/` — Vite + React + TypeScript PWA frontend. Offline-first: the session runner reads/writes IndexedDB (Dexie) only.
- `server/` — Go + chi + SQLite backend. Single static bearer-token auth, one user.
- `docs/` — the spec (vision, programme, PRD, architecture, implementation plan). Authoritative — see `CLAUDE.md`.

## Quick start

```sh
# frontend
cd app && npm install && cp .env.example .env.local && npm run dev

# backend
cd server && ANYWAY_API_TOKEN=devtoken go run ./cmd/server
```

The server also runs a nightly `VACUUM INTO` backup (docs/architecture.md §B2) — `ANYWAY_BACKUP_DIR` (default `backups`), `ANYWAY_BACKUP_HOUR` (default `3`, local time), `ANYWAY_BACKUP_KEEP` (default `30`, oldest pruned first). No off-box copy is wired up yet — see `server/internal/backup`'s doc comment and `memory.md`.

## Deploying

Hosting is **Render**, one binary embedding the built frontend (no separate frontend host, no CORS needed in production — decided alongside M10, see `memory.md`; Fly.io was the original choice but its dashboard had a persistent login bug at setup time, so this moved to Render instead — also logged in `memory.md`). The build happens in **GitHub Actions** (`.github/workflows/deploy.yml`), not from a local machine or Render itself — this repo's own Claude Code session couldn't reach either platform's API (its network is allowlisted), and a CI-built image is more repeatable anyway. The pipeline: GitHub Actions builds the Docker image and pushes it to `ghcr.io/<this repo>` (**private** — it embeds `ANYWAY_API_TOKEN` inside the frontend JS bundle, so a public image would let anyone `docker pull` it and extract the token), then pings a Render "Deploy Hook" URL to have Render pull and run the new image.

**One-time setup:**

1. **Create the Render service** (render.com → New → Web Service → "Existing Image"):
   - Image: `ghcr.io/<owner>/<repo>:latest` (push once via the GitHub Action first — see step 3 — so the tag exists before Render's first pull)
   - Since the image is private, add a **registry credential** under Render's Account Settings → Credentials: a GitHub Personal Access Token with the `read:packages` scope, for Render to authenticate the pull
   - Add a **1GB persistent disk** mounted at `/data`
   - Environment variables: `ANYWAY_ADDR=:8080`, `ANYWAY_DB_PATH=/data/anyway.db`, `ANYWAY_BACKUP_DIR=/data/backups`, `ANYWAY_BACKUP_HOUR=3`, `ANYWAY_BACKUP_KEEP=30`, and a secret `ANYWAY_API_TOKEN` set to the **same value** you'll use as the GitHub secret below
   - Health check path: `/healthz`
   - Once created, copy the service's **Deploy Hook URL** (Settings → Deploy Hook)

2. **In this repo's Settings → Secrets and variables → Actions → Secrets**, add:
   - `ANYWAY_API_TOKEN` — the same random string you set on Render above
   - `RENDER_DEPLOY_HOOK_URL` — the URL from step 1 (add it as a secret, not pasted into chat or committed — it can trigger arbitrary redeploys of your service)

3. Push to `main`, or trigger the workflow manually from the Actions tab.

To sanity-check the exact artifact locally without Docker or a host at all:
```sh
ANYWAY_API_TOKEN=<token> ./scripts/build-embedded.sh
./server/anyway-server   # serves both the PWA and the API on ANYWAY_ADDR
```

`ANYWAY_API_TOKEN` is visible in the deployed page's JS source to anyone who finds the URL — an accepted limitation of the original spec's auth model (one user, not real auth), not something deployment introduces. See `memory.md`.

See `CLAUDE.md` for the full operating contract and `docs/implementation-plan.md` for build order and commands.
