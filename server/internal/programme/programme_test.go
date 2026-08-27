package programme_test

import (
	"context"
	"testing"

	"github.com/ajayrajen7/anyway/server/internal/db"
	"github.com/ajayrajen7/anyway/server/internal/programme"
	"github.com/ajayrajen7/anyway/server/internal/seed"
)

func TestParseRealPhase1File(t *testing.T) {
	s, err := programme.ParseFile("../../../seed/phase1.json")
	if err != nil {
		t.Fatalf("parse real phase1 file: %v", err)
	}
	if len(s.DayTemplates) != 7 {
		t.Fatalf("expected 7 day templates (Mon..Sun), got %d", len(s.DayTemplates))
	}

	seenWeekday := map[int]bool{}
	totalSlots := 0
	liftingDays := 0
	for _, d := range s.DayTemplates {
		if seenWeekday[d.Weekday] {
			t.Fatalf("weekday %d appears more than once", d.Weekday)
		}
		seenWeekday[d.Weekday] = true
		totalSlots += len(d.Slots)
		if d.Kind == "lifting" {
			liftingDays++
			if len(d.Slots) == 0 {
				t.Errorf("lifting day %q has no slots", d.Name)
			}
		} else if len(d.Slots) != 0 {
			t.Errorf("%s day %q should carry no slots (cardio/mobility and rest logged via separate tables)", d.Kind, d.Name)
		}
	}
	for weekday := 1; weekday <= 7; weekday++ {
		if !seenWeekday[weekday] {
			t.Errorf("weekday %d missing", weekday)
		}
	}
	if liftingDays != 4 {
		t.Fatalf("expected 4 lifting days (Mon/Tue/Thu/Fri), got %d", liftingDays)
	}
	if totalSlots != 26 {
		t.Fatalf("expected 26 total slots across the week, got %d", totalSlots)
	}
}

func TestApplyFailsWithMissingExercise(t *testing.T) {
	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer conn.Close()

	s := &programme.Seed{
		Phase: programme.Phase{Name: "Test Phase", StartWeek: 1, EndWeek: 6},
		DayTemplates: []programme.DayTemplate{
			{Weekday: 1, Name: "Lower A", Kind: "lifting", Slots: []programme.Slot{
				{Position: 1, ExerciseSlug: "does-not-exist", Sets: 3, Reps: 12},
			}},
		},
	}
	if _, err := programme.Apply(t.Context(), conn, s); err == nil {
		t.Fatal("expected an error for a slot referencing an unseeded exercise")
	}
}

func TestApplyEndToEndWithRealSeedFiles(t *testing.T) {
	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer conn.Close()
	ctx := context.Background()

	exercises, err := seed.ParseFile("../../../seed/exercises.json")
	if err != nil {
		t.Fatalf("parse exercises: %v", err)
	}
	if _, err := seed.Apply(ctx, conn, exercises); err != nil {
		t.Fatalf("apply exercises: %v", err)
	}

	phase1, err := programme.ParseFile("../../../seed/phase1.json")
	if err != nil {
		t.Fatalf("parse phase1: %v", err)
	}
	applied, err := programme.Apply(ctx, conn, phase1)
	if err != nil {
		t.Fatalf("apply phase1: %v", err)
	}
	if applied.DayTemplates != 7 {
		t.Errorf("expected 7 day templates, got %d", applied.DayTemplates)
	}
	if applied.Slots != 26 {
		t.Errorf("expected 26 slots, got %d", applied.Slots)
	}
	if applied.Swaps != 49 {
		t.Errorf("expected 49 slot_swaps rows, got %d", applied.Swaps)
	}

	// Re-applying (e.g. after editing phase1.json) must replace, not
	// accumulate — the same phase name wipes its old rows first.
	applied2, err := programme.Apply(ctx, conn, phase1)
	if err != nil {
		t.Fatalf("re-apply phase1: %v", err)
	}
	if applied2.Slots != applied.Slots || applied2.Swaps != applied.Swaps {
		t.Fatalf("re-apply produced different counts: %+v vs %+v", applied2, applied)
	}
	var phaseCount int
	if err := conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM phases WHERE name = ?`, phase1.Phase.Name).Scan(&phaseCount); err != nil {
		t.Fatalf("count phases: %v", err)
	}
	if phaseCount != 1 {
		t.Fatalf("expected exactly one phase row after re-apply, got %d", phaseCount)
	}

	// calf-raise-seated is prescribed on both Monday and Thursday — each
	// occurrence must carry its own slot + slot_swaps row (not be merged).
	var calfRaiseSlots int
	if err := conn.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM slots s JOIN exercises e ON e.id = s.exercise_id WHERE e.slug = 'calf-raise-seated'
	`).Scan(&calfRaiseSlots); err != nil {
		t.Fatalf("count calf-raise-seated slots: %v", err)
	}
	if calfRaiseSlots != 2 {
		t.Fatalf("expected calf-raise-seated to be a slot on 2 days, got %d", calfRaiseSlots)
	}
}
