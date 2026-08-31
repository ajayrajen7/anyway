-- Protein becomes a manual grams entry (like Steps), not a Yes/No — `hit`
-- (grams >= 120) is still derived and stored so existing grading logic
-- (Week Plan's day completion) needs no changes. See
-- app/src/lib/dailyLogs.ts and memory.md's "manual entry" decision.
--
-- Non-idempotent on re-run, same shape/reasoning as 0008.
ALTER TABLE protein_logs ADD COLUMN grams INTEGER NOT NULL DEFAULT 0;
