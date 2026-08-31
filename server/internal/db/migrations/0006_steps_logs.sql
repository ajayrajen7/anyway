-- UX refactor: a daily step count, alongside protein_logs — a real number,
-- not presence-only (mirrors protein_logs' shape, not mobility_logs').
CREATE TABLE IF NOT EXISTS steps_logs (
  date  TEXT PRIMARY KEY,
  steps INTEGER NOT NULL
);
