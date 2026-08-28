// Package bootstrap auto-seeds a fresh database with the exercise library
// and Phase 1 programme on first boot.
//
// This exists because a deployed host's persistent volume/disk starts out
// completely empty, and not every hosting platform gives you an interactive
// shell to run cmd/seed and cmd/programme by hand the way a VPS would.
// Running once automatically removes that manual step entirely — see
// memory.md for the deploy-platform trail that made this necessary.
//
// data/exercises.json and data/phase1.json are NOT seed/exercises.json and
// seed/phase1.json directly — go:embed can't reach outside its own package
// directory (the same constraint already true of server/internal/db's
// migrations and server/internal/webapp's frontend dist). They're copied in
// by scripts/build-embedded.sh / the Dockerfile before `go build`; only
// harmless placeholders are committed, so a plain `go build`/`go test` from
// a fresh clone never depends on that copy step having run.
package bootstrap

import (
	"context"
	"database/sql"
	_ "embed"
	"fmt"

	"github.com/ajayrajen7/anyway/server/internal/programme"
	"github.com/ajayrajen7/anyway/server/internal/seed"
)

//go:embed data/exercises.json
var exercisesJSON []byte

//go:embed data/phase1.json
var phase1JSON []byte

// Run seeds the exercise library if the exercises table is empty, then the
// Phase 1 programme if the phases table is empty — in that order, since
// programme.Apply resolves exercise slugs against an already-seeded
// library and fails loudly if one is missing.
//
// Deliberately idempotent in the strongest sense: it checks "does *any*
// data already exist," not "has this exact seed content changed." Once a
// phase exists, this never touches it again — programme.Apply's own
// wipe-and-reinsert strategy is documented (memory.md, M2) as unsafe once
// real `sessions` rows reference a day_template_id, so re-applying on every
// boot against a live deploy would be a real, not theoretical, corruption
// risk.
func Run(ctx context.Context, conn *sql.DB) error {
	return run(ctx, conn, exercisesJSON, phase1JSON)
}

// run is Run's actual logic, taking the embedded JSON as parameters so
// bootstrap_test.go can exercise it against small fixture seed data —
// this package's own embedded data/ only ever has the committed
// empty/placeholder seed (see the package doc comment).
func run(ctx context.Context, conn *sql.DB, exercisesJSON, phase1JSON []byte) error {
	if err := seedExercisesIfEmpty(ctx, conn, exercisesJSON); err != nil {
		return fmt.Errorf("bootstrap exercises: %w", err)
	}
	if err := seedProgrammeIfEmpty(ctx, conn, phase1JSON); err != nil {
		return fmt.Errorf("bootstrap programme: %w", err)
	}
	return nil
}

func seedExercisesIfEmpty(ctx context.Context, conn *sql.DB, raw []byte) error {
	empty, err := isEmpty(ctx, conn, "exercises")
	if err != nil || !empty {
		return err
	}
	exercises, err := seed.Parse(raw)
	if err != nil {
		return fmt.Errorf("parse embedded exercise seed: %w", err)
	}
	if _, err := seed.Apply(ctx, conn, exercises); err != nil {
		return fmt.Errorf("apply embedded exercise seed: %w", err)
	}
	return nil
}

func seedProgrammeIfEmpty(ctx context.Context, conn *sql.DB, raw []byte) error {
	empty, err := isEmpty(ctx, conn, "phases")
	if err != nil || !empty {
		return err
	}
	s, err := programme.Parse(raw)
	if err != nil {
		return fmt.Errorf("parse embedded programme seed: %w", err)
	}
	if _, err := programme.Apply(ctx, conn, s); err != nil {
		return fmt.Errorf("apply embedded programme seed: %w", err)
	}
	return nil
}

func isEmpty(ctx context.Context, conn *sql.DB, table string) (bool, error) {
	var count int
	if err := conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table).Scan(&count); err != nil { //nolint:gosec // table is a fixed literal at each call site, never user input
		return false, err
	}
	return count == 0, nil
}
