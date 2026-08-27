package api_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ajayrajen7/anyway/server/internal/api"
	"github.com/ajayrajen7/anyway/server/internal/db"
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

func TestApiRoutesRequireBearerToken(t *testing.T) {
	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer conn.Close()

	router := api.NewRouter(conn, "secret")

	req := httptest.NewRequest(http.MethodGet, "/api/today", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 with no token, got %d", rec.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/today", nil)
	req.Header.Set("Authorization", "Bearer wrong")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 with wrong token, got %d", rec.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/today", nil)
	req.Header.Set("Authorization", "Bearer secret")
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotImplemented {
		t.Fatalf("expected 501 (stub) with correct token, got %d", rec.Code)
	}
}
