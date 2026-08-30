# Architecture — Anyway

> Build spec: stack, data model, flows, and invariants. See `prd.md` for product scope, `implementation-plan.md` for milestone order.

# PART B — ARCHITECTURE

## B1. Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | React 18 + Vite + TypeScript | Standard, well-supported by Claude Code |
| Styling | Tailwind | Fast, no design system needed |
| PWA | `vite-plugin-pwa` (Workbox) | Installable, offline shell |
| Local store | Dexie (IndexedDB) | **Source of truth during a session** |
| Backend | Go 1.22 + chi | Matches prior stack, single static binary |
| Database | SQLite via `modernc.org/sqlite` | Pure Go, no cgo, one file |
| Auth | Single static bearer token | One user. Do not build auth. |
| Hosting | Railway, SQLite on a persistent volume | decided post-M10 — see below and memory.md |

**Amendment (post-M10, deployment):** hosting is Railway (Fly.io and Render were tried first, in that order — both changed for reasons unrelated to this repo's own code; see memory.md for the full trail). The frontend and backend deploy as **one binary**, not two services — the Go server embeds the built `app/dist` output (`server/internal/webapp`, populated by `scripts/build-embedded.sh`/the `Dockerfile`'s multi-stage build) and serves it as the SPA fallback for anything `/api/*`/`/healthz` don't claim. This means production needs no CORS at all (the M9 `corsMiddleware` fix stays load-bearing only for local dev, where the two still run as separate `npm run dev`/`go run` processes on different ports) and only one thing to host, one HTTPS cert, one persistent volume. Railway builds the `Dockerfile` directly from the connected GitHub repo on every push — no separate CI build step or container registry.

`ANYWAY_API_TOKEN` (the row above) is supplied purely as a **runtime environment variable**, never baked into the frontend build — the server injects it into the served `index.html` itself (`server/internal/webapp#injectConfig`, read client-side by `app/src/lib/runtimeConfig.ts`). This was a deliberate design change once it turned out not every hosting platform's dashboard supports passing custom Docker build arguments (Render's didn't); a runtime env var is something every host supports, so the exact same built image now works unmodified regardless of where it runs.

Every free tier evaluated (Render's included) either has no persistent disk at all or discards it between restarts, which is fatal for an app whose entire point is a training log that survives a 6-month programme — some small paid tier with an attached volume is the realistic floor, discussed and confirmed with the project owner (memory.md).

A freshly-provisioned host's persistent volume starts out completely empty, and not every platform gives interactive shell access to run `cmd/seed`/`cmd/programme` by hand. `server/internal/bootstrap` auto-seeds the exercise library and Phase 1 programme on first boot instead, embedding the same `seed/*.json` files (copied in at build time, same `go:embed`-can't-reach-outside-its-package pattern as `internal/db`'s migrations and `internal/webapp`'s frontend). It checks each table independently and only ever seeds an empty one — once a phase exists it is never touched again, since `programme.Apply`'s wipe-and-reinsert strategy (§B7/M2) is unsafe once real `sessions` rows exist.

## B2. Offline-first — the non-negotiable

**Gym basements have no signal.** If the session runner requires network, the app is unusable on exactly the occasions it matters.

- The session runner reads from and writes to **IndexedDB only**. It never awaits a network call.
- Every mutation appends to a local `outbox` table.
- A background sync worker drains the outbox to the server when connectivity returns. Simple last-write-wins on `(entity, id)`; there is one user and one device, so conflict resolution is not a real problem.
  **Amendment (M9):** built as **foreground-only** — triggered on app mount and on the browser's `online` event (`src/main.tsx` → `src/lib/sync.ts`), not a true Service-Worker background sync. Same reasoning as M6's deferred push notifications: real background delivery has real cross-browser/iOS reliability constraints this sandboxed build can't verify against a device. Nothing is lost by this — the outbox already survives indefinitely offline (that's the whole point of §B2) — it just drains a little later than it theoretically could.
- Server SQLite is the durable backup, not the runtime dependency.
- **Nightly `VACUUM INTO` to a timestamped file, plus off-box copy.** Six months of data with no backup is the one unrecoverable failure mode here.
  **Amendment (M10):** the `VACUUM INTO` half is real (`server/internal/backup`, run nightly in its own goroutine from `cmd/server`, filenames sorting chronologically, oldest pruned beyond a configurable count). The **off-box copy half is deliberately not implemented** — it names a real destination (object storage, another host, ...) that was never specified, and picking one would be exactly the kind of unasked architectural assumption `CLAUDE.md` rule 4 says to surface instead. `backup.OffBoxCopy` is the extension point, `nil` for now; `RunNightly` logs plainly that off-box copy isn't configured on every run rather than silently pretending backups already leave the host. See `memory.md` (M10) — this is flagged as the actual open blocker for calling M10 fully done, not swept under a ✅.

## B3. Schema

```sql
CREATE TABLE exercises (
  id            INTEGER PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  equipment     TEXT NOT NULL,
  pressure      TEXT NOT NULL CHECK (pressure IN ('low','moderate','high')),
  impact        TEXT NOT NULL CHECK (impact IN ('none','low','high')),
  unilateral    INTEGER NOT NULL DEFAULT 0,
  increment_kg  REAL NOT NULL DEFAULT 2.5,
  blocked       INTEGER NOT NULL DEFAULT 0,
  block_reason  TEXT,
  caution       TEXT
);

CREATE TABLE exercise_muscles (
  exercise_id INTEGER NOT NULL REFERENCES exercises(id),
  muscle      TEXT NOT NULL,
  weight      REAL NOT NULL,
  PRIMARY KEY (exercise_id, muscle)
);

CREATE TABLE phases (
  id INTEGER PRIMARY KEY, name TEXT, start_week INTEGER, end_week INTEGER
);

CREATE TABLE day_templates (
  id INTEGER PRIMARY KEY,
  phase_id INTEGER NOT NULL REFERENCES phases(id),
  weekday INTEGER NOT NULL,          -- 1=Mon .. 7=Sun
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('lifting','cardio_mobility','rest'))
);

CREATE TABLE slots (
  id INTEGER PRIMARY KEY,
  day_template_id INTEGER NOT NULL REFERENCES day_templates(id),
  position INTEGER NOT NULL,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id),
  sets INTEGER NOT NULL,
  reps INTEGER NOT NULL,
  load_kg REAL,
  note TEXT
);

CREATE TABLE slot_swaps (
  slot_id INTEGER NOT NULL REFERENCES slots(id),
  exercise_id INTEGER NOT NULL REFERENCES exercises(id),
  position INTEGER NOT NULL,
  PRIMARY KEY (slot_id, exercise_id)
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,         -- ISO date
  day_template_id INTEGER REFERENCES day_templates(id),
  status TEXT NOT NULL CHECK (status IN ('planned','completed','missed')),
  started_at TEXT, ended_at TEXT, note TEXT
);

CREATE TABLE logged_sets (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  slot_id INTEGER REFERENCES slots(id),          -- NULL when added
  exercise_id INTEGER NOT NULL REFERENCES exercises(id),
  set_index INTEGER NOT NULL,
  load_kg REAL, reps INTEGER,
  status TEXT NOT NULL CHECK (status IN ('done','skipped')),
  provenance TEXT NOT NULL CHECK (provenance IN
    ('prescribed','swap_in_list','swap_off_list','added')),
  added_by TEXT CHECK (added_by IN ('trainer','me')),
  logged_at TEXT NOT NULL
);

CREATE TABLE morning_checks (
  date TEXT PRIMARY KEY,
  pain TEXT NOT NULL CHECK (pain IN ('none','background','noticeable','limiting'))
);

CREATE TABLE protein_logs(date TEXT PRIMARY KEY, hit INTEGER NOT NULL);
CREATE TABLE mobility_logs(date TEXT PRIMARY KEY, done INTEGER NOT NULL);
CREATE TABLE cardio_logs (
  id INTEGER PRIMARY KEY, date TEXT NOT NULL,
  modality TEXT NOT NULL, duration_min INTEGER NOT NULL
);
CREATE TABLE steps_logs (date TEXT PRIMARY KEY, steps INTEGER NOT NULL);

CREATE TABLE outbox (
  id INTEGER PRIMARY KEY, entity TEXT, entity_id TEXT,
  payload TEXT, created_at TEXT, synced_at TEXT
);
```

**Amendment (M9):** two additions the original schema had no room for:

```sql
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
ALTER TABLE logged_sets ADD COLUMN client_uuid TEXT;
CREATE UNIQUE INDEX idx_logged_sets_client_uuid ON logged_sets (client_uuid);
```

`settings` is a generic key/value store; its first (only, so far) key is
`programme_start_date`, written once by `programme.Apply` the moment a phase
is seeded, and the original schema had nowhere to put it. `logged_sets` was
always supposed to carry the client UUID §B5 already required ("every write
carries a client-generated UUID so outbox replays are idempotent") but the
column never actually existed until now. See `server/internal/settings` and
`server/internal/sync`, and `memory.md` for the SQLite-has-no-`ADD COLUMN IF
NOT EXISTS` migration wrinkle this required in `db.go`.

`morning_checks` has no `unlogged` value by design — absence is the representation. Never insert a default.

**Amendment (UX refactor, post-M10):** `weigh_ins` is dropped (`DROP TABLE
IF EXISTS`, migration `0005`) along with the whole weigh-in/Vault feature —
the owner does not want weight tracked at all. `programme_start_date`
survives in `settings` regardless (it's a generic marker with a possible
future use — a "week N of the programme" label — independent of the Vault
it was originally built for). `steps_logs` (migration `0006`) is added: a
real daily count, shaped like `protein_logs`, alongside the new Steps entry
on Today (§A3.2) and the new "3 of 3" Week Plan grading (§A3.8).

## B4. The one query that matters

Weekly actual coverage:

```sql
SELECT em.muscle, ROUND(SUM(em.weight), 1) AS actual_sets
FROM logged_sets ls
JOIN exercise_muscles em ON em.exercise_id = ls.exercise_id
JOIN sessions s          ON s.id = ls.session_id
WHERE ls.status = 'done'
  AND s.date BETWEEN :week_start AND :week_end
GROUP BY em.muscle;
```

Prescribed coverage is the same shape over `slots × day_templates` for the active phase, multiplied by `slots.sets`.

## B5. API

```
GET  /api/today?date=YYYY-MM-DD      → session + slots + swaps + last-actuals
POST /api/sessions/:id/sets         → log a set
POST /api/sessions/:id/sets/:sid/skip
POST /api/sessions/:id/add          → { exercise_id, added_by }
POST /api/sessions/:id/complete     → { note? }
GET  /api/exercises?q=              → search, excludes blocked unless ?include_blocked=1
POST /api/morning-check             → { date, pain }
POST /api/protein                   → { date, hit }
POST /api/cardio                    → { date, modality, duration_min }
POST /api/steps                     → { date, steps }        — UX refactor addition, see below
GET  /api/week?start=               → coverage actual/prescribed + volume + 7 pain values
GET  /api/programme                 → active phase's full week structure (day_templates + slots) — M8 addition, see below
POST /api/sync                      → outbox drain, idempotent by client uuid
GET  /api/export                    → full JSON dump
```

Every write carries a client-generated UUID so outbox replays are idempotent.

**Amendment (M3):** `GET /api/today` takes an explicit `date` query param — the client's *local* calendar day (`YYYY-MM-DD`), not the server's. The server cannot otherwise know the user's timezone, and "which day is today" must be the same day the user is actually living, not wherever the box happens to be hosted. Falls back to the server's own local date only if omitted (a convenience for manual/curl testing, not something the frontend should rely on).

**Amendment (M8):** `GET /api/week` as specified assumes the server already has synced "actual" data (logged sets, morning checks) to aggregate — i.e. that M9's sync worker exists and has run. It doesn't yet, and every mutation since M4 has deliberately stayed local-first (Dexie + outbox, server sync deferred to M9). Rather than build `GET /api/week` now and have it always return zeros, M8 adds **`GET /api/programme`** — a plain read of the active phase's day_templates + slots, no date range, cached client-side once (it's phase-wide and constant across weeks) the same way the exercise library is. The Week View computes *both* prescribed coverage (from this cache) and actual coverage (from local `loggedSets`/`morningChecks`) entirely client-side. `GET /api/week` stays an unbuilt stub until M9 makes server-side "actual" data real; §B4's query is exactly what the client-side computation reproduces in TypeScript (see `src/lib/week.ts`).

**Amendment (M9):** the M8 precondition above is now technically satisfied — `POST /api/sync` makes server-side `logged_sets`/`morning_checks` real — but `GET /api/week` stays an unbuilt stub anyway. The Week View's client-side computation (`src/lib/week.ts`) is complete, tested, and works fully offline; building a server aggregate now would duplicate that logic for a screen that already has no reason to call it. Deferred indefinitely, not scheduled for a future milestone, unless a real need for a server-side weekly rollup shows up (e.g. `GET /api/export`, M10).

**Amendment (UX refactor, post-M10):** `POST/GET /api/weigh-ins` are removed entirely, along with the whole weigh-in/Vault feature (§A4 of `prd.md` is now a removal notice, not a spec) — the owner does not want weight tracked at all. `GET /api/export` no longer gates anything (see below) and `weigh_ins` is gone from both its table dump and the `db.go` schema (migration `0005`, `DROP TABLE IF EXISTS`). **`POST /api/steps`** is added — a plain upsert on `steps_logs(date, steps)`, the same idempotency shape as `POST /api/protein`/`POST /api/cardio`. The Week View itself is split into two bottom-nav tabs, Coverage (`/coverage`, this section's muscle-load screen) and Week Plan (`/week`, a new Mon–Sat green/yellow/red grid) — both still purely client-side, no new server routes needed for either (Week Plan's "session done" signal reads the existing `session_complete` outbox entries, not a new endpoint).

Also in M9:
- **`POST /api/sync`** is now real: body is a JSON array of `{entity, entity_id, payload}` (the shape of one outbox row, minus `id`/`created_at`/`synced_at`); response is a same-length array of `{entity, entity_id, ok, error?}`. One bad entry never fails the batch — each is applied independently (`server/internal/sync#Drain`), and the client (`src/lib/sync.ts`) marks its own outbox rows synced only for the entries the response reports `ok`.
- **`POST /api/mobility`** is a new route, not in this document's original list — a gap noted in M7's `memory.md` (mobility has been logged client-side, with an outbox entity and everything, since M7, with nowhere real to sync to). Body: `{date}`; always writes `mobility_logs.done = 1` — there is no `done: false` to write, matching the client's own presence-only model (§B3, `mobility_logs`).
- **`POST /api/sessions/:id/sets/:sid/skip`** and **`POST /api/sessions/:id/add`** stay unimplemented — deliberately, not a gap. The client never has a create-then-patch flow for a set (`SessionRunner` logs each commit as one complete `logged_sets` row via a single `logged_set` outbox entity — a skip is just `status: 'skipped'` on that same write), and swap/add-exercise bookkeeping (`SessionOverlay`, M5) is local-only by design: every set actually logged against a swapped/added exercise already carries its own `provenance` in the synced `logged_sets` row, so there is nothing left for these two routes to persist.
- **Idempotency for `logged_set`** is an upsert on the new `client_uuid` unique index (`ON CONFLICT(client_uuid) DO NOTHING`) — this guards against a *retried* sync POST creating a duplicate row, not against editing an already-logged set: the client never revises a committed set through this path, so a second `client_uuid` for the same `(session_id, exercise_id, set_index)` is a deliberate new history entry, not a duplicate. Every other entity (`morning_check`, `protein_log`, `mobility_log`, `steps_log`) is keyed by its own natural key (a date, or date+modality for `cardio_log`) and upserts/replaces on that — idempotent by construction, no UUID needed.
- **`GET /api/export` (M10) is real** — a full JSON dump of every table (`server/internal/export`, a generic `SELECT *` over a fixed table whitelist rather than one struct per table, so it reflects the schema as-is including future columns without needing a matching update here). **UX refactor:** the old `weigh_ins`-only Vault gate on this route is gone along with the feature — every table dumps unconditionally now.

## B6. Frontend rules Claude Code must enforce

1. **No `<input type="number">` or any focusable text field inside the exercise screen where sets are logged (`/session/:id/exercise/:key`).** Steppers only. This is a testable assertion — write a test for it. **Amendment (M5):** this rule scopes to the set-logging screen itself, matching prd.md §A3.3.1's own literal wording ("no keyboard is reachable from *this screen*"), not literally every route nested under `/session/*`. The Swap sheet (§A3.4) and Add-exercise (§A3.5) explicitly mock up a "Search…" text box each — those two screens get a real text input for tier-2/full-library search. The no-input test stays scoped to the single-exercise screen's component only. **Amendment (UX refactor):** the set-logging screen moved from `/session/:id` to `/session/:id/exercise/:key` when the exercise list (§A3.3) became the session's landing screen — the rule and its test moved with it, unchanged in substance.
2. Minimum tap target 48×48 px. Set-confirm targets 64 px tall.
3. Dark theme by default. Gym lighting is bad and screens are read at arm's length.
4. Rest timer is a passive display, never a modal, never blocking.
5. **Amendment (UX refactor):** the old "Week View" screen (`/week`) — coverage numbers and the pain strip together, never split into tabs — is itself now split into two bottom-nav tabs, Coverage (`/coverage`) and Week Plan (`/week`). This rule's *spirit* survives at the Coverage level: Coverage's own muscle table, volume line, and pain strip still render in one scroll view, never their own sub-tabs. Week Plan is a genuinely different screen (a Mon–Sat grid), not a further split of Coverage's content.
6. ~~No component in v1 may render a weight value or any aggregation spanning more than 7 days.~~ **Moot as of the UX refactor** — weight isn't tracked at all now, so there's no weight value anywhere in the codebase to guard against rendering. The "no aggregation spanning more than 7 days" half still holds for everything else (Coverage, Week Plan) — both are single-week views by design, with no multi-week chart anywhere.

## B7. Build order

1. Schema + seed loader + `seed/exercises.json` (all 75 + blocked list)
2. Phase 1 programme seed with slots and swaps
3. Today screen + session creation
4. **Session runner and set logging** — the core; get the tap economy right before anything else
5. Swap and add flows with provenance
6. Morning check + notification
7. Protein, mobility, cardio logging
8. Week view
9. Offline outbox + sync
10. Export + nightly backup

Steps 1–5 are a usable product. Ship those before building 6–10.

## B8. Two risks worth naming to whoever builds this

**The seed data is the product.** Muscle weights, swap lists and blocked exercises are what make the week view mean anything. If they're approximated or auto-generated, the coverage numbers become confidently wrong, which is worse than absent. Seed them from this document exactly.

**Scope creep will arrive as helpfulness.** Every fitness app convention this spec omits — streaks, charts, insights, encouragement — will feel like an obvious improvement mid-build. They are all deliberate omissions and each one re-creates the failure mode this app exists to avoid.
