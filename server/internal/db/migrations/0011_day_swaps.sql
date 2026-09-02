-- Swap two days' prescriptions for one week (post-M12 UX addition) — e.g.
-- "do Tuesday's workout on Wednesday." A symmetric pair: swapping A and B
-- inserts one row per date, each naming the other. internal/today resolves
-- a date's day_template from its *swap partner's* weekday when a row exists
-- here, instead of the date's own natural weekday. See
-- server/internal/dayplan and memory.md's day-skip/day-swap entry.
--
-- Deliberately keyed by `date` alone (not date+partner) — a date can only
-- ever be in one swap pair at a time, which this PRIMARY KEY enforces by
-- construction (a second swap involving an already-swapped date must
-- explicitly unswap it first).
CREATE TABLE IF NOT EXISTS day_swaps (
  date         TEXT PRIMARY KEY,
  swapped_with TEXT NOT NULL
);
