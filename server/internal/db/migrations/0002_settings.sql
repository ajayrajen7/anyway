-- M9: a generic key/value settings table. First (only, so far) use:
-- `programme_start_date`, written once by `programme.Apply` when a phase is
-- seeded — the day the Vault's 84-day clock (docs/prd.md §A4) starts
-- counting from. See server/internal/settings.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
