// Package phase implements GET /api/programme (M8) — the active phase's
// full week structure (all 7 day_templates + their slots), used by the
// Week View to compute prescribed coverage (docs/architecture.md §B4).
//
// This endpoint isn't in architecture.md §B5's original list — an
// amendment added in M8, logged in memory.md. §B4's coverage query assumes
// the server already has synced "actual" data to aggregate GET /api/week
// against, which presumes M9's sync worker exists and has run. It doesn't
// yet, so the Week View computes both prescribed *and* actual coverage
// client-side from Dexie instead (actual) and this endpoint's cached
// response (prescribed) — the same offline-first, Dexie-is-truth pattern
// every mutation has followed since M4, just applied to a read.
package phase

import (
	"context"
	"database/sql"
	"fmt"
)

var ErrNoActivePhase = fmt.Errorf("no active phase — run the programme seed (cmd/programme) first")

type Slot struct {
	ID         int64    `json:"id"`
	ExerciseID int64    `json:"exercise_id"`
	Sets       int      `json:"sets"`
	Reps       int      `json:"reps"`
	LoadKg     *float64 `json:"load_kg"`
}

type DayTemplate struct {
	ID      int64  `json:"id"`
	Weekday int    `json:"weekday"` // 1=Mon..7=Sun, per architecture.md §B3
	Name    string `json:"name"`
	Kind    string `json:"kind"`
	Slots   []Slot `json:"slots"`
}

type Info struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	StartWeek int    `json:"start_week"`
	EndWeek   int    `json:"end_week"`
}

type Response struct {
	Phase        Info          `json:"phase"`
	DayTemplates []DayTemplate `json:"day_templates"`
}

// Get returns the active phase (latest seeded `phases` row — same
// placeholder-for-real-phase-selection convention as internal/today) with
// every one of its day_templates and their slots.
func Get(ctx context.Context, conn *sql.DB) (*Response, error) {
	var info Info
	err := conn.QueryRowContext(ctx, `
		SELECT id, name, start_week, end_week FROM phases ORDER BY id DESC LIMIT 1
	`).Scan(&info.ID, &info.Name, &info.StartWeek, &info.EndWeek)
	if err == sql.ErrNoRows {
		return nil, ErrNoActivePhase
	}
	if err != nil {
		return nil, fmt.Errorf("load active phase: %w", err)
	}

	dtRows, err := conn.QueryContext(ctx, `
		SELECT id, weekday, name, kind FROM day_templates WHERE phase_id = ? ORDER BY weekday
	`, info.ID)
	if err != nil {
		return nil, fmt.Errorf("load day_templates: %w", err)
	}
	var dayTemplates []DayTemplate
	for dtRows.Next() {
		var dt DayTemplate
		if err := dtRows.Scan(&dt.ID, &dt.Weekday, &dt.Name, &dt.Kind); err != nil {
			dtRows.Close()
			return nil, err
		}
		dt.Slots = []Slot{}
		dayTemplates = append(dayTemplates, dt)
	}
	if err := dtRows.Err(); err != nil {
		dtRows.Close()
		return nil, err
	}
	dtRows.Close() // close before issuing more queries — db.Open caps the pool at one connection

	for i := range dayTemplates {
		slotRows, err := conn.QueryContext(ctx, `
			SELECT id, exercise_id, sets, reps, load_kg FROM slots WHERE day_template_id = ? AND active = 1 ORDER BY position
		`, dayTemplates[i].ID)
		if err != nil {
			return nil, fmt.Errorf("load slots for day_template %d: %w", dayTemplates[i].ID, err)
		}
		for slotRows.Next() {
			var s Slot
			if err := slotRows.Scan(&s.ID, &s.ExerciseID, &s.Sets, &s.Reps, &s.LoadKg); err != nil {
				slotRows.Close()
				return nil, err
			}
			dayTemplates[i].Slots = append(dayTemplates[i].Slots, s)
		}
		if err := slotRows.Err(); err != nil {
			slotRows.Close()
			return nil, err
		}
		slotRows.Close()
	}

	return &Response{Phase: info, DayTemplates: dayTemplates}, nil
}
