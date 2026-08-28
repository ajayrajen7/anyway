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

Hosting is **Railway**, one binary embedding the built frontend (no separate frontend host, no CORS needed in production — decided alongside M10, see `memory.md`). Railway builds directly from this repo's `Dockerfile` on every push — no separate CI build step, no container registry, no deploy-hook plumbing. (Fly.io was the original choice, then Render — both changed for reasons unrelated to this repo's own code; see `memory.md` for the full trail.)

`ANYWAY_API_TOKEN` (architecture.md §B1's single static bearer token) is a **plain runtime environment variable**, not something baked into the build — the server injects it into the served page itself (`server/internal/webapp`). This was a deliberate design choice made once it turned out not every hosting dashboard supports passing custom Docker build arguments: a runtime env var is something every platform supports, so the exact same built image works regardless of host.

**One-time setup** (railway.app → New Project → Deploy from GitHub repo → this repo):
- Railway should detect the `Dockerfile` at the repo root automatically
- Add a **persistent volume** (Railway calls this a Volume), mounted at `/data`
- Environment variables: `ANYWAY_ADDR=:8080`, `ANYWAY_DB_PATH=/data/anyway.db`, `ANYWAY_BACKUP_DIR=/data/backups`, `ANYWAY_BACKUP_HOUR=3`, `ANYWAY_BACKUP_KEEP=30`, and `ANYWAY_API_TOKEN` (any random string you generate — this is the only value the frontend and backend need to agree on, and it's set here once, nowhere else)
- Health check path: `/healthz`

Push to `main` and Railway rebuilds and redeploys automatically from then on.

To sanity-check the exact artifact locally without Docker or a host at all:
```sh
./scripts/build-embedded.sh
ANYWAY_API_TOKEN=<token> ./server/anyway-server   # serves both the PWA and the API on ANYWAY_ADDR
```

`ANYWAY_API_TOKEN` is visible in the deployed page's JS source to anyone who finds the URL — an accepted limitation of the original spec's auth model (one user, not real auth), not something deployment introduces. See `memory.md`.

**Free tier will not work for real use** — this app needs data to persist across the whole 6-month programme, and every free tier we found (Render's included) either lacks persistent disks entirely or wipes them on restart. Some small paid tier with an attached volume (Railway's Hobby plan or equivalent) is the realistic floor. See `memory.md` for the tradeoff as discussed with the project owner.

See `CLAUDE.md` for the full operating contract and `docs/implementation-plan.md` for build order and commands.
