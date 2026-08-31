-- UX refactor: weight tracking (the Vault, prd.md's old §A4) is dropped
-- entirely, not just hidden — the owner does not want it. DROP TABLE IF
-- EXISTS is idempotent (unlike 0003's ADD COLUMN), so no exception is needed
-- in db.go's migrate() for this one.
DROP TABLE IF EXISTS weigh_ins;
