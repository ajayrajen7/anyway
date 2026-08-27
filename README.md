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

Hosting is Fly.io, one binary embedding the built frontend (no separate frontend host, no CORS needed in production — decided alongside M10, see `memory.md`).

```sh
# One-off local sanity check of the exact artifact Fly builds:
ANYWAY_API_TOKEN=<token> ./scripts/build-embedded.sh
./server/anyway-server   # serves both the PWA and the API on ANYWAY_ADDR

# Real deploy (after `fly launch`/`fly apps create` and `fly volumes create anyway_data -r <region> -s 1`):
fly deploy --build-arg ANYWAY_API_TOKEN=<token>
fly secrets set ANYWAY_API_TOKEN=<same token>
```

`ANYWAY_API_TOKEN` must be identical at build time (baked into the frontend bundle) and at runtime (the server's own secret) — see `docs/architecture.md` §B1: this is a single static bearer token by design (one user, not real auth), so it's visible in the deployed page's JS source to anyone who finds the URL. That's an accepted limitation of the original spec, not something deployment introduces — see `memory.md`.

See `CLAUDE.md` for the full operating contract and `docs/implementation-plan.md` for build order and commands.
