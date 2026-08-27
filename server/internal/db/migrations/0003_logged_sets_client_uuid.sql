-- M9: "every write carries a client-generated UUID so outbox replays are
-- idempotent" (docs/architecture.md §B5) — the column this requires was
-- missing from the original schema. SQLite has no `ADD COLUMN IF NOT
-- EXISTS`, so this file is a single statement and `db.migrate` tolerates
-- its "duplicate column name" error on re-run instead (see db.go).
ALTER TABLE logged_sets ADD COLUMN client_uuid TEXT;
