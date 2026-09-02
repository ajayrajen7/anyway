-- "Skip this day" (post-M12 UX addition) — a real, distinct, synced state,
-- separate from an unlogged day that later auto-flips to 'missed' (sweepMissed
-- in internal/today). Applies to any day kind (lifting/cardio_mobility/rest),
-- not just lifting days with a `sessions` row — a cardio_mobility or rest day
-- has no session at all, so this can't live on `sessions.status`. See
-- memory.md's day-skip/day-swap entry.
CREATE TABLE IF NOT EXISTS day_skips (
  date       TEXT PRIMARY KEY,
  skipped_at TEXT NOT NULL
);
