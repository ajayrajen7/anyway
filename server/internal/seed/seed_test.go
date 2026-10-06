package seed_test

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/ajayrajen7/anyway/server/internal/db"
	"github.com/ajayrajen7/anyway/server/internal/seed"
)

func archiveFixture(t *testing.T) (context.Context, *sql.DB, int64) {
	t.Helper()
	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.Close() })
	ctx := context.Background()
	if _, err := seed.Apply(ctx, conn, []seed.Exercise{{Slug: "row", Name: "Row", Equipment: "barbell", Pressure: "low", Impact: "none", Muscles: map[string]float64{"quads": 1}}}); err != nil {
		t.Fatal(err)
	}
	var id int64
	if err := conn.QueryRow(`SELECT id FROM exercises WHERE slug = 'row'`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return ctx, conn, id
}

func TestArchiveExercise(t *testing.T) {
	ctx, conn, id := archiveFixture(t)
	if _, err := conn.Exec(`INSERT INTO phases (id, name) VALUES (1, 'P')`); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(`INSERT INTO day_templates (id, phase_id, weekday, name, kind) VALUES (1, 1, 1, 'D', 'lifting')`); err != nil {
		t.Fatal(err)
	}
	if _, err := conn.Exec(`INSERT INTO slots (id, day_template_id, position, exercise_id, sets, reps) VALUES (1, 1, 1, ?, 3, 8)`, id); err != nil {
		t.Fatal(err)
	}
	if err := seed.Archive(ctx, conn, id); err != nil {
		t.Fatal(err)
	}
	if err := seed.Archive(ctx, conn, id); err != nil {
		t.Fatalf("idempotent archive: %v", err)
	}
	var active, muscles, slots int
	if err := conn.QueryRow(`SELECT active FROM exercises WHERE id = ?`, id).Scan(&active); err != nil {
		t.Fatal(err)
	}
	if err := conn.QueryRow(`SELECT count(*) FROM exercise_muscles WHERE exercise_id = ?`, id).Scan(&muscles); err != nil {
		t.Fatal(err)
	}
	if err := conn.QueryRow(`SELECT count(*) FROM slots WHERE exercise_id = ?`, id).Scan(&slots); err != nil {
		t.Fatal(err)
	}
	if active != 0 || muscles != 1 || slots != 1 {
		t.Fatalf("archive altered references: active=%d muscles=%d slots=%d", active, muscles, slots)
	}
}

func TestArchiveUnknownExercise(t *testing.T) {
	ctx, conn, _ := archiveFixture(t)
	if err := seed.Archive(ctx, conn, 9999); !errors.Is(err, seed.ErrNotFound) {
		t.Fatalf("want ErrNotFound, got %v", err)
	}
	var active, muscles int
	if err := conn.QueryRow(`SELECT active FROM exercises WHERE slug = 'row'`).Scan(&active); err != nil {
		t.Fatal(err)
	}
	if err := conn.QueryRow(`SELECT count(*) FROM exercise_muscles`).Scan(&muscles); err != nil {
		t.Fatal(err)
	}
	if active != 1 || muscles != 1 {
		t.Fatalf("unknown archive changed data: active=%d muscles=%d", active, muscles)
	}
}

func TestListExcludesArchivedByDefault(t *testing.T) {
	ctx, conn, id := archiveFixture(t)
	if err := seed.Archive(ctx, conn, id); err != nil {
		t.Fatal(err)
	}
	got, err := seed.List(ctx, conn, "", true, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Fatalf("archived exercise in catalogue: %+v", got)
	}
}

func TestListCanIncludeArchived(t *testing.T) {
	ctx, conn, id := archiveFixture(t)
	if err := seed.Archive(ctx, conn, id); err != nil {
		t.Fatal(err)
	}
	got, err := seed.List(ctx, conn, "", true, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Active || got[0].ID != id || got[0].Muscles["quads"] != 1 {
		t.Fatalf("want archived row with details, got %+v", got)
	}
}

func TestApplyPreservesArchivedState(t *testing.T) {
	ctx, conn, id := archiveFixture(t)
	if err := seed.Archive(ctx, conn, id); err != nil {
		t.Fatal(err)
	}
	if _, err := seed.Apply(ctx, conn, []seed.Exercise{{Slug: "row", Name: "Updated", Equipment: "barbell", Pressure: "low", Impact: "none", Muscles: map[string]float64{"glutes": 1}}}); err != nil {
		t.Fatal(err)
	}
	got, err := seed.List(ctx, conn, "", true, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Active || got[0].Name != "Updated" || got[0].Muscles["glutes"] != 1 {
		t.Fatalf("reseed changed archive or failed seed update: %+v", got)
	}
}

func TestInsertOneStartsActive(t *testing.T) {
	ctx, conn, _ := archiveFixture(t)
	got, err := seed.InsertOne(ctx, conn, seed.Exercise{Slug: "new", Name: "New", Equipment: "barbell", Pressure: "low", Impact: "none", Source: "llm", Muscles: map[string]float64{"quads": 1}})
	if err != nil {
		t.Fatal(err)
	}
	var active int
	if err := conn.QueryRow(`SELECT active FROM exercises WHERE id = ?`, got.ID).Scan(&active); err != nil {
		t.Fatal(err)
	}
	if !got.Active || active != 1 {
		t.Fatalf("new exercise not active: response=%+v db=%d", got, active)
	}
}

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

	all, err := seed.List(ctx, conn, "", true, false)
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

	visible, err := seed.List(ctx, conn, "", false, false)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(visible) != 1 || visible[0].Slug != "goblet-squat" {
		t.Fatalf("expected only goblet-squat visible, got %+v", visible)
	}

	// But a search matching the blocked term must still return it (greyed,
	// with reason) when include_blocked is requested — never silently hide it.
	withBlocked, err := seed.List(ctx, conn, "running", true, false)
	if err != nil {
		t.Fatalf("list with blocked: %v", err)
	}
	if len(withBlocked) != 1 || withBlocked[0].BlockReason == nil {
		t.Fatalf("expected running with a block reason, got %+v", withBlocked)
	}
}

func TestInsertOneAddsAnLLMExerciseWithoutTouchingTheSeedPath(t *testing.T) {
	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer conn.Close()
	ctx := context.Background()

	inserted, err := seed.InsertOne(ctx, conn, seed.Exercise{
		Slug: "cable-face-pull", Name: "Cable face pull", Equipment: "cable",
		Pressure: "low", Impact: "none", IncrementKg: 2.5,
		Muscles: map[string]float64{"delts_rear": 1.0, "upper_back": 0.5},
		Source:  "llm",
	})
	if err != nil {
		t.Fatalf("InsertOne: %v", err)
	}
	if inserted.ID == 0 {
		t.Fatalf("expected a real id, got %+v", inserted)
	}

	all, err := seed.List(ctx, conn, "", true, false)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(all) != 1 || all[0].Source != "llm" {
		t.Fatalf("expected the one llm-sourced exercise, got %+v", all)
	}
}

func TestInsertOneDedupesASlugCollisionInsteadOfOverwriting(t *testing.T) {
	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer conn.Close()
	ctx := context.Background()

	original := seed.Exercise{
		Slug: "goblet-squat", Name: "Goblet squat", Equipment: "dumbbell",
		Pressure: "moderate", Impact: "none", IncrementKg: 2.5,
		Muscles: map[string]float64{"quads": 1.0},
	}
	if _, err := seed.Apply(ctx, conn, []seed.Exercise{original}); err != nil {
		t.Fatalf("apply: %v", err)
	}

	// An LLM-guessed slug collides with the already-seeded exercise above —
	// InsertOne must never overwrite it.
	dup, err := seed.InsertOne(ctx, conn, seed.Exercise{
		Slug: "goblet-squat", Name: "Goblet Squat (variant)", Equipment: "kettlebell",
		Pressure: "moderate", Impact: "none", IncrementKg: 2.5,
		Muscles: map[string]float64{"quads": 1.0},
		Source:  "llm",
	})
	if err != nil {
		t.Fatalf("InsertOne: %v", err)
	}
	if dup.Slug != "goblet-squat-2" {
		t.Fatalf("expected the collision to be deduped to goblet-squat-2, got %q", dup.Slug)
	}

	all, err := seed.List(ctx, conn, "", true, false)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(all) != 2 {
		t.Fatalf("expected both exercises to exist, got %+v", all)
	}
	for _, e := range all {
		if e.Slug == "goblet-squat" && e.Source == "llm" {
			t.Fatalf("the original programme-sourced exercise must not have been overwritten: %+v", e)
		}
	}
}
