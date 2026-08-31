package sync_test

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/ajayrajen7/anyway/server/internal/db"
	syncpkg "github.com/ajayrajen7/anyway/server/internal/sync"
)

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	return conn
}

// seedOneSession inserts the minimum a logged_sets row's foreign keys need
// (an exercise, a phase/day_template, and a session) so LogSet has somewhere
// real to point at.
func seedOneSession(t *testing.T, conn *sql.DB) (sessionID, exerciseID int64) {
	t.Helper()
	res, err := conn.Exec(`INSERT INTO exercises (slug, name, equipment, pressure, impact, increment_kg) VALUES ('squat','Squat','barbell','moderate','low',2.5)`)
	if err != nil {
		t.Fatalf("seed exercise: %v", err)
	}
	exerciseID, _ = res.LastInsertId()
	res, err = conn.Exec(`INSERT INTO sessions (date, status) VALUES ('2026-01-05', 'planned')`)
	if err != nil {
		t.Fatalf("seed session: %v", err)
	}
	sessionID, _ = res.LastInsertId()
	return sessionID, exerciseID
}

func TestLogSetIsIdempotentByClientUUID(t *testing.T) {
	conn := openTestDB(t)
	ctx := t.Context()
	sessionID, exerciseID := seedOneSession(t, conn)

	load := 60.0
	reps := 8
	p := syncpkg.SetPayload{
		ClientUUID: "uuid-1", SessionID: sessionID, ExerciseID: exerciseID,
		SetIndex: 1, LoadKg: &load, Reps: &reps, Status: "done",
		Provenance: "prescribed", LoggedAt: "2026-01-05T10:00:00Z",
	}
	if err := syncpkg.LogSet(ctx, conn, p); err != nil {
		t.Fatalf("first LogSet: %v", err)
	}
	// Replay — a retried sync POST. Must not create a second row.
	if err := syncpkg.LogSet(ctx, conn, p); err != nil {
		t.Fatalf("replayed LogSet: %v", err)
	}

	var count int
	if err := conn.QueryRow(`SELECT COUNT(*) FROM logged_sets WHERE client_uuid = ?`, "uuid-1").Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected exactly 1 row after a replayed sync, got %d", count)
	}
}

func TestCompleteSessionUpdatesStatus(t *testing.T) {
	conn := openTestDB(t)
	ctx := t.Context()
	sessionID, _ := seedOneSession(t, conn)

	note := "felt good"
	if err := syncpkg.CompleteSession(ctx, conn, syncpkg.CompletePayload{SessionID: sessionID, EndedAt: "2026-01-05T11:00:00Z", Note: &note}); err != nil {
		t.Fatalf("CompleteSession: %v", err)
	}

	var status, endedAt, gotNote string
	if err := conn.QueryRow(`SELECT status, ended_at, note FROM sessions WHERE id = ?`, sessionID).Scan(&status, &endedAt, &gotNote); err != nil {
		t.Fatalf("scan: %v", err)
	}
	if status != "completed" || endedAt != "2026-01-05T11:00:00Z" || gotNote != "felt good" {
		t.Fatalf("got status=%q ended_at=%q note=%q", status, endedAt, gotNote)
	}
}

func TestMorningCheckUpsertsByDate(t *testing.T) {
	conn := openTestDB(t)
	ctx := t.Context()

	if err := syncpkg.MorningCheck(ctx, conn, syncpkg.MorningCheckPayload{Date: "2026-01-05", Pain: "background"}); err != nil {
		t.Fatalf("first: %v", err)
	}
	if err := syncpkg.MorningCheck(ctx, conn, syncpkg.MorningCheckPayload{Date: "2026-01-05", Pain: "limiting"}); err != nil {
		t.Fatalf("second: %v", err)
	}

	var pain string
	if err := conn.QueryRow(`SELECT pain FROM morning_checks WHERE date = ?`, "2026-01-05").Scan(&pain); err != nil {
		t.Fatalf("scan: %v", err)
	}
	if pain != "limiting" {
		t.Fatalf("expected the second write to win, got %q", pain)
	}
	var count int
	conn.QueryRow(`SELECT COUNT(*) FROM morning_checks`).Scan(&count)
	if count != 1 {
		t.Fatalf("expected exactly one row for the date, got %d", count)
	}
}

func TestMobilityAlwaysWritesDoneTrue(t *testing.T) {
	conn := openTestDB(t)
	if err := syncpkg.Mobility(t.Context(), conn, syncpkg.MobilityPayload{Date: "2026-01-05"}); err != nil {
		t.Fatalf("Mobility: %v", err)
	}
	var done bool
	if err := conn.QueryRow(`SELECT done FROM mobility_logs WHERE date = ?`, "2026-01-05").Scan(&done); err != nil {
		t.Fatalf("scan: %v", err)
	}
	if !done {
		t.Fatalf("expected done = true")
	}
}

// UX addition (post-M12): mobility is now a manual 0-10 min entry (like
// Steps) — the second write with an updated duration must replace, not
// accumulate, matching the client's own upsert-by-date pattern.
func TestMobilityUpsertsDuration(t *testing.T) {
	conn := openTestDB(t)
	ctx := t.Context()
	if err := syncpkg.Mobility(ctx, conn, syncpkg.MobilityPayload{Date: "2026-01-05", DurationMin: 3}); err != nil {
		t.Fatalf("first Mobility: %v", err)
	}
	if err := syncpkg.Mobility(ctx, conn, syncpkg.MobilityPayload{Date: "2026-01-05", DurationMin: 7}); err != nil {
		t.Fatalf("second Mobility: %v", err)
	}
	var count, duration int
	conn.QueryRow(`SELECT COUNT(*), MAX(duration_min) FROM mobility_logs WHERE date = ?`, "2026-01-05").Scan(&count, &duration)
	if count != 1 || duration != 7 {
		t.Fatalf("expected exactly 1 row at 7 min, got count=%d duration=%d", count, duration)
	}
}

// UX addition (post-M12): protein is now a manual grams entry (like Steps)
// — Hit is still derived+sent by the client and stored as-is, so Week
// Plan's existing grading needs no server-side change.
func TestProteinStoresGramsAndDerivedHit(t *testing.T) {
	conn := openTestDB(t)
	if err := syncpkg.Protein(t.Context(), conn, syncpkg.ProteinPayload{Date: "2026-01-05", Grams: 140, Hit: true}); err != nil {
		t.Fatalf("Protein: %v", err)
	}
	var grams int
	var hit bool
	if err := conn.QueryRow(`SELECT grams, hit FROM protein_logs WHERE date = ?`, "2026-01-05").Scan(&grams, &hit); err != nil {
		t.Fatalf("scan: %v", err)
	}
	if grams != 140 || !hit {
		t.Fatalf("expected grams=140 hit=true, got grams=%d hit=%v", grams, hit)
	}
}

func TestCardioReplacesRatherThanAccumulates(t *testing.T) {
	conn := openTestDB(t)
	ctx := t.Context()
	if err := syncpkg.Cardio(ctx, conn, syncpkg.CardioPayload{Date: "2026-01-07", Modality: "cross-trainer", DurationMin: 20}); err != nil {
		t.Fatalf("first: %v", err)
	}
	if err := syncpkg.Cardio(ctx, conn, syncpkg.CardioPayload{Date: "2026-01-07", Modality: "cross-trainer", DurationMin: 25}); err != nil {
		t.Fatalf("second: %v", err)
	}
	var count, duration int
	conn.QueryRow(`SELECT COUNT(*), MAX(duration_min) FROM cardio_logs WHERE date = ? AND modality = ?`, "2026-01-07", "cross-trainer").Scan(&count, &duration)
	if count != 1 || duration != 25 {
		t.Fatalf("expected exactly 1 row at 25 min, got count=%d duration=%d", count, duration)
	}
}

func TestStepsUpserts(t *testing.T) {
	conn := openTestDB(t)
	ctx := t.Context()
	if err := syncpkg.Steps(ctx, conn, syncpkg.StepsPayload{Date: "2026-01-04", Steps: 6000}); err != nil {
		t.Fatalf("first Steps: %v", err)
	}
	if err := syncpkg.Steps(ctx, conn, syncpkg.StepsPayload{Date: "2026-01-04", Steps: 8200}); err != nil {
		t.Fatalf("second Steps: %v", err)
	}
	var count, steps int
	conn.QueryRow(`SELECT COUNT(*), MAX(steps) FROM steps_logs WHERE date = ?`, "2026-01-04").Scan(&count, &steps)
	if count != 1 || steps != 8200 {
		t.Fatalf("expected exactly 1 row at 8200 steps, got count=%d steps=%d", count, steps)
	}
}

func TestDrainProcessesEveryEntryIndependently(t *testing.T) {
	conn := openTestDB(t)
	_, exerciseID := seedOneSession(t, conn)
	res, _ := conn.Exec(`INSERT INTO sessions (date, status) VALUES ('2026-01-06', 'planned')`)
	sessionID, _ := res.LastInsertId()

	setPayload, _ := json.Marshal(syncpkg.SetPayload{
		ClientUUID: "uuid-2", SessionID: sessionID, ExerciseID: exerciseID,
		SetIndex: 1, Status: "done", Provenance: "prescribed", LoggedAt: "2026-01-06T10:00:00Z",
	})
	proteinPayload, _ := json.Marshal(syncpkg.ProteinPayload{Date: "2026-01-06", Hit: true})
	badPayload := json.RawMessage(`{"not": "valid for logged_set"`) // malformed JSON, deliberately

	entries := []syncpkg.Entry{
		{Entity: "logged_set", EntityID: "uuid-2", Payload: setPayload},
		{Entity: "protein_log", EntityID: "2026-01-06", Payload: proteinPayload},
		{Entity: "logged_set", EntityID: "uuid-bad", Payload: badPayload},
		{Entity: "made_up_entity", EntityID: "x", Payload: json.RawMessage(`{}`)},
	}

	results := syncpkg.Drain(t.Context(), conn, entries)
	if len(results) != 4 {
		t.Fatalf("expected 4 results, got %d", len(results))
	}
	if !results[0].OK || !results[1].OK {
		t.Fatalf("expected the two valid entries to succeed, got %+v", results[:2])
	}
	if results[2].OK || results[2].Error == "" {
		t.Fatalf("expected the malformed entry to fail with an error message, got %+v", results[2])
	}
	if results[3].OK || results[3].Error == "" {
		t.Fatalf("expected the unknown-entity entry to fail with an error message, got %+v", results[3])
	}

	// The two good entries actually landed, proving one bad entry didn't
	// abort the batch.
	var count int
	conn.QueryRow(`SELECT COUNT(*) FROM logged_sets WHERE client_uuid = 'uuid-2'`).Scan(&count)
	if count != 1 {
		t.Fatalf("expected the valid logged_set to have been written, got count=%d", count)
	}
}

// ListSetsForSession — the recovery read path (GET /api/sessions/:id/sets),
// see the doc comment on the function itself for why it exists.
func TestListSetsForSessionReturnsEveryLoggedSetInOrder(t *testing.T) {
	conn := openTestDB(t)
	ctx := t.Context()
	sessionID, exerciseID := seedOneSession(t, conn)

	load1, reps1 := 60.0, 8
	load2, reps2 := 62.5, 6
	if err := syncpkg.LogSet(ctx, conn, syncpkg.SetPayload{
		ClientUUID: "uuid-a", SessionID: sessionID, ExerciseID: exerciseID,
		SetIndex: 1, LoadKg: &load1, Reps: &reps1, Status: "done",
		Provenance: "prescribed", LoggedAt: "2026-01-05T10:00:00Z",
	}); err != nil {
		t.Fatalf("LogSet 1: %v", err)
	}
	if err := syncpkg.LogSet(ctx, conn, syncpkg.SetPayload{
		ClientUUID: "uuid-b", SessionID: sessionID, ExerciseID: exerciseID,
		SetIndex: 2, LoadKg: &load2, Reps: &reps2, Status: "done",
		Provenance: "prescribed", LoggedAt: "2026-01-05T10:05:00Z",
	}); err != nil {
		t.Fatalf("LogSet 2: %v", err)
	}

	sets, err := syncpkg.ListSetsForSession(ctx, conn, sessionID)
	if err != nil {
		t.Fatalf("ListSetsForSession: %v", err)
	}
	if len(sets) != 2 {
		t.Fatalf("expected 2 sets, got %d", len(sets))
	}
	if sets[0].ClientUUID != "uuid-a" || sets[1].ClientUUID != "uuid-b" {
		t.Fatalf("expected sets back in write order, got %+v", sets)
	}
	if sets[0].SessionID != sessionID || sets[0].SetIndex != 1 || *sets[0].LoadKg != 60.0 {
		t.Fatalf("expected the first set's own fields intact, got %+v", sets[0])
	}
}

func TestListSetsForSessionIsEmptyForANoSetsSession(t *testing.T) {
	conn := openTestDB(t)
	ctx := t.Context()
	sessionID, _ := seedOneSession(t, conn)

	sets, err := syncpkg.ListSetsForSession(ctx, conn, sessionID)
	if err != nil {
		t.Fatalf("ListSetsForSession: %v", err)
	}
	if len(sets) != 0 {
		t.Fatalf("expected no sets, got %d", len(sets))
	}
}

func TestListSetsForSessionDoesNotConflateOtherSessions(t *testing.T) {
	conn := openTestDB(t)
	ctx := t.Context()
	sessionID, exerciseID := seedOneSession(t, conn)
	// A second session — sessions.date is UNIQUE, so seedOneSession's own
	// hardcoded date can't be reused; insert this one directly with a
	// different date instead.
	res, err := conn.Exec(`INSERT INTO sessions (date, status) VALUES ('2026-01-06', 'planned')`)
	if err != nil {
		t.Fatalf("seed other session: %v", err)
	}
	otherSessionID, _ := res.LastInsertId()

	load, reps := 60.0, 8
	if err := syncpkg.LogSet(ctx, conn, syncpkg.SetPayload{
		ClientUUID: "uuid-mine", SessionID: sessionID, ExerciseID: exerciseID,
		SetIndex: 1, LoadKg: &load, Reps: &reps, Status: "done",
		Provenance: "prescribed", LoggedAt: "2026-01-05T10:00:00Z",
	}); err != nil {
		t.Fatalf("LogSet mine: %v", err)
	}
	if err := syncpkg.LogSet(ctx, conn, syncpkg.SetPayload{
		ClientUUID: "uuid-other", SessionID: otherSessionID, ExerciseID: exerciseID,
		SetIndex: 1, LoadKg: &load, Reps: &reps, Status: "done",
		Provenance: "prescribed", LoggedAt: "2026-01-06T10:00:00Z",
	}); err != nil {
		t.Fatalf("LogSet other: %v", err)
	}

	sets, err := syncpkg.ListSetsForSession(ctx, conn, sessionID)
	if err != nil {
		t.Fatalf("ListSetsForSession: %v", err)
	}
	if len(sets) != 1 || sets[0].ClientUUID != "uuid-mine" {
		t.Fatalf("expected only the requested session's own set, got %+v", sets)
	}
}

// A pre-M9 row can have a NULL client_uuid — that column started as a bare
// nullable ALTER TABLE (migration 0003), before the sync worker existed to
// always supply one. The client's LoggedSet schema requires a non-empty
// string, so this must never come back as null/empty.
func TestListSetsForSessionSynthesizesAClientUUIDForALegacyNullRow(t *testing.T) {
	conn := openTestDB(t)
	ctx := t.Context()
	sessionID, exerciseID := seedOneSession(t, conn)

	res, err := conn.Exec(`
		INSERT INTO logged_sets (session_id, exercise_id, set_index, load_kg, reps, status, provenance, logged_at, client_uuid)
		VALUES (?, ?, 1, 60, 8, 'done', 'prescribed', '2026-01-05T10:00:00Z', NULL)
	`, sessionID, exerciseID)
	if err != nil {
		t.Fatalf("seed legacy row: %v", err)
	}
	rowID, _ := res.LastInsertId()

	sets, err := syncpkg.ListSetsForSession(ctx, conn, sessionID)
	if err != nil {
		t.Fatalf("ListSetsForSession: %v", err)
	}
	if len(sets) != 1 {
		t.Fatalf("expected 1 set, got %d", len(sets))
	}
	want := fmt.Sprintf("srv-%d", rowID)
	if sets[0].ClientUUID != want {
		t.Fatalf("expected a synthesized client_uuid %q, got %q", want, sets[0].ClientUUID)
	}
}
