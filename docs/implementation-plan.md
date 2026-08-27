# Implementation Plan — Anyway

Build order per `architecture.md` §B7, expanded into milestones. **Steps 1–5 (M1–M5) are a usable product** — ship those before M6–M10.

TDD discipline (carried over, adapted): failing test first → make it pass → refactor. Intensity is *rigorous* on the coverage math (§B4 query, weekly aggregation), the offline outbox/sync logic, and the Vault lock; *lighter* on screen-level UI — state + flow tests, not exhaustive. `go test` for the backend, Vitest + Testing Library for the frontend, Playwright for the one true end-to-end path (session runner, offline).

## Milestones

- **M0 — Scaffold.** ✅ Vite+React+TS+Tailwind PWA frontend (route stubs for all 9 screens, Dexie schema shell, API client shell). Go+chi+SQLite backend (schema migration applied verbatim from §B3, bearer-token middleware, all `/api/*` routes stubbed 501 so the frontend can point at a live server immediately). CI (lint+typecheck+test+build, both sides). Docs + CLAUDE.md + memory.md.
- **M1 ✅ Exercise library.** `seed/exercises.json` (75 usable + 14 blocked, §A5.4/A5.3) + `server/internal/seed` (parse/validate/upsert) + `server/cmd/seed` CLI + `GET /api/exercises` (search, excludes blocked unless `?include_blocked=1`, but a blocked search hit still returns with its reason). See `memory.md` for the pool-sizing bug caught along the way.
- **M2 — Phase 1 programme seed.** `phases`, `day_templates`, `slots`, `slot_swaps` seeded from `programme.md` Phase 1 + the swap table in `prd.md` §A5.5.
- **M3 — Today + session creation.** `GET /api/today`, the Today screen (§A3.2) incl. missed-day-doesn't-reschedule logic, cardio/mobility day flow (§A3.6).
- **M4 — Session runner (the core).** Offline-first from the start: Dexie reads/writes only, `outbox` append on every mutation, no network await. Set logging, pre-fill from last actual, rest timer, steppers only — **test that asserts no focusable text input exists in `/session/*`** (§B6.1).
- **M5 — Swap + add flows.** Tier-1/tier-2 swap (§A3.4), add-exercise with mandatory attribution (§A3.5), provenance recorded correctly in all four cases.
- **M6 — Morning check + notification.** Full-screen check (§A3.1), 07:00 local notification + 11:00 re-notify, absence-not-default enforced at the data layer.
- **M7 — Protein, mobility, cardio logging.**
- **M8 — Week view.** The §B4 coverage query (actual vs. prescribed by muscle group), volume, 7-day pain strip — single scroll view, no tabs (§B6.5), no chart beyond one week (§B6.6).
- **M9 — Offline outbox + sync + the Vault.** Background sync worker draining `outbox`, idempotent by client UUID, last-write-wins. Vault lock (§A4): `GET /api/weigh-ins` → 423 before `start+84d`, enforced server-side.
- **M10 — Export + nightly backup.** `GET /api/export`, nightly `VACUUM INTO` + off-box copy (§B2 — "the one unrecoverable failure mode").

## Commands

- Frontend (`app/`): `npm run dev` · `npm run typecheck` · `npm run lint` · `npm test` / `npm run test:watch` · `npm run build`
- Backend (`server/`): `go run ./cmd/server` · `go vet ./...` · `go test ./...` · `go build ./...`
- E2E: Playwright, added in M4 once the session runner exists (needs something worth testing offline).

## Open items / to decide when reached

- Local push notification mechanism for the 07:00/11:00 check (M6) — iOS PWA notification support needs a spike before committing to an approach.
- Hosting target (Fly.io vs. small VPS) — deferred to M9/M10, not needed until sync + backup exist.
