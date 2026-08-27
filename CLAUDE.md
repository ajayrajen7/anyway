# CLAUDE.md — Anyway build guide

Operating contract for Claude Code on this repo. **Read this and `memory.md` at the start of every session before touching code.** (This contract is carried over from the `phayalman` project's operating discipline — same process, different stack.)

## Start here, every session
1. Read `memory.md` (root) — current milestone, what's done/next, decisions already made, open items. **Don't relitigate decisions logged there.**
2. Read the doc(s) for the current milestone (map below) for *what* to build.
3. Work the current milestone only. End the session by updating `memory.md`.

## Doc map (the spec — authoritative)
- `docs/vision.md` — the *why*: the three constraints, durable principles, what "success" means here.
- `docs/programme.md` — the actual 6-month training/nutrition programme this app logs against. Source of truth for seed data (exercises, phases, day templates) — **transcribe exactly, don't approximate** (see architecture §B8).
- `docs/prd.md` — v1 scope: screens, flows, edge cases, the Vault, out-of-scope list.
- `docs/architecture.md` — build spec: stack (§B1), offline-first design (§B2), schema (§B3), the coverage query (§B4), API (§B5), frontend rules Claude Code must enforce (§B6), build order (§B7), named risks (§B8).
- `docs/implementation-plan.md` — milestones (M0–M10), TDD approach, commands.
- `memory.md` — living state + decision log (you maintain this).

## Operating rules
1. **Spec docs are the source of truth. Code never silently diverges.** If reality forces a change, update the relevant doc **and** log it in `memory.md` — don't just change code.
2. **TDD**, intensity scaled by risk (see implementation-plan.md). A milestone is done only when its tests pass. No new domain logic without a test.
3. **Offline-first is non-negotiable in `/session/*`.** The session runner reads/writes Dexie only and never awaits a network call. Every mutation appends to `outbox`. This is architecturally the opposite of a "fetch + recompute from server" app — don't reach for that pattern here.
4. **No focusable text input inside `/session/*`.** Steppers only (architecture §B6.1). This is a tested assertion, not a guideline.
5. **Absence is data, never defaulted.** An unlogged `morning_checks` day, a missed session — never insert a synthetic "none"/"missed-but-actually-fine" row to fill a gap.
6. **The Vault is enforced server-side.** No weight value renders anywhere, and `GET /api/weigh-ins` returns 423, until `start + 84 days` — checking only on the client is not compliant.
7. **Resist scope creep dressed as helpfulness.** Streaks, badges, encouragement copy, correlation/insight text, multi-week charts, rescheduling of missed days — all deliberately out per `prd.md` §A6 and `architecture.md` §B8. If it feels like an obvious improvement mid-build, it's probably one of these.
8. **Ask before:** architectural changes, scope beyond the current milestone, new dependencies, or changing anything in `docs/programme.md`'s exercise/muscle-weight/swap data (that data has real injury-safety weight — see the contraindicated list in `prd.md` §A5.3).
9. **End every session/milestone by updating `memory.md`** (state + any decisions + any deviations).

## Stack & conventions (architecture §B1)
- Frontend: Vite + React 19 + TypeScript (strict, `erasableSyntaxOnly`) in `app/`. Tailwind (v4, CSS-first config). Dexie (IndexedDB) — **source of truth during a session**, never mirrored server state. `react-router-dom` for the 9 routes in `prd.md` §A3. Zod at every boundary (API responses, anything read back out of Dexie after a schema bump).
- Backend: Go 1.25 + chi in `server/`. SQLite via `modernc.org/sqlite` (pure Go, no cgo), one file, durable backup not runtime dependency. Auth = single static bearer token (`ANYWAY_API_TOKEN`) — no user/session system, one user.
- Tests: Vitest + Testing Library (frontend units/components), Playwright (E2E, added M4+), Go's `testing` package (backend). MSW if/when the frontend needs to mock the API in tests.
- Schema changes = new file under `server/internal/db/migrations/`, `CREATE TABLE IF NOT EXISTS` style (idempotent, no separate migration ledger yet — see `db.go`).

## Commands
- Frontend (`app/`): `npm run dev` · `npm run typecheck` · `npm run lint` (oxlint) · `npm test` / `npm run test:watch` (Vitest) · `npm run build`
- Backend (`server/`): `go run ./cmd/server` · `go vet ./...` · `go test ./...` · `go build ./...`
- Env: copy `app/.env.example` → `app/.env.local` (`VITE_API_BASE`, `VITE_API_TOKEN`). Backend reads `ANYWAY_API_TOKEN` (required), `ANYWAY_DB_PATH`, `ANYWAY_ADDR` from the environment — no `.env` file on the server side yet (single-user, deployed by hand per `implementation-plan.md` M9/M10).
