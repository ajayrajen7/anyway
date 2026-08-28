package bootstrap

import (
	"database/sql"
	"testing"

	"github.com/ajayrajen7/anyway/server/internal/db"
)

// Small, valid fixture seed data — not this repo's real exercise library or
// Phase 1 programme (see the package doc comment for why the real embedded
// data/ is just a placeholder here).
const fixtureExercises = `[
	{"slug": "squat", "name": "Squat", "equipment": "barbell", "pressure": "moderate", "impact": "low", "increment_kg": 2.5, "muscles": {"quads": 1.0}}
]`

const fixturePhase1 = `{
	"phase": {"name": "Phase 1", "start_week": 1, "end_week": 6},
	"day_templates": [
		{"weekday": 1, "name": "Lower A", "kind": "lifting", "slots": [
			{"position": 1, "exercise_slug": "squat", "sets": 3, "reps": 10, "swaps": []}
		]}
	]
}`

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	return conn
}

func TestRunSeedsAnEmptyDatabase(t *testing.T) {
	conn := openTestDB(t)
	ctx := t.Context()

	if err := run(ctx, conn, []byte(fixtureExercises), []byte(fixturePhase1)); err != nil {
		t.Fatalf("run: %v", err)
	}

	var exerciseCount, phaseCount, slotCount int
	conn.QueryRow(`SELECT COUNT(*) FROM exercises`).Scan(&exerciseCount)
	conn.QueryRow(`SELECT COUNT(*) FROM phases`).Scan(&phaseCount)
	conn.QueryRow(`SELECT COUNT(*) FROM slots`).Scan(&slotCount)
	if exerciseCount != 1 || phaseCount != 1 || slotCount != 1 {
		t.Fatalf("expected 1 exercise, 1 phase, 1 slot; got exercises=%d phases=%d slots=%d", exerciseCount, phaseCount, slotCount)
	}
}

func TestRunNeverTouchesAnAlreadySeededDatabase(t *testing.T) {
	conn := openTestDB(t)
	ctx := t.Context()

	if err := run(ctx, conn, []byte(fixtureExercises), []byte(fixturePhase1)); err != nil {
		t.Fatalf("first run: %v", err)
	}

	// Simulate real usage: a session now references the seeded day_template.
	var dayTemplateID int64
	if err := conn.QueryRow(`SELECT id FROM day_templates LIMIT 1`).Scan(&dayTemplateID); err != nil {
		t.Fatalf("lookup day_template: %v", err)
	}
	if _, err := conn.Exec(`INSERT INTO sessions (date, day_template_id, status) VALUES ('2026-01-05', ?, 'planned')`, dayTemplateID); err != nil {
		t.Fatalf("seed a session: %v", err)
	}

	// A second run — with *different* fixture content, standing in for a
	// future redeploy where the embedded seed data has changed — must be a
	// complete no-op. If it re-applied programme.Apply's wipe-and-reinsert,
	// this session's day_template_id would be orphaned.
	differentPhase := `{
		"phase": {"name": "Phase 2", "start_week": 7, "end_week": 14},
		"day_templates": [
			{"weekday": 1, "name": "Different Day", "kind": "lifting", "slots": []}
		]
	}`
	if err := run(ctx, conn, []byte(fixtureExercises), []byte(differentPhase)); err != nil {
		t.Fatalf("second run: %v", err)
	}

	var phaseCount int
	var phaseName string
	conn.QueryRow(`SELECT COUNT(*) FROM phases`).Scan(&phaseCount)
	conn.QueryRow(`SELECT name FROM phases LIMIT 1`).Scan(&phaseName)
	if phaseCount != 1 || phaseName != "Phase 1" {
		t.Fatalf("expected the original Phase 1 seed untouched, got count=%d name=%q", phaseCount, phaseName)
	}

	// The session's day_template_id must still resolve to a real row.
	var stillValid int
	if err := conn.QueryRow(`SELECT COUNT(*) FROM day_templates WHERE id = ?`, dayTemplateID).Scan(&stillValid); err != nil || stillValid != 1 {
		t.Fatalf("expected the session's day_template to still exist, got count=%d err=%v", stillValid, err)
	}
}

func TestRunSeedsProgrammeEvenWhenExercisesAlreadyExist(t *testing.T) {
	// A partial-seed state (e.g. cmd/seed was run manually once, but the
	// programme never was) must still get the programme seeded — Run checks
	// each table independently, not "has anything at all been seeded."
	conn := openTestDB(t)
	ctx := t.Context()
	if _, err := conn.Exec(`INSERT INTO exercises (slug, name, equipment, pressure, impact, increment_kg) VALUES ('squat','Squat','barbell','moderate','low',2.5)`); err != nil {
		t.Fatalf("pre-seed exercises: %v", err)
	}

	if err := run(ctx, conn, []byte(fixtureExercises), []byte(fixturePhase1)); err != nil {
		t.Fatalf("run: %v", err)
	}

	var exerciseCount, phaseCount int
	conn.QueryRow(`SELECT COUNT(*) FROM exercises`).Scan(&exerciseCount)
	conn.QueryRow(`SELECT COUNT(*) FROM phases`).Scan(&phaseCount)
	if exerciseCount != 1 || phaseCount != 1 {
		t.Fatalf("expected the pre-existing exercise left alone and the programme seeded, got exercises=%d phases=%d", exerciseCount, phaseCount)
	}
}

func TestRunBuildsFromTheRealEmbeddedData(t *testing.T) {
	// Smoke test for Run() itself (not run) — proves the go:embed wiring is
	// correct against whatever's actually embedded right now (the
	// committed empty/placeholder seed in this repo — see the package doc
	// comment). An empty exercises.json ([]) and a day-template-less
	// phase1.json are both valid, so this should succeed without seeding
	// anything real.
	conn := openTestDB(t)
	if err := Run(t.Context(), conn); err != nil {
		t.Fatalf("Run: %v", err)
	}
}
