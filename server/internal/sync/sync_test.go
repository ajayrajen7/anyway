package sync_test

import (
	"database/sql"
	"encoding/json"
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
