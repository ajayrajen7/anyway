// Package sync implements the write side of every outbox entity the client
// produces (docs/architecture.md §B2's outbox, drained by app/src/lib/sync.ts
// — M9).
//
// Each entity here is idempotent in the exact sense §B5 promises: replaying
// the same payload — a retried sync POST, or the same outbox row drained
// twice — must never create a second row. For logged_sets that's a real
// upsert-by-client_uuid (ON CONFLICT DO NOTHING: the client never revises an
// already-logged set through this path — SessionRunner logs each commit as
// a new, permanent event, never an edit of a previous one, so a second
// logSet with a different client_uuid for the same set_index is a deliberate
// new history entry, not a duplicate). Every other entity is keyed by its
// own natural key (a date, or date+modality) and INSERT-OR-REPLACEs, which
// is idempotent by construction.
package sync

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

// execer is satisfied by *sql.DB — everything here runs as a single
// statement, so there's no need for the Tx-or-DB flexibility settings.execer
// has (programme.Apply never calls into this package).
type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// --- logged_set ---

// SetPayload mirrors app/src/lib/types.ts#LoggedSet exactly (minus the
// client-only optional `id`).
type SetPayload struct {
	ClientUUID string   `json:"client_uuid"`
	SessionID  int64    `json:"session_id"`
	SlotID     *int64   `json:"slot_id"`
	ExerciseID int64    `json:"exercise_id"`
	SetIndex   int      `json:"set_index"`
	LoadKg     *float64 `json:"load_kg"`
	Reps       *int     `json:"reps"`
	Status     string   `json:"status"`
	Provenance string   `json:"provenance"`
	AddedBy    *string  `json:"added_by"`
	LoggedAt   string   `json:"logged_at"`
}

func LogSet(ctx context.Context, conn execer, p SetPayload) error {
	if p.ClientUUID == "" {
		return fmt.Errorf("logged_set: missing client_uuid")
	}
	_, err := conn.ExecContext(ctx, `
		INSERT INTO logged_sets
			(session_id, slot_id, exercise_id, set_index, load_kg, reps, status, provenance, added_by, logged_at, client_uuid)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(client_uuid) DO NOTHING
	`, p.SessionID, p.SlotID, p.ExerciseID, p.SetIndex, p.LoadKg, p.Reps, p.Status, p.Provenance, p.AddedBy, p.LoggedAt, p.ClientUUID)
	return err
}

// queryer is the read counterpart of execer — satisfied by *sql.DB too.
type queryer interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

// execQueryer is satisfied by *sql.DB — CompleteSession needs both: it
// writes `sessions.status` and then, via ReconcileSlots, reads and writes
// `slots` too.
type execQueryer interface {
	execer
	queryer
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// SetRecord is SetPayload plus the server's own row id — the shape returned
// by GET /api/sessions/:id/sets (see ListSetsForSession), read back down to
// a client whose local copy of a session's detail has gone missing. This is
// the one read path back out of logged_sets for a client — everywhere else
// this package only ever receives writes (see the package doc above).
type SetRecord struct {
	ID int64 `json:"id"`
	SetPayload
}

// ListSetsForSession answers GET /api/sessions/:id/sets — a deliberate,
// narrow exception to this server's write-only relationship with
// logged_sets (see the package doc). It exists for exactly one purpose:
// letting a client whose local IndexedDB has lost (or never had, in a
// separate browser storage container — see memory.md's "session data lost"
// entry) a session's set-by-set detail reconstruct it from the server's own
// copy, rather than that detail being permanently gone. Every set this
// server has ever received for the session comes back, oldest first —
// exactly the write order logged_sets itself preserves via its own
// autoincrement id, which is also `logged_at` order in practice.
//
// `client_uuid` is COALESCEd to a synthetic value for the small number of
// pre-M9 rows that predate that column (migration 0003 added it as a bare
// nullable ALTER TABLE, before the M9 sync worker existed to always supply
// one) — the client's own LoggedSet schema requires a non-empty string.
func ListSetsForSession(ctx context.Context, conn queryer, sessionID int64) ([]SetRecord, error) {
	rows, err := conn.QueryContext(ctx, `
		SELECT id, COALESCE(client_uuid, 'srv-' || id), session_id, slot_id, exercise_id, set_index,
		       load_kg, reps, status, provenance, added_by, logged_at
		FROM logged_sets
		WHERE session_id = ?
		ORDER BY id ASC
	`, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []SetRecord{}
	for rows.Next() {
		var s SetRecord
		if err := rows.Scan(&s.ID, &s.ClientUUID, &s.SessionID, &s.SlotID, &s.ExerciseID, &s.SetIndex,
			&s.LoadKg, &s.Reps, &s.Status, &s.Provenance, &s.AddedBy, &s.LoggedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// --- session_complete ---

// CompletePayload's RemovedSlotIDs (post-M12 addition) is the session's own
// SessionOverlay.removed, filtered client-side to the `slot-<id>` keys (an
// added-and-then-removed exercise was never a real slot to begin with —
// see app/src/lib/outbox.ts#completeSession) — the explicit "I deleted this
// exercise from this session" signal ReconcileSlots needs to tell "deleted
// on purpose" apart from "just never got to it."
type CompletePayload struct {
	SessionID      int64   `json:"session_id"`
	EndedAt        string  `json:"ended_at"`
	Note           *string `json:"note"`
	RemovedSlotIDs []int64 `json:"removed_slot_ids"`
}

func CompleteSession(ctx context.Context, conn execQueryer, p CompletePayload) error {
	if _, err := conn.ExecContext(ctx, `
		UPDATE sessions SET status = 'completed', ended_at = ?, note = ? WHERE id = ?
	`, p.EndedAt, p.Note, p.SessionID); err != nil {
		return err
	}
	return ReconcileSlots(ctx, conn, p.SessionID, p.RemovedSlotIDs)
}

// ReconcileSlots implements "this week's actual executed plan becomes the
// default base for next week — including weights/reps performed" (post-M12,
// asked and confirmed — see memory.md). Runs once, right after a session is
// marked complete, and folds what actually happened back into the
// day_template's own `slots` — permanently, for every future week that
// reuses the same template, not a one-off note ("a real ratcheting/adaptive
// model," the owner's own words for the confirmed scope).
//
// Reps/load already default to the last thing you actually did, indefinitely,
// via the pre-existing `last_actual` prefill (exercise-scoped, not
// week-scoped — see today.go#lastActual) — that needed no change here.
// What's new is folding the *target* (slots.sets/reps/load_kg) forward too,
// and carrying exercise substitutions forward:
//
//   - An exercise with ≥1 *done* set this session updates its slot's
//     sets/reps/load_kg to match what was actually done (sets = how many you
//     did; reps/load = your last done set's numbers — the same "most recent
//     actual" `last_actual` already surfaces). A *swapped-in* exercise
//     updates that same slot's exercise_id too — the swap becomes permanent.
//     A session-*added* exercise (no slot_id) gets a brand-new slot appended
//     to the day_template, or updates an already-promoted one from a prior
//     week rather than duplicating it.
//   - An exercise the session's overlay explicitly deleted (removedSlotIDs)
//     is deactivated (`active = 0`), not hard-deleted — see the
//     slots.active migration's own comment for why (FK-enforced
//     logged_sets.slot_id, past sessions may still reference it).
//
// An exercise simply never reached this session (zero done sets, not
// explicitly deleted) is left completely untouched — owner-confirmed:
// "keep it prescribed." Only the overlay's own explicit deletion list means
// "remove this," never a plain absence of logged sets.
func ReconcileSlots(ctx context.Context, conn execQueryer, sessionID int64, removedSlotIDs []int64) error {
	var dayTemplateID sql.NullInt64
	if err := conn.QueryRowContext(ctx, `SELECT day_template_id FROM sessions WHERE id = ?`, sessionID).Scan(&dayTemplateID); err != nil {
		return fmt.Errorf("reconcile: load session %d: %w", sessionID, err)
	}
	if !dayTemplateID.Valid {
		return nil // a non-lifting session has no day_template/slots to reconcile against
	}

	type group struct {
		slotID     sql.NullInt64
		exerciseID int64
		sets       int
		lastReps   int
		lastLoad   *float64
	}
	groups := map[int64]*group{} // keyed by exercise_id
	order := []int64{}           // first-seen order, for deterministic new-slot positioning

	rows, err := conn.QueryContext(ctx, `
		SELECT slot_id, exercise_id, set_index, reps, load_kg
		FROM logged_sets
		WHERE session_id = ? AND status = 'done'
		ORDER BY exercise_id, set_index
	`, sessionID)
	if err != nil {
		return fmt.Errorf("reconcile: load done sets for session %d: %w", sessionID, err)
	}
	for rows.Next() {
		var slotID sql.NullInt64
		var exerciseID int64
		var setIndex, reps int
		var loadKg sql.NullFloat64
		if err := rows.Scan(&slotID, &exerciseID, &setIndex, &reps, &loadKg); err != nil {
			rows.Close()
			return err
		}
		g, ok := groups[exerciseID]
		if !ok {
			g = &group{exerciseID: exerciseID}
			groups[exerciseID] = g
			order = append(order, exerciseID)
		}
		g.sets++
		// Rows arrive ordered by set_index within each exercise, so the last
		// one seen is always the highest set_index — the same "most recent
		// actual" convention today.go#lastActual already uses.
		g.lastReps = reps
		if loadKg.Valid {
			v := loadKg.Float64
			g.lastLoad = &v
		} else {
			g.lastLoad = nil
		}
		if slotID.Valid && !g.slotID.Valid {
			g.slotID = slotID
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close() // close before issuing more queries — db.Open caps the pool at one connection

	for _, exerciseID := range order {
		g := groups[exerciseID]
		if g.slotID.Valid {
			if _, err := conn.ExecContext(ctx, `
				UPDATE slots SET exercise_id = ?, sets = ?, reps = ?, load_kg = ? WHERE id = ?
			`, g.exerciseID, g.sets, g.lastReps, g.lastLoad, g.slotID.Int64); err != nil {
				return fmt.Errorf("reconcile: update slot %d: %w", g.slotID.Int64, err)
			}
			continue
		}

		// No slot_id — a session-added exercise. Reuse an already-active
		// slot for it in this day_template if a prior week's session
		// already promoted it, rather than inserting a duplicate every
		// week it's logged.
		var existingID sql.NullInt64
		err := conn.QueryRowContext(ctx, `
			SELECT id FROM slots WHERE day_template_id = ? AND exercise_id = ? AND active = 1
		`, dayTemplateID.Int64, g.exerciseID).Scan(&existingID)
		if err != nil && err != sql.ErrNoRows {
			return fmt.Errorf("reconcile: look up existing slot for exercise %d: %w", g.exerciseID, err)
		}
		if existingID.Valid {
			if _, err := conn.ExecContext(ctx, `
				UPDATE slots SET sets = ?, reps = ?, load_kg = ? WHERE id = ?
			`, g.sets, g.lastReps, g.lastLoad, existingID.Int64); err != nil {
				return fmt.Errorf("reconcile: update promoted slot %d: %w", existingID.Int64, err)
			}
			continue
		}

		var maxPos sql.NullInt64
		if err := conn.QueryRowContext(ctx, `SELECT MAX(position) FROM slots WHERE day_template_id = ?`, dayTemplateID.Int64).Scan(&maxPos); err != nil {
			return fmt.Errorf("reconcile: load max position for day_template %d: %w", dayTemplateID.Int64, err)
		}
		nextPos := int64(1)
		if maxPos.Valid {
			nextPos = maxPos.Int64 + 1
		}
		if _, err := conn.ExecContext(ctx, `
			INSERT INTO slots (day_template_id, position, exercise_id, sets, reps, load_kg, note, active)
			VALUES (?, ?, ?, ?, ?, ?, NULL, 1)
		`, dayTemplateID.Int64, nextPos, g.exerciseID, g.sets, g.lastReps, g.lastLoad); err != nil {
			return fmt.Errorf("reconcile: insert new slot for exercise %d: %w", g.exerciseID, err)
		}
	}

	for _, slotID := range removedSlotIDs {
		if _, err := conn.ExecContext(ctx, `
			UPDATE slots SET active = 0 WHERE id = ? AND day_template_id = ?
		`, slotID, dayTemplateID.Int64); err != nil {
			return fmt.Errorf("reconcile: deactivate slot %d: %w", slotID, err)
		}
	}
	return nil
}

// --- day_skip ---

// DaySkipPayload (post-M12 addition) — a real, distinct "not doing this
// day" state, separate from an unlogged day that internal/today's
// sweepMissed later flips to 'missed'. Applies to any day kind — a
// cardio_mobility/rest day has no `sessions` row to carry a status on, so
// this can't live there.
type DaySkipPayload struct {
	Date    string `json:"date"`
	Skipped bool   `json:"skipped"` // false = undo a skip (see app/src/lib/dailyLogs.ts#clearSkipDay)
}

func DaySkip(ctx context.Context, conn execer, p DaySkipPayload) error {
	if !p.Skipped {
		_, err := conn.ExecContext(ctx, `DELETE FROM day_skips WHERE date = ?`, p.Date)
		return err
	}
	_, err := conn.ExecContext(ctx, `
		INSERT INTO day_skips (date, skipped_at) VALUES (?, ?)
		ON CONFLICT(date) DO UPDATE SET skipped_at = excluded.skipped_at
	`, p.Date, time.Now().UTC().Format(time.RFC3339))
	return err
}

// --- morning_check ---

type MorningCheckPayload struct {
	Date string `json:"date"`
	Pain string `json:"pain"`
}

func MorningCheck(ctx context.Context, conn execer, p MorningCheckPayload) error {
	_, err := conn.ExecContext(ctx, `
		INSERT INTO morning_checks (date, pain) VALUES (?, ?)
		ON CONFLICT(date) DO UPDATE SET pain = excluded.pain
	`, p.Date, p.Pain)
	return err
}

// --- protein_log ---

// ProteinPayload (UX addition, post-M12): Grams is now the real manually-
// entered value (like Steps); Hit is derived client-side from grams >= 120
// and still sent/stored so Week Plan's existing day-completion grading
// (src/lib/week.ts#computeDayCompletion) needs no changes at all.
type ProteinPayload struct {
	Date  string `json:"date"`
	Grams int    `json:"grams"`
	Hit   bool   `json:"hit"`
}

func Protein(ctx context.Context, conn execer, p ProteinPayload) error {
	_, err := conn.ExecContext(ctx, `
		INSERT INTO protein_logs (date, grams, hit) VALUES (?, ?, ?)
		ON CONFLICT(date) DO UPDATE SET grams = excluded.grams, hit = excluded.hit
	`, p.Date, p.Grams, p.Hit)
	return err
}

// --- mobility_log ---

// MobilityPayload (UX addition, post-M12): DurationMin is now a real
// manually-entered 0-10 min value on a lifting day (like Steps), not
// presence-only. The Wed/Sat "Full mobility" checkbox (CardioMobilityDay)
// still calls this same route — it just always sends a real duration now
// (defaulting to 10, see dailyLogs.ts#logMobility) instead of nothing.
// `done` is kept alongside for anything that still reads pure presence.
type MobilityPayload struct {
	Date        string `json:"date"`
	DurationMin int    `json:"duration_min"`
}

func Mobility(ctx context.Context, conn execer, p MobilityPayload) error {
	_, err := conn.ExecContext(ctx, `
		INSERT INTO mobility_logs (date, done, duration_min) VALUES (?, 1, ?)
		ON CONFLICT(date) DO UPDATE SET done = 1, duration_min = excluded.duration_min
	`, p.Date, p.DurationMin)
	return err
}

// --- cardio_log ---

type CardioPayload struct {
	Date        string `json:"date"`
	Modality    string `json:"modality"`
	DurationMin int    `json:"duration_min"`
}

// Cardio matches the client's own delete-then-insert convention for
// (date, modality) — see app/src/lib/dailyLogs.ts#logCardio — so re-syncing
// an adjusted duration replaces the row rather than accumulating rows.
func Cardio(ctx context.Context, conn execer, p CardioPayload) error {
	if _, err := conn.ExecContext(ctx, `DELETE FROM cardio_logs WHERE date = ? AND modality = ?`, p.Date, p.Modality); err != nil {
		return err
	}
	_, err := conn.ExecContext(ctx, `
		INSERT INTO cardio_logs (date, modality, duration_min) VALUES (?, ?, ?)
	`, p.Date, p.Modality, p.DurationMin)
	return err
}

// --- steps_log ---

// StepsPayload is a real daily count, not presence-only (mirrors
// protein_logs' shape, not mobility_logs'; see app/src/lib/dailyLogs.ts).
type StepsPayload struct {
	Date  string `json:"date"`
	Steps int    `json:"steps"`
}

func Steps(ctx context.Context, conn execer, p StepsPayload) error {
	_, err := conn.ExecContext(ctx, `
		INSERT INTO steps_logs (date, steps) VALUES (?, ?)
		ON CONFLICT(date) DO UPDATE SET steps = excluded.steps
	`, p.Date, p.Steps)
	return err
}

// --- batch drain (POST /api/sync) ---

// Entry mirrors one row of app/src/lib/types.ts#OutboxEntry, minus the
// fields the server has no use for (id, created_at, synced_at — sync
// success/failure is reported back per-entry in Result instead, and the
// client marks its own synced_at from that).
type Entry struct {
	Entity   string          `json:"entity"`
	EntityID string          `json:"entity_id"`
	Payload  json.RawMessage `json:"payload"`
}

// Result reports one Entry's outcome. Entity+EntityID together (not
// EntityID alone) are the key the client matches back against its own
// outbox rows — two different entities can share the same entity_id (e.g. a
// protein_log and a mobility_log both keyed by the same date).
type Result struct {
	Entity   string `json:"entity"`
	EntityID string `json:"entity_id"`
	OK       bool   `json:"ok"`
	Error    string `json:"error,omitempty"`
}

// Drain applies every entry independently and best-effort — one bad or
// malformed entry must never block the rest of the batch from syncing, same
// spirit as "an outbox drain" in general.
func Drain(ctx context.Context, conn *sql.DB, entries []Entry) []Result {
	results := make([]Result, 0, len(entries))
	for _, e := range entries {
		err := dispatch(ctx, conn, e)
		res := Result{Entity: e.Entity, EntityID: e.EntityID, OK: err == nil}
		if err != nil {
			res.Error = err.Error()
		}
		results = append(results, res)
	}
	return results
}

func dispatch(ctx context.Context, conn *sql.DB, e Entry) error {
	switch e.Entity {
	case "logged_set":
		var p SetPayload
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			return fmt.Errorf("decode logged_set payload: %w", err)
		}
		return LogSet(ctx, conn, p)
	case "session_complete":
		var p CompletePayload
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			return fmt.Errorf("decode session_complete payload: %w", err)
		}
		return CompleteSession(ctx, conn, p)
	case "morning_check":
		var p MorningCheckPayload
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			return fmt.Errorf("decode morning_check payload: %w", err)
		}
		return MorningCheck(ctx, conn, p)
	case "protein_log":
		var p ProteinPayload
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			return fmt.Errorf("decode protein_log payload: %w", err)
		}
		return Protein(ctx, conn, p)
	case "mobility_log":
		var p MobilityPayload
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			return fmt.Errorf("decode mobility_log payload: %w", err)
		}
		return Mobility(ctx, conn, p)
	case "cardio_log":
		var p CardioPayload
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			return fmt.Errorf("decode cardio_log payload: %w", err)
		}
		return Cardio(ctx, conn, p)
	case "steps_log":
		var p StepsPayload
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			return fmt.Errorf("decode steps_log payload: %w", err)
		}
		return Steps(ctx, conn, p)
	case "day_skip":
		var p DaySkipPayload
		if err := json.Unmarshal(e.Payload, &p); err != nil {
			return fmt.Errorf("decode day_skip payload: %w", err)
		}
		return DaySkip(ctx, conn, p)
	default:
		return fmt.Errorf("unknown outbox entity %q", e.Entity)
	}
}
