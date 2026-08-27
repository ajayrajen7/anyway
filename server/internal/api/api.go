// Package api wires the HTTP surface described in docs/architecture.md §B5.
// Only /healthz is real in M0 — every /api/* route is a stub returning
// 501 until its milestone lands, so the frontend can be pointed at a live
// server from day one without lying about what works.
package api

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

func NewRouter(conn *sql.DB, token string) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Get("/healthz", healthz(conn))

	r.Route("/api", func(r chi.Router) {
		r.Use(BearerAuth(token))
		r.Get("/today", notImplemented)
		r.Post("/sessions/{id}/sets", notImplemented)
		r.Post("/sessions/{id}/sets/{sid}/skip", notImplemented)
		r.Post("/sessions/{id}/add", notImplemented)
		r.Post("/sessions/{id}/complete", notImplemented)
		r.Get("/exercises", notImplemented)
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

func notImplemented(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusNotImplemented)
	json.NewEncoder(w).Encode(map[string]string{"error": "not implemented yet — see docs/implementation-plan.md"})
}
