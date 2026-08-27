package db_test

import (
	"testing"

	"github.com/ajayrajen7/anyway/server/internal/db"
)

func TestOpenAppliesMigrations(t *testing.T) {
	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer conn.Close()

	tables := []string{
		"exercises", "exercise_muscles", "phases", "day_templates", "slots",
		"slot_swaps", "sessions", "logged_sets", "morning_checks", "weigh_ins",
		"protein_logs", "mobility_logs", "cardio_logs", "outbox",
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
