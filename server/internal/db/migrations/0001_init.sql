-- Schema per docs/architecture.md §B3. Copied verbatim from the build spec —
-- do not diverge without updating that doc (see CLAUDE.md operating rule 1).

CREATE TABLE IF NOT EXISTS exercises (
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

CREATE TABLE IF NOT EXISTS exercise_muscles (
  exercise_id INTEGER NOT NULL REFERENCES exercises(id),
  muscle      TEXT NOT NULL,
  weight      REAL NOT NULL,
  PRIMARY KEY (exercise_id, muscle)
);

CREATE TABLE IF NOT EXISTS phases (
  id INTEGER PRIMARY KEY, name TEXT, start_week INTEGER, end_week INTEGER
);

CREATE TABLE IF NOT EXISTS day_templates (
  id INTEGER PRIMARY KEY,
  phase_id INTEGER NOT NULL REFERENCES phases(id),
  weekday INTEGER NOT NULL,          -- 1=Mon .. 7=Sun
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('lifting','cardio_mobility','rest'))
);

CREATE TABLE IF NOT EXISTS slots (
  id INTEGER PRIMARY KEY,
  day_template_id INTEGER NOT NULL REFERENCES day_templates(id),
  position INTEGER NOT NULL,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id),
  sets INTEGER NOT NULL,
  reps INTEGER NOT NULL,
  load_kg REAL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS slot_swaps (
  slot_id INTEGER NOT NULL REFERENCES slots(id),
  exercise_id INTEGER NOT NULL REFERENCES exercises(id),
  position INTEGER NOT NULL,
  PRIMARY KEY (slot_id, exercise_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL UNIQUE,         -- ISO date
  day_template_id INTEGER REFERENCES day_templates(id),
  status TEXT NOT NULL CHECK (status IN ('planned','completed','missed')),
  started_at TEXT, ended_at TEXT, note TEXT
);

CREATE TABLE IF NOT EXISTS logged_sets (
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

CREATE TABLE IF NOT EXISTS morning_checks (
  date TEXT PRIMARY KEY,
  pain TEXT NOT NULL CHECK (pain IN ('none','background','noticeable','limiting'))
);

CREATE TABLE IF NOT EXISTS weigh_ins   (date TEXT PRIMARY KEY, weight_kg REAL NOT NULL);
CREATE TABLE IF NOT EXISTS protein_logs(date TEXT PRIMARY KEY, hit INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS mobility_logs(date TEXT PRIMARY KEY, done INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS cardio_logs (
  id INTEGER PRIMARY KEY, date TEXT NOT NULL,
  modality TEXT NOT NULL, duration_min INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY, entity TEXT, entity_id TEXT,
  payload TEXT, created_at TEXT, synced_at TEXT
);

-- `morning_checks` has no `unlogged` value by design — absence is the
-- representation. Application code must never insert a default row.
