// Package today implements GET /api/today (docs/architecture.md §B5) — M3.
//
// "Missed days do not reschedule" (prd.md §A3.2) is achieved by construction:
// the day_template for a date is looked up purely from (active phase,
// weekday) — there is no code path that looks at yesterday's outcome when
// deciding what today shows. The only place "missed" is handled at all is
// sweepMissed, which flips any still-'planned' session dated before today to
// 'missed' and touches nothing else.
package today

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// ISOWeekday maps a date to 1=Monday..7=Sunday (architecture.md §B3's
// day_templates.weekday convention). Go's time.Weekday is 0=Sunday..6=Saturday.
func ISOWeekday(t time.Time) int {
	wd := int(t.Weekday())
	if wd == 0 {
		return 7
	}
	return wd
}

type ExerciseRef struct {
	ID          int64   `json:"id"`
	Slug        string  `json:"slug"`
	Name        string  `json:"name"`
	Unilateral  bool    `json:"unilateral"`
	IncrementKg float64 `json:"increment_kg"`
}

type Actual struct {
	LoadKg *float64 `json:"load_kg"`
	Reps   int      `json:"reps"`
}

type Slot struct {
	ID         int64         `json:"id"` // slots.id — needed to route into /session/:id/swap/:slotId (M5) and to set logged_sets.slot_id (M4)
	Position   int           `json:"position"`
	Exercise   ExerciseRef   `json:"exercise"`
	Sets       int           `json:"sets"`
	Reps       int           `json:"reps"`
	LoadKg     *float64      `json:"load_kg"`
	Note       *string       `json:"note"`
	Swaps      []ExerciseRef `json:"swaps"`
	LastActual *Actual       `json:"last_actual"`
}

type DayTemplateInfo struct {
	ID   int64  `json:"id"`
	Name string `json:"name"`
	Kind string `json:"kind"`
}

type Session struct {
	ID        int64   `json:"id"`
	Status    string  `json:"status"`
	StartedAt *string `json:"started_at"`
	EndedAt   *string `json:"ended_at"`
	Note      *string `json:"note"`
}

type Response struct {
	Date        string          `json:"date"`
	Weekday     int             `json:"weekday"`
	DayTemplate DayTemplateInfo `json:"day_template"`
	// Session and Slots are only populated for a "lifting" day_template.
	// Cardio/mobility and rest days are logged through separate tables
	// (cardio_logs, mobility_logs) — see prd.md §A3.6 — and carry no
	// sets/reps prescription, so there is nothing to attach here.
	Session *Session `json:"session"`
	Slots   []Slot   `json:"slots"`
}

// ErrInvalidDate means the date param wasn't parseable — a client error (400).
var ErrInvalidDate = fmt.Errorf("invalid date")

// ErrNoActivePhase means the M2 programme seed hasn't been run yet (404).
var ErrNoActivePhase = fmt.Errorf("no active phase — run the programme seed (cmd/programme) first")

// ErrNoDayTemplate means the active phase has no day_template for the
// requested weekday (404) — a seed-data gap, not a user-facing state.
var ErrNoDayTemplate = fmt.Errorf("no day_template for this weekday in the active phase")

// Get answers GET /api/today for the given local calendar date (YYYY-MM-DD,
// the caller's — the client's — local day, not the server's; see
// architecture.md §B5 amendment in memory.md). It is not a pure read: it
// lazily creates today's session row on first view, and sweeps any
// still-'planned' session dated before today to 'missed'.
func Get(ctx context.Context, conn *sql.DB, date string) (*Response, error) {
	parsed, err := time.Parse("2006-01-02", date)
	if err != nil {
		return nil, fmt.Errorf("%w %q: %v", ErrInvalidDate, date, err)
	}

	if err := sweepMissed(ctx, conn, date); err != nil {
		return nil, fmt.Errorf("sweep missed sessions: %w", err)
	}

	phaseID, err := activePhaseID(ctx, conn)
	if err != nil {
		return nil, err
	}

	weekday := ISOWeekday(parsed)
	dt, err := dayTemplateFor(ctx, conn, phaseID, weekday)
	if err != nil {
		return nil, err
	}

	resp := &Response{
		Date:        date,
		Weekday:     weekday,
		DayTemplate: dt,
		Slots:       []Slot{},
	}

	if dt.Kind != "lifting" {
		return resp, nil
	}

	session, err := ensureSession(ctx, conn, date, dt.ID)
	if err != nil {
		return nil, err
	}
	resp.Session = session

	slots, err := slotsFor(ctx, conn, dt.ID)
	if err != nil {
		return nil, err
	}
	resp.Slots = slots

	return resp, nil
}

// sweepMissed flips any 'planned' session dated strictly before `date` to
// 'missed'. It never touches `date` itself or any later date, and never
// looks at what day_template a missed session was for — a missed day is
// simply left behind, never rescheduled onto a later one.
func sweepMissed(ctx context.Context, conn *sql.DB, date string) error {
	_, err := conn.ExecContext(ctx, `
		UPDATE sessions SET status = 'missed' WHERE status = 'planned' AND date < ?
	`, date)
	return err
}

// activePhaseID is the most-recently-seeded phase. v1 only ever has one
// phase seeded at a time (Phase 1 — see docs/prd.md §A5.5), so this is a
// placeholder for real phase selection, not a real "current phase" concept
// yet. Flagged in memory.md as something M2-follow-on (Phase 2/3 seeding,
// or a Settings phase switcher) will need to revisit.
func activePhaseID(ctx context.Context, conn *sql.DB) (int64, error) {
	var id int64
	err := conn.QueryRowContext(ctx, `SELECT id FROM phases ORDER BY id DESC LIMIT 1`).Scan(&id)
	if err == sql.ErrNoRows {
		return 0, ErrNoActivePhase
	}
	return id, err
}

func dayTemplateFor(ctx context.Context, conn *sql.DB, phaseID int64, weekday int) (DayTemplateInfo, error) {
	var dt DayTemplateInfo
	err := conn.QueryRowContext(ctx, `
		SELECT id, name, kind FROM day_templates WHERE phase_id = ? AND weekday = ?
	`, phaseID, weekday).Scan(&dt.ID, &dt.Name, &dt.Kind)
	if err == sql.ErrNoRows {
		return DayTemplateInfo{}, ErrNoDayTemplate
	}
	return dt, err
}

// ensureSession returns the session row for `date`, creating it as 'planned'
// on first view. `sessions.date` is UNIQUE, so this is safe to call
// repeatedly for the same date without creating duplicates.
func ensureSession(ctx context.Context, conn *sql.DB, date string, dayTemplateID int64) (*Session, error) {
	s, err := scanSession(ctx, conn, date)
	if err == nil {
		return s, nil
	}
	if err != sql.ErrNoRows {
		return nil, err
	}

	if _, err := conn.ExecContext(ctx, `
		INSERT INTO sessions (date, day_template_id, status) VALUES (?, ?, 'planned')
	`, date, dayTemplateID); err != nil {
		return nil, fmt.Errorf("create session for %s: %w", date, err)
	}
	return scanSession(ctx, conn, date)
}

func scanSession(ctx context.Context, conn *sql.DB, date string) (*Session, error) {
	var s Session
	err := conn.QueryRowContext(ctx, `
		SELECT id, status, started_at, ended_at, note FROM sessions WHERE date = ?
	`, date).Scan(&s.ID, &s.Status, &s.StartedAt, &s.EndedAt, &s.Note)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func slotsFor(ctx context.Context, conn *sql.DB, dayTemplateID int64) ([]Slot, error) {
	rows, err := conn.QueryContext(ctx, `
		SELECT s.id, s.position, s.sets, s.reps, s.load_kg, s.note,
		       e.id, e.slug, e.name, e.unilateral, e.increment_kg
		FROM slots s
		JOIN exercises e ON e.id = s.exercise_id
		WHERE s.day_template_id = ?
		ORDER BY s.position
	`, dayTemplateID)
	if err != nil {
		return nil, err
	}

	type row struct {
		slotID int64
		slot   Slot
	}
	var out []row
	for rows.Next() {
		var r row
		if err := rows.Scan(
			&r.slotID, &r.slot.Position, &r.slot.Sets, &r.slot.Reps, &r.slot.LoadKg, &r.slot.Note,
			&r.slot.Exercise.ID, &r.slot.Exercise.Slug, &r.slot.Exercise.Name, &r.slot.Exercise.Unilateral, &r.slot.Exercise.IncrementKg,
		); err != nil {
			rows.Close()
			return nil, err
		}
		r.slot.Swaps = []ExerciseRef{}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close() // close before issuing more queries — db.Open caps the pool at one connection

	for i := range out {
		out[i].slot.ID = out[i].slotID

		swaps, err := swapsFor(ctx, conn, out[i].slotID)
		if err != nil {
			return nil, err
		}
		out[i].slot.Swaps = swaps

		last, err := lastActual(ctx, conn, out[i].slot.Exercise.ID)
		if err != nil {
			return nil, err
		}
		out[i].slot.LastActual = last
	}

	slots := make([]Slot, len(out))
	for i, r := range out {
		slots[i] = r.slot
	}
	return slots, nil
}

func swapsFor(ctx context.Context, conn *sql.DB, slotID int64) ([]ExerciseRef, error) {
	rows, err := conn.QueryContext(ctx, `
		SELECT e.id, e.slug, e.name, e.unilateral, e.increment_kg
		FROM slot_swaps ss
		JOIN exercises e ON e.id = ss.exercise_id
		WHERE ss.slot_id = ?
		ORDER BY ss.position
	`, slotID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	swaps := []ExerciseRef{}
	for rows.Next() {
		var e ExerciseRef
		if err := rows.Scan(&e.ID, &e.Slug, &e.Name, &e.Unilateral, &e.IncrementKg); err != nil {
			return nil, err
		}
		swaps = append(swaps, e)
	}
	return swaps, rows.Err()
}

// lastActual is the most recently logged *done* set for this exercise,
// across any session — the pre-fill hint for the session runner (prd.md
// §A3.3: "Set rows pre-fill with the last logged actual for that exercise").
// Skipped sets never count as an actual.
func lastActual(ctx context.Context, conn *sql.DB, exerciseID int64) (*Actual, error) {
	var a Actual
	err := conn.QueryRowContext(ctx, `
		SELECT load_kg, reps FROM logged_sets
		WHERE exercise_id = ? AND status = 'done'
		ORDER BY logged_at DESC LIMIT 1
	`, exerciseID).Scan(&a.LoadKg, &a.Reps)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}
