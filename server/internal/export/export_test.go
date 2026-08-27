package export_test

import (
	"testing"
	"time"

	"github.com/ajayrajen7/anyway/server/internal/db"
	"github.com/ajayrajen7/anyway/server/internal/export"
	"github.com/ajayrajen7/anyway/server/internal/settings"
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
	for _, table := range []string{"phases", "sessions", "logged_sets", "morning_checks", "protein_logs", "mobility_logs", "cardio_logs", "outbox", "settings"} {
		if _, ok := dump.Tables[table]; !ok {
			t.Errorf("expected table %q present in the dump (even if empty)", table)
		}
	}
}

func TestBuildOmitsWeighInDataWhileLocked(t *testing.T) {
	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer conn.Close()
	if _, err := conn.Exec(`INSERT INTO weigh_ins (date, weight_kg) VALUES ('2026-01-04', 82.5)`); err != nil {
		t.Fatalf("seed weigh-in: %v", err)
	}

	dump, err := export.Build(t.Context(), conn, time.Now())
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	if !dump.VaultLocked {
		t.Fatalf("expected vault_locked=true with no programme_start_date set")
	}
	if len(dump.Tables["weigh_ins"]) != 0 {
		t.Fatalf("expected weigh_ins omitted while locked, got %+v", dump.Tables["weigh_ins"])
	}
}

func TestBuildIncludesWeighInDataOnceUnlocked(t *testing.T) {
	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer conn.Close()
	if _, err := conn.Exec(`INSERT INTO weigh_ins (date, weight_kg) VALUES ('2026-01-04', 82.5)`); err != nil {
		t.Fatalf("seed weigh-in: %v", err)
	}
	if err := settings.Set(t.Context(), conn, settings.ProgrammeStartDateKey, "2000-01-01"); err != nil {
		t.Fatalf("set start date: %v", err)
	}

	dump, err := export.Build(t.Context(), conn, time.Now())
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	if dump.VaultLocked {
		t.Fatalf("expected vault_locked=false well past day 84")
	}
	if len(dump.Tables["weigh_ins"]) != 1 {
		t.Fatalf("expected the weigh-in row included once unlocked, got %+v", dump.Tables["weigh_ins"])
	}
}
