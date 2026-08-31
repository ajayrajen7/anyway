// Package seed loads the exercise library from seed/exercises.json into the
// database, and serves it back out for the search endpoint. This is
// M1 — per docs/architecture.md §B8, this data *is* the product: it is
// transcribed from docs/prd.md §A5.4/§A5.3 exactly, not approximated.
package seed

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
)

// CanonicalMuscles is the fixed muscle-group vocabulary (prd.md §A5.1). A
// muscle name outside this set is a data-entry error, not a new muscle group
// — adding one is a spec change, not a seed-file change.
var CanonicalMuscles = map[string]bool{
	"quads": true, "hamstrings": true, "glutes": true, "adductors": true,
	"calves": true, "tibialis": true, "foot": true, "erectors": true,
	"chest": true, "lats": true, "upper_back": true, "delts_front": true,
	"delts_side": true, "delts_rear": true, "biceps": true, "triceps": true,
	"core": true,
}

var validPressure = map[string]bool{"low": true, "moderate": true, "high": true}
var validImpact = map[string]bool{"none": true, "low": true, "high": true}
var validSource = map[string]bool{"programme": true, "llm": true}

// Exercise is one seed-file entry (and also the shape returned by List).
type Exercise struct {
	ID          int64              `json:"id,omitempty"`
	Slug        string             `json:"slug"`
	Name        string             `json:"name"`
	Equipment   string             `json:"equipment"`
	Pressure    string             `json:"pressure"`
	Impact      string             `json:"impact"`
	Unilateral  bool               `json:"unilateral"`
	IncrementKg float64            `json:"increment_kg"`
	Blocked     bool               `json:"blocked"`
	BlockReason *string            `json:"block_reason"`
	Caution     *string            `json:"caution"`
	Muscles     map[string]float64 `json:"muscles"`
	// Where this record came from — 'programme' (the hand-transcribed
	// docs/prd.md §A5 library) or 'llm' (drafted by exercisegen, see its doc
	// comment). Empty/absent in a seed file defaults to 'programme' — every
	// seed/*.json entry predates this field and none needs editing.
	Source string `json:"source,omitempty"`
}

// ParseFile reads and validates a seed/exercises.json file. Validation
// failures name the offending slug — this file is hand-authored and errors
// need to be fixable by inspection, not just "invalid JSON".
func ParseFile(path string) ([]Exercise, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	exercises, err := Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return exercises, nil
}

// Parse is ParseFile's validation logic over raw bytes rather than a path —
// pulled out so server/internal/bootstrap can validate the exercise seed
// embedded straight into the binary (go:embed has no file to hand ParseFile
// a path for) without duplicating any of the actual validation rules.
func Parse(raw []byte) ([]Exercise, error) {
	var exercises []Exercise
	if err := json.Unmarshal(raw, &exercises); err != nil {
		return nil, fmt.Errorf("parse: %w", err)
	}

	seen := map[string]bool{}
	for i, e := range exercises {
		if e.Source == "" {
			e.Source = "programme" // every seed/*.json entry predates this field
			exercises[i] = e
		}
		if seen[e.Slug] {
			return nil, fmt.Errorf("duplicate slug %q", e.Slug)
		}
		seen[e.Slug] = true
		if err := ValidateExercise(e); err != nil {
			return nil, err
		}
	}
	return exercises, nil
}

// ValidateExercise checks one record against the same rules ParseFile
// enforces on every seed-file entry — canonical muscle names, valid
// pressure/impact/source, blocked⇒block_reason — except slug-uniqueness,
// which is a whole-file concern, not a per-record one. Exported so
// exercisegen validates an LLM-drafted record through the exact same rules
// a hand-authored entry has to pass, not a parallel copy of them.
func ValidateExercise(e Exercise) error {
	if e.Slug == "" {
		return fmt.Errorf("exercise %q: slug is required", e.Name)
	}
	if !validPressure[e.Pressure] {
		return fmt.Errorf("%s: invalid pressure %q", e.Slug, e.Pressure)
	}
	if !validImpact[e.Impact] {
		return fmt.Errorf("%s: invalid impact %q", e.Slug, e.Impact)
	}
	if e.Source != "" && !validSource[e.Source] {
		return fmt.Errorf("%s: invalid source %q", e.Slug, e.Source)
	}
	if e.Blocked && (e.BlockReason == nil || *e.BlockReason == "") {
		return fmt.Errorf("%s: blocked exercises require block_reason", e.Slug)
	}
	if len(e.Muscles) == 0 {
		return fmt.Errorf("%s: at least one muscle weight is required", e.Slug)
	}
	for muscle := range e.Muscles {
		if !CanonicalMuscles[muscle] {
			return fmt.Errorf("%s: unknown muscle group %q", e.Slug, muscle)
		}
	}
	return nil
}

// Apply upserts exercises (keyed by slug) and replaces their muscle-weight
// rows, in one transaction. Safe to re-run — the seed file is the source of
// truth, so re-seeding after an edit is expected, not a one-time operation.
func Apply(ctx context.Context, conn *sql.DB, exercises []Exercise) (int, error) {
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	for _, e := range exercises {
		source := e.Source
		if source == "" {
			source = "programme"
		}
		_, err := tx.ExecContext(ctx, `
			INSERT INTO exercises (slug, name, equipment, pressure, impact, unilateral, increment_kg, blocked, block_reason, caution, source)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(slug) DO UPDATE SET
				name = excluded.name, equipment = excluded.equipment,
				pressure = excluded.pressure, impact = excluded.impact,
				unilateral = excluded.unilateral, increment_kg = excluded.increment_kg,
				blocked = excluded.blocked, block_reason = excluded.block_reason,
				caution = excluded.caution, source = excluded.source
		`, e.Slug, e.Name, e.Equipment, e.Pressure, e.Impact, e.Unilateral, e.IncrementKg, e.Blocked, e.BlockReason, e.Caution, source)
		if err != nil {
			return 0, fmt.Errorf("upsert %s: %w", e.Slug, err)
		}

		var id int64
		if err := tx.QueryRowContext(ctx, `SELECT id FROM exercises WHERE slug = ?`, e.Slug).Scan(&id); err != nil {
			return 0, fmt.Errorf("lookup id for %s: %w", e.Slug, err)
		}

		if _, err := tx.ExecContext(ctx, `DELETE FROM exercise_muscles WHERE exercise_id = ?`, id); err != nil {
			return 0, fmt.Errorf("clear muscles for %s: %w", e.Slug, err)
		}
		muscles := make([]string, 0, len(e.Muscles))
		for m := range e.Muscles {
			muscles = append(muscles, m)
		}
		sort.Strings(muscles) // deterministic insert order
		for _, m := range muscles {
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO exercise_muscles (exercise_id, muscle, weight) VALUES (?, ?, ?)
			`, id, m, e.Muscles[m]); err != nil {
				return 0, fmt.Errorf("insert muscle %s for %s: %w", m, e.Slug, err)
			}
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return len(exercises), nil
}

// List returns exercises for GET /api/exercises: substring-matched on name
// (case-insensitive), blocked rows excluded unless includeBlocked is set —
// but never omitted from a *search hit*, since the UI must explain a
// contraindicated match rather than hide it (prd.md §A3.4).
func List(ctx context.Context, conn *sql.DB, query string, includeBlocked bool) ([]Exercise, error) {
	sqlQuery := `SELECT id, slug, name, equipment, pressure, impact, unilateral, increment_kg, blocked, block_reason, caution, source FROM exercises`
	args := []any{}
	var where []string
	if query != "" {
		where = append(where, `LOWER(name) LIKE ?`)
		args = append(args, "%"+strings.ToLower(query)+"%")
	}
	if !includeBlocked {
		where = append(where, `blocked = 0`)
	}
	if len(where) > 0 {
		sqlQuery += " WHERE " + strings.Join(where, " AND ")
	}
	sqlQuery += " ORDER BY name"

	rows, err := conn.QueryContext(ctx, sqlQuery, args...)
	if err != nil {
		return nil, err
	}
	var out []Exercise
	for rows.Next() {
		var e Exercise
		if err := rows.Scan(&e.ID, &e.Slug, &e.Name, &e.Equipment, &e.Pressure, &e.Impact, &e.Unilateral, &e.IncrementKg, &e.Blocked, &e.BlockReason, &e.Caution, &e.Source); err != nil {
			rows.Close()
			return nil, err
		}
		e.Muscles = map[string]float64{}
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close() // must be closed before issuing another query — db.Open caps the pool at one connection

	byID := make(map[int64]int, len(out))
	for i, e := range out {
		byID[e.ID] = i
	}
	muscleRows, err := conn.QueryContext(ctx, `SELECT exercise_id, muscle, weight FROM exercise_muscles`)
	if err != nil {
		return nil, err
	}
	defer muscleRows.Close()
	for muscleRows.Next() {
		var exerciseID int64
		var muscle string
		var weight float64
		if err := muscleRows.Scan(&exerciseID, &muscle, &weight); err != nil {
			return nil, err
		}
		if i, ok := byID[exerciseID]; ok {
			out[i].Muscles[muscle] = weight
		}
	}
	return out, muscleRows.Err()
}

// InsertOne adds a single brand-new exercise — used by exercisegen for
// real-time LLM-drafted additions, never by the seed-file reseed path
// (Apply, above). Unlike Apply, this never overwrites an existing row: if
// e.Slug is already taken, it appends "-2", "-3", ... until a free slug is
// found (an LLM-guessed slug colliding with an existing one, hand-curated
// or previously LLM-added, should never silently clobber that entry). The
// exercise is validated first via ValidateExercise, same rules as every
// other path into this table.
func InsertOne(ctx context.Context, conn *sql.DB, e Exercise) (Exercise, error) {
	if err := ValidateExercise(e); err != nil {
		return Exercise{}, err
	}

	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return Exercise{}, err
	}
	defer tx.Rollback()

	baseSlug := e.Slug
	slug := baseSlug
	for attempt := 2; ; attempt++ {
		var exists int
		if err := tx.QueryRowContext(ctx, `SELECT 1 FROM exercises WHERE slug = ?`, slug).Scan(&exists); errors.Is(err, sql.ErrNoRows) {
			break // slug is free
		} else if err != nil {
			return Exercise{}, fmt.Errorf("check slug %s: %w", slug, err)
		}
		slug = fmt.Sprintf("%s-%d", baseSlug, attempt)
	}
	e.Slug = slug

	res, err := tx.ExecContext(ctx, `
		INSERT INTO exercises (slug, name, equipment, pressure, impact, unilateral, increment_kg, blocked, block_reason, caution, source)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, e.Slug, e.Name, e.Equipment, e.Pressure, e.Impact, e.Unilateral, e.IncrementKg, e.Blocked, e.BlockReason, e.Caution, e.Source)
	if err != nil {
		return Exercise{}, fmt.Errorf("insert %s: %w", e.Slug, err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Exercise{}, fmt.Errorf("get id for %s: %w", e.Slug, err)
	}
	e.ID = id

	muscles := make([]string, 0, len(e.Muscles))
	for m := range e.Muscles {
		muscles = append(muscles, m)
	}
	sort.Strings(muscles)
	for _, m := range muscles {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO exercise_muscles (exercise_id, muscle, weight) VALUES (?, ?, ?)
		`, id, m, e.Muscles[m]); err != nil {
			return Exercise{}, fmt.Errorf("insert muscle %s for %s: %w", m, e.Slug, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return Exercise{}, err
	}
	return e, nil
}
