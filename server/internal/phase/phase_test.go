package phase_test

import (
	"context"
	"errors"
	"testing"

	"github.com/ajayrajen7/anyway/server/internal/db"
	"github.com/ajayrajen7/anyway/server/internal/phase"
	"github.com/ajayrajen7/anyway/server/internal/programme"
	"github.com/ajayrajen7/anyway/server/internal/seed"
)

func TestGetReturnsErrNoActivePhaseWhenNothingSeeded(t *testing.T) {
	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer conn.Close()

	_, err = phase.Get(context.Background(), conn)
	if !errors.Is(err, phase.ErrNoActivePhase) {
		t.Fatalf("expected ErrNoActivePhase, got %v", err)
	}
}

func TestGetReturnsTheFullWeekStructure(t *testing.T) {
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
	if _, err := programme.Apply(ctx, conn, phase1); err != nil {
		t.Fatalf("apply phase1: %v", err)
	}

	resp, err := phase.Get(ctx, conn)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if resp.Phase.Name != "Phase 1 — Tolerance and Tissue Prep" {
		t.Fatalf("unexpected phase name: %q", resp.Phase.Name)
	}
	if len(resp.DayTemplates) != 7 {
		t.Fatalf("expected 7 day templates, got %d", len(resp.DayTemplates))
	}

	totalSlots := 0
	liftingDays := 0
	seenWeekday := map[int]bool{}
	for _, dt := range resp.DayTemplates {
		seenWeekday[dt.Weekday] = true
		totalSlots += len(dt.Slots)
		if dt.Kind == "lifting" {
			liftingDays++
			if len(dt.Slots) == 0 {
				t.Errorf("lifting day %q has no slots", dt.Name)
			}
		} else if len(dt.Slots) != 0 {
			t.Errorf("%s day %q should carry no slots, got %d", dt.Kind, dt.Name, len(dt.Slots))
		}
	}
	for weekday := 1; weekday <= 7; weekday++ {
		if !seenWeekday[weekday] {
			t.Errorf("weekday %d missing", weekday)
		}
	}
	if liftingDays != 4 {
		t.Fatalf("expected 4 lifting days, got %d", liftingDays)
	}
	if totalSlots != 26 {
		t.Fatalf("expected 26 total slots, got %d", totalSlots)
	}
}
