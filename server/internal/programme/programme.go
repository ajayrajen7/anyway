// Package programme loads a phase's day templates, slots, and tier-1 swaps
// (docs/prd.md §A5.5) into the database. This is M2 — the phase data itself
// (which exercise, how many sets/reps, which swaps are approved) is
// transcribed from docs/programme.md and docs/prd.md; see the caller for
// the deliberate exceptions noted in memory.md (a seconds-not-reps slot,
// an AMRAP slot with no fixed prescribed rep count).
package programme

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/ajayrajen7/anyway/server/internal/settings"
)

var validKind = map[string]bool{"lifting": true, "cardio_mobility": true, "rest": true}

type Slot struct {
	Position     int      `json:"position"`
	ExerciseSlug string   `json:"exercise_slug"`
	Sets         int      `json:"sets"`
	Reps         int      `json:"reps"`
	LoadKg       *float64 `json:"load_kg"`
	Note         *string  `json:"note"`
	Swaps        []string `json:"swaps"`
}

type DayTemplate struct {
	Weekday int    `json:"weekday"` // 1=Mon .. 7=Sun, per architecture.md §B3
	Name    string `json:"name"`
	Kind    string `json:"kind"`
	Slots   []Slot `json:"slots"`
}

type Phase struct {
	Name      string `json:"name"`
	StartWeek int    `json:"start_week"`
	EndWeek   int    `json:"end_week"`
}

type Seed struct {
	Phase        Phase         `json:"phase"`
	DayTemplates []DayTemplate `json:"day_templates"`
}

// ParseFile reads and validates a phase seed file. Validation is structural
// only (weekday range, kind enum, no duplicate weekday, positive sets/reps,
// no duplicate slot position within a day) — slugs are resolved against the
// exercise library at Apply time, since that's where "does this exercise
// exist" is actually knowable.
func ParseFile(path string) (*Seed, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	var s Seed
	if err := json.Unmarshal(raw, &s); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}

	seenWeekday := map[int]bool{}
	for _, d := range s.DayTemplates {
		if d.Weekday < 1 || d.Weekday > 7 {
			return nil, fmt.Errorf("day template %q: weekday %d out of range 1..7", d.Name, d.Weekday)
		}
		if seenWeekday[d.Weekday] {
			return nil, fmt.Errorf("duplicate weekday %d", d.Weekday)
		}
		seenWeekday[d.Weekday] = true
		if !validKind[d.Kind] {
			return nil, fmt.Errorf("day template %q: invalid kind %q", d.Name, d.Kind)
		}
		seenPosition := map[int]bool{}
		for _, slot := range d.Slots {
			if seenPosition[slot.Position] {
				return nil, fmt.Errorf("%s: duplicate slot position %d", d.Name, slot.Position)
			}
			seenPosition[slot.Position] = true
			if slot.ExerciseSlug == "" {
				return nil, fmt.Errorf("%s: slot %d missing exercise_slug", d.Name, slot.Position)
			}
			if slot.Sets <= 0 || slot.Reps <= 0 {
				return nil, fmt.Errorf("%s/%s: sets and reps must be positive", d.Name, slot.ExerciseSlug)
			}
		}
	}
	return &s, nil
}

// Applied summarizes what Apply wrote, for the CLI to report.
type Applied struct {
	DayTemplates int
	Slots        int
	Swaps        int
}

// Apply replaces any existing phase with the same name (and its
// day_templates/slots/slot_swaps) and inserts the seed fresh, in one
// transaction. Wipe-and-reinsert is safe pre-M3: nothing (no `sessions` row)
// references a day_template yet. Once sessions exist, re-seeding a phase
// this way would orphan their day_template_id — flagged in memory.md as a
// pre-M3-only assumption to revisit before this is called again in anger.
func Apply(ctx context.Context, conn *sql.DB, s *Seed) (Applied, error) {
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return Applied{}, err
	}
	defer tx.Rollback()

	if err := wipeExistingPhase(ctx, tx, s.Phase.Name); err != nil {
		return Applied{}, err
	}

	var phaseID int64
	res, err := tx.ExecContext(ctx, `INSERT INTO phases (name, start_week, end_week) VALUES (?, ?, ?)`,
		s.Phase.Name, s.Phase.StartWeek, s.Phase.EndWeek)
	if err != nil {
		return Applied{}, fmt.Errorf("insert phase: %w", err)
	}
	phaseID, err = res.LastInsertId()
	if err != nil {
		return Applied{}, err
	}

	var out Applied
	for _, d := range s.DayTemplates {
		dtRes, err := tx.ExecContext(ctx, `INSERT INTO day_templates (phase_id, weekday, name, kind) VALUES (?, ?, ?, ?)`,
			phaseID, d.Weekday, d.Name, d.Kind)
		if err != nil {
			return Applied{}, fmt.Errorf("insert day_template %s: %w", d.Name, err)
		}
		dayTemplateID, err := dtRes.LastInsertId()
		if err != nil {
			return Applied{}, err
		}
		out.DayTemplates++

		for _, slot := range d.Slots {
			exerciseID, err := lookupExerciseID(ctx, tx, slot.ExerciseSlug)
			if err != nil {
				return Applied{}, fmt.Errorf("%s: %w", d.Name, err)
			}
			slotRes, err := tx.ExecContext(ctx, `
				INSERT INTO slots (day_template_id, position, exercise_id, sets, reps, load_kg, note)
				VALUES (?, ?, ?, ?, ?, ?, ?)
			`, dayTemplateID, slot.Position, exerciseID, slot.Sets, slot.Reps, slot.LoadKg, slot.Note)
			if err != nil {
				return Applied{}, fmt.Errorf("insert slot %s/%s: %w", d.Name, slot.ExerciseSlug, err)
			}
			slotID, err := slotRes.LastInsertId()
			if err != nil {
				return Applied{}, err
			}
			out.Slots++

			for i, swapSlug := range slot.Swaps {
				swapExerciseID, err := lookupExerciseID(ctx, tx, swapSlug)
				if err != nil {
					return Applied{}, fmt.Errorf("%s/%s swap: %w", d.Name, slot.ExerciseSlug, err)
				}
				if _, err := tx.ExecContext(ctx, `
					INSERT INTO slot_swaps (slot_id, exercise_id, position) VALUES (?, ?, ?)
				`, slotID, swapExerciseID, i+1); err != nil {
					return Applied{}, fmt.Errorf("insert swap %s for %s/%s: %w", swapSlug, d.Name, slot.ExerciseSlug, err)
				}
				out.Swaps++
			}
		}
	}

	// M9: the Vault's 84-day clock (docs/prd.md §A4) counts from the day the
	// programme was seeded. SetIfAbsent — not Set — so re-running the seed
	// (e.g. re-applying the same phase, or applying phase 2 later) never
	// resets a clock that's already ticking.
	if err := settings.SetIfAbsent(ctx, tx, settings.ProgrammeStartDateKey, time.Now().Format("2006-01-02")); err != nil {
		return Applied{}, fmt.Errorf("record programme_start_date: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return Applied{}, err
	}
	return out, nil
}

func lookupExerciseID(ctx context.Context, tx *sql.Tx, slug string) (int64, error) {
	var id int64
	err := tx.QueryRowContext(ctx, `SELECT id FROM exercises WHERE slug = ?`, slug).Scan(&id)
	if err == sql.ErrNoRows {
		return 0, fmt.Errorf("exercise %q not found — run the M1 exercise seed first", slug)
	}
	if err != nil {
		return 0, err
	}
	return id, nil
}

func wipeExistingPhase(ctx context.Context, tx *sql.Tx, phaseName string) error {
	var phaseID int64
	err := tx.QueryRowContext(ctx, `SELECT id FROM phases WHERE name = ?`, phaseName).Scan(&phaseID)
	if err == sql.ErrNoRows {
		return nil // nothing to wipe
	}
	if err != nil {
		return fmt.Errorf("lookup existing phase: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
		DELETE FROM slot_swaps WHERE slot_id IN (
			SELECT s.id FROM slots s JOIN day_templates dt ON dt.id = s.day_template_id WHERE dt.phase_id = ?
		)`, phaseID); err != nil {
		return fmt.Errorf("wipe slot_swaps: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM slots WHERE day_template_id IN (SELECT id FROM day_templates WHERE phase_id = ?)
	`, phaseID); err != nil {
		return fmt.Errorf("wipe slots: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM day_templates WHERE phase_id = ?`, phaseID); err != nil {
		return fmt.Errorf("wipe day_templates: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM phases WHERE id = ?`, phaseID); err != nil {
		return fmt.Errorf("wipe phase: %w", err)
	}
	return nil
}
