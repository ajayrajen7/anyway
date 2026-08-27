// Package api wires the HTTP surface described in docs/architecture.md §B5.
// /healthz and GET /api/exercises (M1) are real; every other /api/* route is
// a stub returning 501 until its milestone lands, so the frontend can be
// pointed at a live server from day one without lying about what works.
package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/ajayrajen7/anyway/server/internal/seed"
	"github.com/ajayrajen7/anyway/server/internal/today"
)

func NewRouter(conn *sql.DB, token string) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Get("/healthz", healthz(conn))

	r.Route("/api", func(r chi.Router) {
		r.Use(BearerAuth(token))
		r.Get("/today", getToday(conn))
		r.Post("/sessions/{id}/sets", notImplemented)
		r.Post("/sessions/{id}/sets/{sid}/skip", notImplemented)
		r.Post("/sessions/{id}/add", notImplemented)
		r.Post("/sessions/{id}/complete", notImplemented)
		r.Get("/exercises", listExercises(conn))
		r.Post("/morning-check", notImplemented)
		r.Post("/weigh-ins", notImplemented)
		r.Get("/weigh-ins", notImplemented) // 423 Locked before start+84d — M9 (the Vault)
		r.Post("/protein", notImplemented)
		r.Post("/cardio", notImplemented)
		r.Get("/week", notImplemented)
		r.Post("/sync", notImplemented)
		r.Get("/export", notImplemented)
	})

	return r
}

func healthz(conn *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := conn.PingContext(r.Context()); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]string{"status": "db unreachable"})
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}
}

// listExercises implements GET /api/exercises?q=&include_blocked=1
// (docs/architecture.md §B5). Excludes blocked exercises unless
// include_blocked=1 is passed — prd.md §A3.4 needs that for the swap sheet's
// "explain, don't hide" search.
func listExercises(conn *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		query := r.URL.Query().Get("q")
		includeBlocked := r.URL.Query().Get("include_blocked") == "1"

		exercises, err := seed.List(r.Context(), conn, query, includeBlocked)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		if exercises == nil {
			exercises = []seed.Exercise{} // never null in the response
		}
		json.NewEncoder(w).Encode(exercises)
	}
}

// getToday implements GET /api/today?date=YYYY-MM-DD (docs/architecture.md
// §B5; M3). `date` is the client's *local* calendar day — the server has no
// reliable way to know the user's timezone otherwise — and defaults to the
// server's own local date only as a convenience for manual/curl testing.
// This `date` param is an addition to §B5's prose, logged in memory.md.
func getToday(conn *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		date := r.URL.Query().Get("date")
		if date == "" {
			date = time.Now().Format("2006-01-02")
		}

		resp, err := today.Get(r.Context(), conn, date)
		if err != nil {
			switch {
			case errors.Is(err, today.ErrInvalidDate):
				w.WriteHeader(http.StatusBadRequest)
			case errors.Is(err, today.ErrNoActivePhase), errors.Is(err, today.ErrNoDayTemplate):
				w.WriteHeader(http.StatusNotFound)
			default:
				w.WriteHeader(http.StatusInternalServerError)
			}
			json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		json.NewEncoder(w).Encode(resp)
	}
}

func notImplemented(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusNotImplemented)
	json.NewEncoder(w).Encode(map[string]string{"error": "not implemented yet — see docs/implementation-plan.md"})
}
