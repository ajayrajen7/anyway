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

Hosting is Fly.io, one binary embedding the built frontend (no separate frontend host, no CORS needed in production — decided alongside M10, see `memory.md`). Deploys run in **GitHub Actions** (`.github/workflows/deploy.yml`), not from a local machine — Fly's API isn't reachable from every environment this project gets built in, and CI-driven deploys are more repeatable anyway.

**One-time setup**, in this repo's Settings → Secrets and variables → Actions:
- Secrets: `FLY_API_TOKEN` (a Fly.io deploy token, fly.io/user/personal_access_tokens) and `ANYWAY_API_TOKEN` (any random string you generate — the app's own single static bearer token, §B1; baked into the frontend build *and* set as the server's runtime secret, so both must come from this one value)
- Variables: `FLY_APP_NAME` (must be globally unique across all of Fly) and `FLY_REGION` (a Fly region code, e.g. `sin`, `bom`, `nrt`) — optionally `FLY_ORG` if your account has more than one org

Then push to `main`, or trigger the workflow manually from the Actions tab. The workflow creates the app, the persistent volume, and the runtime secret on first run (idempotently — safe to re-run), then deploys.

To sanity-check the exact artifact locally without Docker or Fly:
```sh
ANYWAY_API_TOKEN=<token> ./scripts/build-embedded.sh
./server/anyway-server   # serves both the PWA and the API on ANYWAY_ADDR
```

`ANYWAY_API_TOKEN` is visible in the deployed page's JS source to anyone who finds the URL — an accepted limitation of the original spec's auth model (one user, not real auth), not something deployment introduces. See `memory.md`.

See `CLAUDE.md` for the full operating contract and `docs/implementation-plan.md` for build order and commands.
