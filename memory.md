# memory.md — Anyway living state

Read at the start of every session; update at the end of every session/milestone.

## Current state
- **Project:** Anyway — prescription-and-logging PWA for a fixed 6-month training programme (one user, injury-constrained, mid-session one-handed logging).
- **Phase:** Building. Doc chain complete (`docs/vision.md`, `docs/programme.md`, `docs/prd.md`, `docs/architecture.md`, `docs/implementation-plan.md`). **M0 done.**
- **Repo:** `ajayrajen7/anyway`, started empty this session. `app/` = Vite+React+TS frontend, `server/` = Go+chi+SQLite backend.
- **Relationship to `phayalman`:** deliberately a separate repo/stack, not shared code. Stacks diverge almost completely (Next.js/Supabase/Postgres/server-truth vs. Vite/Go/SQLite/local-truth-offline-first) — see the session where this was decided for the full reasoning. What *was* carried over: the CLAUDE.md/memory.md operating contract, the doc-map convention, Zod-at-boundaries discipline, TDD-per-milestone discipline. No code or libraries shared.

### Milestone status
- **M0 ✅ Scaffold.**
  - `app/`: Vite + React 19 + TS (strict, `erasableSyntaxOnly`) + Tailwind v4 (CSS-first, no config file needed) + `vite-plugin-pwa` (manifest + generated placeholder icons — **real icons still needed**, see Open items) + Dexie schema shell (`src/lib/db.ts`) + Zod types mirroring the server schema (`src/lib/types.ts`) + bearer-token API client shell (`src/lib/api.ts`) + `react-router-dom` with all 9 routes from `prd.md` §A3 stubbed. Vitest + Testing Library wired; 2 smoke tests green. `npm run typecheck` / `lint` (oxlint) / `test` / `build` all green.
  - `server/`: Go 1.25 (toolchain auto-upgraded from 1.24.7 on `go get` — modernc.org/sqlite requires ≥1.25) + chi router + `modernc.org/sqlite`. Schema migration (`internal/db/migrations/0001_init.sql`) copied verbatim from architecture §B3, applied via `go:embed` + idempotent `CREATE TABLE IF NOT EXISTS`. Bearer-token middleware (`ANYWAY_API_TOKEN`) gates all of `/api/*`; `/healthz` is open. Every `/api/*` route from §B5 is wired but stubbed (501) so the frontend has real endpoints to point at immediately, none of them lying about being implemented. `go vet` / `go test ./...` / `go build ./...` all green; manually smoke-tested the running binary end-to-end (healthz 200, unauthed 401, authed-stub 501).
  - Root: `docs/` (5 files), `CLAUDE.md`, `memory.md`, `.gitignore`, `README.md`, CI (`.github/workflows/ci.yml` — lint+typecheck+test+build for `app/`, vet+test+build for `server/`).
  - Note: no monorepo tool (Turborepo/Nx) — two independent projects (`app/`, `server/`) is simple enough at this size; revisit only if that becomes false.
- **M1 ✅ Exercise library.**
  - `seed/exercises.json`: 89 entries — the 75 usable exercises from `prd.md` §A5.4 (transcribed table-by-table, verified by script: correct per-category counts, all muscle names canonical, no duplicate slugs) + 14 blocked (the 12 contraindicated rows in §A5.3, with "Running / skipping / burpee" split into 3 separately-searchable blocked entries since each needs its own slug/reason). Cross-checked: all 50 exercise slugs referenced by the §A5.5 swap table already resolve against this file, so M2 has no missing-slug surprises waiting.
  - `increment_kg` assigned by equipment per §A3.3's rule (machine=5, band/bodyweight=1, everything else=2.5) — not stated per-exercise in the source table, so this is a documented inference, not a transcription.
  - `server/internal/seed/`: `ParseFile` (validates pressure/impact enums, canonical muscle names, no dup slugs, blocked⇒block_reason present — fails loudly with the offending slug) + `Apply` (idempotent upsert by slug, replaces muscle rows) + `List` (search + blocked filtering for the API). `server/cmd/seed`: re-runnable CLI (`go run ./cmd/seed --db=... --file=...`).
  - `GET /api/exercises?q=&include_blocked=1` now real (was a 501 stub): excludes blocked by default, but a search matching a blocked exercise still returns it *with its reason* rather than hiding it — required by the swap-sheet "explain, don't hide" rule (§A3.4), tested at both the seed-package and HTTP-handler level.
  - **Bug found and fixed while building this**: `db.Open` handed `:memory:` test databases a fresh connection pool by default, and each new connection to `sqlite://:memory:` is its own separate database — migrations landed on one connection, queries ran against another, tables "didn't exist." Fixed with `SetMaxOpenConns(1)` (also just correct for a single-user SQLite server generally). That in turn meant `List`'s original per-row nested query for muscle weights would've deadlocked (an open outer `Rows` holds the one connection). Rewrote `List` to close the exercises query before issuing the muscles query, batching the muscle lookup in one pass instead of N+1. All caught by tests before reaching a smoke test.
  - `go vet` / `go test ./...` / `go build ./...` green. Manually smoke-tested end-to-end: seeded the real file into a temp DB, hit the live server — 75 exercises by default, 89 with `include_blocked=1`, `q=burpee&include_blocked=1` returns exactly the blocked burpee row with its reason.
- **M2–M10:** not started. See `docs/implementation-plan.md`. Next up is **M2 — Phase 1 programme seed**: `phases`/`day_templates`/`slots`/`slot_swaps` from `programme.md` Phase 1 + the swap table in `prd.md` §A5.5 (slugs already verified to resolve, per M1 note above).

## Decision log (settled — with rationale)
- **Separate repo from `phayalman`, not a monorepo or shared code.** State-management philosophy is inverted (server-truth-recompute vs. local-truth-offline-first) and the backend language differs entirely (TS vs. Go) — sharing code would mean fighting one architecture or the other continuously. Only the process/doc conventions carried over.
- **No monorepo tooling for `app/` + `server/`.** Two npm/go projects side by side is sufficient at this size.
- **Go toolchain floats to whatever `modernc.org/sqlite` needs** (currently pins `go 1.25.0` in `go.mod` after `go mod tidy`); the sandbox auto-downloaded it via `GOTOOLCHAIN=auto` without issue.
- **Migrations live under `server/internal/db/migrations/`**, not a top-level `migrations/` — `go:embed` cannot reach outside its containing package directory, so the path in `architecture.md` §B3's prose is illustrative, not literal.

## Open items
- **Real PWA icons.** Current `app/public/pwa-192.png` / `pwa-512.png` are solid-color placeholders generated by a throwaway script (no image tooling was available in-session) — replace before this is installed on a phone.
- **iOS local notification approach for the 07:00 morning check (M6)** needs a spike; PWA notification support on iOS has real constraints not yet investigated.
- **Hosting target (Fly.io vs. VPS)** deferred to M9/M10.
- The seed file's per-exercise `increment_kg` values (M1) were inferred from the equipment-based rule in §A3.3, not stated explicitly per-exercise in the source doc — worth a glance if any specific exercise's increment feels wrong once you're actually using it.

## Deviations from spec
- None yet beyond the migrations-path note above (logged as a decision, not a deviation from product/architecture intent).
