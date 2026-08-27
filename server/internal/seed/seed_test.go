package seed_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/ajayrajen7/anyway/server/internal/db"
	"github.com/ajayrajen7/anyway/server/internal/seed"
)

func strPtr(s string) *string { return &s }

func writeTempSeed(t *testing.T, contents string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "exercises.json")
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatalf("write temp seed: %v", err)
	}
	return path
}

func TestParseFileRejectsUnknownMuscle(t *testing.T) {
	path := writeTempSeed(t, `[{"slug":"x","name":"X","equipment":"dumbbell","pressure":"low","impact":"none","unilateral":false,"increment_kg":2.5,"muscles":{"biceps_of_the_leg":1.0}}]`)
	if _, err := seed.ParseFile(path); err == nil {
		t.Fatal("expected error for unknown muscle group")
	}
}

func TestParseFileRejectsDuplicateSlug(t *testing.T) {
	path := writeTempSeed(t, `[
		{"slug":"x","name":"X","equipment":"dumbbell","pressure":"low","impact":"none","unilateral":false,"increment_kg":2.5,"muscles":{"biceps":1.0}},
		{"slug":"x","name":"X2","equipment":"dumbbell","pressure":"low","impact":"none","unilateral":false,"increment_kg":2.5,"muscles":{"triceps":1.0}}
	]`)
	if _, err := seed.ParseFile(path); err == nil {
		t.Fatal("expected error for duplicate slug")
	}
}

func TestParseFileRequiresBlockReasonWhenBlocked(t *testing.T) {
	path := writeTempSeed(t, `[{"slug":"x","name":"X","equipment":"barbell","pressure":"high","impact":"none","unilateral":false,"increment_kg":2.5,"blocked":true,"muscles":{}}]`)
	if _, err := seed.ParseFile(path); err == nil {
		t.Fatal("expected error for blocked exercise with no block_reason")
	}
}

func TestParseRealSeedFile(t *testing.T) {
	// Guards against transcription errors in seed/exercises.json itself —
	// docs/architecture.md §B8: "the seed data is the product."
	exercises, err := seed.ParseFile("../../../seed/exercises.json")
	if err != nil {
		t.Fatalf("parse real seed file: %v", err)
	}
	if len(exercises) != 89 {
		t.Fatalf("expected 89 exercises (75 usable + 14 blocked), got %d", len(exercises))
	}
	blocked := 0
	for _, e := range exercises {
		if e.Blocked {
			blocked++
		}
	}
	if blocked != 14 {
		t.Fatalf("expected 14 blocked exercises, got %d", blocked)
	}
}

func TestApplyUpsertsAndReplacesMuscles(t *testing.T) {
	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer conn.Close()

	ctx := context.Background()
	exercises := []seed.Exercise{
		{Slug: "goblet-squat", Name: "Goblet squat", Equipment: "dumbbell", Pressure: "moderate", Impact: "none", IncrementKg: 2.5, Muscles: map[string]float64{"quads": 1.0, "glutes": 0.5}},
		{Slug: "conventional-deadlift", Name: "Conventional deadlift", Equipment: "barbell", Pressure: "high", Impact: "none", IncrementKg: 2.5, Blocked: true, BlockReason: strPtr("Braced hinge"), Muscles: map[string]float64{"hamstrings": 1.0}},
	}

	n, err := seed.Apply(ctx, conn, exercises)
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if n != 2 {
		t.Fatalf("expected 2 applied, got %d", n)
	}

	// Re-apply with a changed muscle set for goblet-squat — old muscle rows
	// must be replaced, not accumulated.
	exercises[0].Muscles = map[string]float64{"quads": 1.0}
	if _, err := seed.Apply(ctx, conn, exercises); err != nil {
		t.Fatalf("re-apply: %v", err)
	}

	all, err := seed.List(ctx, conn, "", true)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(all) != 2 {
		t.Fatalf("expected 2 exercises after re-apply, got %d", len(all))
	}
	for _, e := range all {
		if e.Slug == "goblet-squat" {
			if len(e.Muscles) != 1 || e.Muscles["quads"] != 1.0 {
				t.Fatalf("expected muscles replaced to just quads:1.0, got %v", e.Muscles)
			}
		}
	}
}

func TestListExcludesBlockedByDefault(t *testing.T) {
	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer conn.Close()
	ctx := context.Background()

	exercises := []seed.Exercise{
		{Slug: "goblet-squat", Name: "Goblet squat", Equipment: "dumbbell", Pressure: "moderate", Impact: "none", IncrementKg: 2.5, Muscles: map[string]float64{"quads": 1.0}},
		{Slug: "running", Name: "Running", Equipment: "bodyweight", Pressure: "low", Impact: "high", IncrementKg: 1, Blocked: true, BlockReason: strPtr("Impact — knee and Achilles"), Muscles: map[string]float64{"calves": 1.0}},
	}
	if _, err := seed.Apply(ctx, conn, exercises); err != nil {
		t.Fatalf("apply: %v", err)
	}

	visible, err := seed.List(ctx, conn, "", false)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(visible) != 1 || visible[0].Slug != "goblet-squat" {
		t.Fatalf("expected only goblet-squat visible, got %+v", visible)
	}

	// But a search matching the blocked term must still return it (greyed,
	// with reason) when include_blocked is requested — never silently hide it.
	withBlocked, err := seed.List(ctx, conn, "running", true)
	if err != nil {
		t.Fatalf("list with blocked: %v", err)
	}
	if len(withBlocked) != 1 || withBlocked[0].BlockReason == nil {
		t.Fatalf("expected running with a block reason, got %+v", withBlocked)
	}
}
