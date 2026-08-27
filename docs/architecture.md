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
| Hosting | Fly.io or a small VPS, SQLite on a persistent volume | |

## B2. Offline-first — the non-negotiable

**Gym basements have no signal.** If the session runner requires network, the app is unusable on exactly the occasions it matters.

- The session runner reads from and writes to **IndexedDB only**. It never awaits a network call.
- Every mutation appends to a local `outbox` table.
- A background sync worker drains the outbox to the server when connectivity returns. Simple last-write-wins on `(entity, id)`; there is one user and one device, so conflict resolution is not a real problem.
- Server SQLite is the durable backup, not the runtime dependency.
- **Nightly `VACUUM INTO` to a timestamped file, plus off-box copy.** Six months of data with no backup is the one unrecoverable failure mode here.

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

CREATE TABLE weigh_ins   (date TEXT PRIMARY KEY, weight_kg REAL NOT NULL);
CREATE TABLE protein_logs(date TEXT PRIMARY KEY, hit INTEGER NOT NULL);
CREATE TABLE mobility_logs(date TEXT PRIMARY KEY, done INTEGER NOT NULL);
CREATE TABLE cardio_logs (
  id INTEGER PRIMARY KEY, date TEXT NOT NULL,
  modality TEXT NOT NULL, duration_min INTEGER NOT NULL
);

CREATE TABLE outbox (
  id INTEGER PRIMARY KEY, entity TEXT, entity_id TEXT,
  payload TEXT, created_at TEXT, synced_at TEXT
);
```

`morning_checks` has no `unlogged` value by design — absence is the representation. Never insert a default.

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
POST /api/weigh-ins                 → { date, weight_kg }   (write always allowed)
GET  /api/weigh-ins                 → 423 Locked before start+84d
POST /api/protein                   → { date, hit }
POST /api/cardio                    → { date, modality, duration_min }
GET  /api/week?start=               → coverage actual/prescribed + volume + 7 pain values
POST /api/sync                      → outbox drain, idempotent by client uuid
GET  /api/export                    → full JSON dump
```

Every write carries a client-generated UUID so outbox replays are idempotent.

**Amendment (M3):** `GET /api/today` takes an explicit `date` query param — the client's *local* calendar day (`YYYY-MM-DD`), not the server's. The server cannot otherwise know the user's timezone, and "which day is today" must be the same day the user is actually living, not wherever the box happens to be hosted. Falls back to the server's own local date only if omitted (a convenience for manual/curl testing, not something the frontend should rely on).

## B6. Frontend rules Claude Code must enforce

1. **No `<input type="number">` or any focusable text field inside `/session/*`.** Steppers only. This is a testable assertion — write a test for it.
2. Minimum tap target 48×48 px. Set-confirm targets 64 px tall.
3. Dark theme by default. Gym lighting is bad and screens are read at arm's length.
4. Rest timer is a passive display, never a modal, never blocking.
5. `/week` must render coverage and the pain strip in a single scroll view. They may not be separated into tabs or routes.
6. No component in v1 may render a weight value or any aggregation spanning more than 7 days. Enforce with a lint rule or a shared guarded selector.

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
