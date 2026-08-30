package export_test

import (
	"testing"
	"time"

	"github.com/ajayrajen7/anyway/server/internal/db"
	"github.com/ajayrajen7/anyway/server/internal/export"
)

func TestBuildDumpsEveryTable(t *testing.T) {
	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer conn.Close()

	if _, err := conn.Exec(`INSERT INTO exercises (slug, name, equipment, pressure, impact, increment_kg) VALUES ('squat','Squat','barbell','moderate','low',2.5)`); err != nil {
		t.Fatalf("seed: %v", err)
	}

	dump, err := export.Build(t.Context(), conn, time.Now())
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	if len(dump.Tables["exercises"]) != 1 {
		t.Fatalf("expected 1 exercise row, got %+v", dump.Tables["exercises"])
	}
	if dump.Tables["exercises"][0]["slug"] != "squat" {
		t.Fatalf("expected slug=squat (a real string, not a []byte blob), got %#v", dump.Tables["exercises"][0]["slug"])
	}
	for _, table := range []string{"phases", "sessions", "logged_sets", "morning_checks", "protein_logs", "mobility_logs", "cardio_logs", "steps_logs", "outbox", "settings"} {
		if _, ok := dump.Tables[table]; !ok {
			t.Errorf("expected table %q present in the dump (even if empty)", table)
		}
	}
}
