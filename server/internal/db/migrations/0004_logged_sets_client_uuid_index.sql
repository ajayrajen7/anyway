-- Companion to 0003: makes `client_uuid` an upsert target so a retried
-- outbox POST (same client_uuid, same payload) never creates a second row.
-- CREATE ... IF NOT EXISTS is genuinely idempotent, unlike the ALTER TABLE
-- in 0003, so this stays a normal migration.
CREATE UNIQUE INDEX IF NOT EXISTS idx_logged_sets_client_uuid ON logged_sets (client_uuid);
