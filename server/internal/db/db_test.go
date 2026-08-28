package db_test

import (
	"testing"

	"github.com/ajayrajen7/anyway/server/internal/db"
)

// TestOpenCreatesAMissingParentDirectory reproduces a real deploy failure:
// a fresh persistent volume/disk (e.g. Railway's, mounted at /data) can
// exist without ANYWAY_DB_PATH's parent directory having been created
// inside it — SQLite creates the file itself, never the directory, and
// fails with "unable to open database file" otherwise.
func TestOpenCreatesAMissingParentDirectory(t *testing.T) {
	path := t.TempDir() + "/nested/does/not/exist/anyway.db"

	conn, err := db.Open(path)
	if err != nil {
		t.Fatalf("expected Open to create the missing parent directories, got: %v", err)
	}
	defer conn.Close()
}

func TestOpenAppliesMigrations(t *testing.T) {
	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer conn.Close()

	tables := []string{
		"exercises", "exercise_muscles", "phases", "day_templates", "slots",
		"slot_swaps", "sessions", "logged_sets", "morning_checks", "weigh_ins",
		"protein_logs", "mobility_logs", "cardio_logs", "outbox", "settings",
	}
	for _, table := range tables {
		var name string
		err := conn.QueryRow(
			"SELECT name FROM sqlite_master WHERE type='table' AND name=?", table,
		).Scan(&name)
		if err != nil {
			t.Errorf("table %s not created: %v", table, err)
		}
	}
}

func TestOpenIsIdempotent(t *testing.T) {
	if _, err := db.Open(":memory:"); err != nil {
		t.Fatalf("first open: %v", err)
	}
	// A second Open against a fresh in-memory DB re-runs the same
	// CREATE-TABLE-IF-NOT-EXISTS migrations without error.
	if _, err := db.Open(":memory:"); err != nil {
		t.Fatalf("second open: %v", err)
	}
}

// TestOpenIsIdempotentOnARealFileAcrossRestarts is TestOpenIsIdempotent's
// sharper sibling: :memory: gives every Open call its own fresh database, so
// it can never actually exercise re-running a migration against a database
// that already has it applied — which is exactly the case
// 0003_logged_sets_client_uuid.sql's non-idempotent `ALTER TABLE ADD COLUMN`
// needs covered (see db.go's isDuplicateColumnError).
func TestOpenIsIdempotentOnARealFileAcrossRestarts(t *testing.T) {
	path := t.TempDir() + "/anyway.db"

	conn, err := db.Open(path)
	if err != nil {
		t.Fatalf("first open: %v", err)
	}
	conn.Close()

	// Simulates a server restart against a database that has already had
	// every migration applied once, including the ALTER TABLE.
	conn, err = db.Open(path)
	if err != nil {
		t.Fatalf("second open (restart) failed — likely the ALTER TABLE column addition erroring on retry: %v", err)
	}
	defer conn.Close()

	var name string
	if err := conn.QueryRow(`SELECT name FROM pragma_table_info('logged_sets') WHERE name = 'client_uuid'`).Scan(&name); err != nil {
		t.Fatalf("client_uuid column missing after restart: %v", err)
	}
}
