package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ajayrajen7/anyway/server/internal/api"
	"github.com/ajayrajen7/anyway/server/internal/db"
	"github.com/ajayrajen7/anyway/server/internal/seed"
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
