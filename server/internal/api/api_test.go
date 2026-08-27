package api_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ajayrajen7/anyway/server/internal/api"
	"github.com/ajayrajen7/anyway/server/internal/db"
	"github.com/ajayrajen7/anyway/server/internal/seed"
	"github.com/ajayrajen7/anyway/server/internal/settings"
	syncpkg "github.com/ajayrajen7/anyway/server/internal/sync"
)

func TestHealthz(t *testing.T) {
	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer conn.Close()

	router := api.NewRouter(conn, "secret")
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

// /api/week is still a 501 stub (M8) — used here purely to check the
// bearer-auth gate, independent of whatever any individual route actually
// does once implemented.
func TestApiRoutesRequireBearerToken(t *testing.T) {
	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer conn.Close()

	router := api.NewRouter(conn, "secret")

	req := httptest.NewRequest(http.MethodGet, "/api/week", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 with no token, got %d", rec.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/week", nil)
	req.Header.Set("Authorization", "Bearer wrong")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 with wrong token, got %d", rec.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/week", nil)
	req.Header.Set("Authorization", "Bearer secret")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotImplemented {
		t.Fatalf("expected 501 (stub) with correct token, got %d", rec.Code)
	}
}

func strPtr(s string) *string { return &s }

func TestListExercisesExcludesBlockedByDefaultButFindsThemOnSearch(t *testing.T) {
	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer conn.Close()

	_, err = seed.Apply(t.Context(), conn, []seed.Exercise{
		{Slug: "goblet-squat", Name: "Goblet squat", Equipment: "dumbbell", Pressure: "moderate", Impact: "none", IncrementKg: 2.5, Muscles: map[string]float64{"quads": 1.0}},
		{Slug: "running", Name: "Running", Equipment: "bodyweight", Pressure: "low", Impact: "high", IncrementKg: 1, Blocked: true, BlockReason: strPtr("Impact — knee and Achilles"), Muscles: map[string]float64{"calves": 1.0}},
	})
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	router := api.NewRouter(conn, "secret")

	req := httptest.NewRequest(http.MethodGet, "/api/exercises", nil)
	req.Header.Set("Authorization", "Bearer secret")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var listed []seed.Exercise
	if err := json.Unmarshal(rec.Body.Bytes(), &listed); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(listed) != 1 || listed[0].Slug != "goblet-squat" {
		t.Fatalf("expected only goblet-squat by default, got %+v", listed)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/exercises?q=running&include_blocked=1", nil)
	req.Header.Set("Authorization", "Bearer secret")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	listed = nil
	if err := json.Unmarshal(rec.Body.Bytes(), &listed); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(listed) != 1 || listed[0].BlockReason == nil {
		t.Fatalf("expected the blocked 'running' row with a reason, got %+v", listed)
	}
}

func TestGetTodayStatusCodes(t *testing.T) {
	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer conn.Close()
	router := api.NewRouter(conn, "secret")

	// No programme seeded yet — a real 404, not a lie-through-200.
	req := httptest.NewRequest(http.MethodGet, "/api/today?date=2026-01-05", nil)
	req.Header.Set("Authorization", "Bearer secret")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 with no active phase, got %d: %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/today?date=not-a-date", nil)
	req.Header.Set("Authorization", "Bearer secret")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for an unparseable date, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestGetProgrammeStatusCodes(t *testing.T) {
	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer conn.Close()
	router := api.NewRouter(conn, "secret")

	req := httptest.NewRequest(http.MethodGet, "/api/programme", nil)
	req.Header.Set("Authorization", "Bearer secret")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 with no active phase, got %d: %s", rec.Code, rec.Body.String())
	}
}

func doJSON(t *testing.T, router http.Handler, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatalf("encode body: %v", err)
		}
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Authorization", "Bearer secret")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestPostLogSetUsesPathIDAndIsIdempotent(t *testing.T) {
	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer conn.Close()
	if _, err := conn.Exec(`INSERT INTO exercises (slug, name, equipment, pressure, impact, increment_kg) VALUES ('squat','Squat','barbell','moderate','low',2.5)`); err != nil {
		t.Fatalf("seed exercise: %v", err)
	}
	if _, err := conn.Exec(`INSERT INTO sessions (id, date, status) VALUES (7, '2026-01-05', 'planned')`); err != nil {
		t.Fatalf("seed session: %v", err)
	}

	router := api.NewRouter(conn, "secret")
	load := 60.0
	reps := 8
	payload := syncpkg.SetPayload{
		ClientUUID: "route-uuid-1", ExerciseID: 1, SetIndex: 1,
		LoadKg: &load, Reps: &reps, Status: "done", Provenance: "prescribed", LoggedAt: "2026-01-05T10:00:00Z",
	}

	rec := doJSON(t, router, http.MethodPost, "/api/sessions/7/sets", payload)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
	// Replay — must not create a second row.
	rec = doJSON(t, router, http.MethodPost, "/api/sessions/7/sets", payload)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204 on replay, got %d: %s", rec.Code, rec.Body.String())
	}

	var sessionID int64
	var count int
	conn.QueryRow(`SELECT session_id FROM logged_sets WHERE client_uuid = 'route-uuid-1'`).Scan(&sessionID)
	conn.QueryRow(`SELECT COUNT(*) FROM logged_sets WHERE client_uuid = 'route-uuid-1'`).Scan(&count)
	if sessionID != 7 {
		t.Fatalf("expected the path's session id (7) to win over any body value, got %d", sessionID)
	}
	if count != 1 {
		t.Fatalf("expected exactly 1 row after replay, got %d", count)
	}
}

func TestWeighInsWriteAlwaysAllowedReadGatedByVault(t *testing.T) {
	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer conn.Close()
	router := api.NewRouter(conn, "secret")

	// Write is allowed even with no programme_start_date recorded at all.
	rec := doJSON(t, router, http.MethodPost, "/api/weigh-ins", map[string]any{"date": "2026-01-04", "weight_kg": 82.5})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected write to succeed regardless of vault state, got %d: %s", rec.Code, rec.Body.String())
	}

	// Read is 423 with no start date set (conservative default — locked).
	req := httptest.NewRequest(http.MethodGet, "/api/weigh-ins", nil)
	req.Header.Set("Authorization", "Bearer secret")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusLocked {
		t.Fatalf("expected 423 with no programme_start_date set, got %d: %s", rec.Code, rec.Body.String())
	}

	// Once the programme "started" 84+ days ago, the read unlocks.
	if err := settings.Set(t.Context(), conn, settings.ProgrammeStartDateKey, "2000-01-01"); err != nil {
		t.Fatalf("set start date: %v", err)
	}
	req = httptest.NewRequest(http.MethodGet, "/api/weigh-ins", nil)
	req.Header.Set("Authorization", "Bearer secret")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 once past day 84, got %d: %s", rec.Code, rec.Body.String())
	}
	var rows []syncpkg.WeighInRow
	if err := json.Unmarshal(rec.Body.Bytes(), &rows); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(rows) != 1 || rows[0].Date != "2026-01-04" {
		t.Fatalf("expected the earlier write to be visible now, got %+v", rows)
	}
}

func TestPostSyncDrainsABatchAndReportsPerEntry(t *testing.T) {
	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer conn.Close()
	router := api.NewRouter(conn, "secret")

	entries := []map[string]any{
		{"entity": "protein_log", "entity_id": "2026-01-05", "payload": map[string]any{"date": "2026-01-05", "hit": true}},
		{"entity": "mobility_log", "entity_id": "2026-01-05", "payload": map[string]any{"date": "2026-01-05"}},
		{"entity": "made_up", "entity_id": "x", "payload": map[string]any{}},
	}
	rec := doJSON(t, router, http.MethodPost, "/api/sync", entries)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var results []syncpkg.Result
	if err := json.Unmarshal(rec.Body.Bytes(), &results); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(results) != 3 || !results[0].OK || !results[1].OK || results[2].OK {
		t.Fatalf("unexpected results: %+v", results)
	}

	var hit bool
	if err := conn.QueryRow(`SELECT hit FROM protein_logs WHERE date = ?`, "2026-01-05").Scan(&hit); err != nil || !hit {
		t.Fatalf("expected protein_logs to have been written, err=%v hit=%v", err, hit)
	}
}

func TestPostMobilityRouteExists(t *testing.T) {
	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer conn.Close()
	router := api.NewRouter(conn, "secret")

	rec := doJSON(t, router, http.MethodPost, "/api/mobility", map[string]any{"date": "2026-01-05"})
	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
	var done bool
	conn.QueryRow(`SELECT done FROM mobility_logs WHERE date = ?`, "2026-01-05").Scan(&done)
	if !done {
		t.Fatalf("expected mobility_logs row with done=true")
	}
}
