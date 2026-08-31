// Command server runs the Anyway API (docs/architecture.md §B1, §B5).
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/ajayrajen7/anyway/server/internal/api"
	"github.com/ajayrajen7/anyway/server/internal/backup"
	"github.com/ajayrajen7/anyway/server/internal/bootstrap"
	"github.com/ajayrajen7/anyway/server/internal/db"
	"github.com/ajayrajen7/anyway/server/internal/exercisegen"
	"github.com/ajayrajen7/anyway/server/internal/webapp"
)

func main() {
	addr := envOr("ANYWAY_ADDR", ":8080")
	// Railway (and most PaaS hosts — Heroku, Render, ...) assigns its own
	// port and expects the app to listen on it via $PORT, overriding
	// whatever's configured; a healthcheck prober hitting that port finds
	// nothing home otherwise, even though the app is running fine on
	// ANYWAY_ADDR's own port. $PORT wins when set, ANYWAY_ADDR is the
	// override for hosts that don't use this convention (a bare VPS, local
	// dev), :8080 is the last-resort default.
	if port := os.Getenv("PORT"); port != "" {
		addr = ":" + port
	}
	dbPath := envOr("ANYWAY_DB_PATH", "anyway.db")
	token := os.Getenv("ANYWAY_API_TOKEN")
	if token == "" {
		log.Fatal("ANYWAY_API_TOKEN must be set (single static bearer token — see docs/architecture.md §B1)")
	}

	conn, err := db.Open(dbPath)
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer conn.Close()

	// Auto-seed a fresh deploy's empty database (exercise library + Phase 1
	// programme) on first boot — see internal/bootstrap's doc comment. A
	// hard failure here means the embedded seed data itself is broken
	// (it's static and already validated by seed_test.go/programme_test.go
	// against the real files), so failing loudly and refusing to serve a
	// half-seeded app is correct, not overly strict.
	if err := bootstrap.Run(context.Background(), conn); err != nil {
		log.Fatalf("bootstrap seed data: %v", err)
	}

	// Nightly VACUUM INTO backup (docs/architecture.md §B2, M10). Off-box
	// copy is deliberately not wired up yet — see internal/backup's doc
	// comment and memory.md — so `offBox` stays nil for now.
	backupDir := envOr("ANYWAY_BACKUP_DIR", "backups")
	backupHour := envIntOr("ANYWAY_BACKUP_HOUR", 3)
	backupKeep := envIntOr("ANYWAY_BACKUP_KEEP", 30)
	go backup.RunNightly(context.Background(), conn, backupDir, backupHour, backupKeep, nil, log.Printf)

	// Real-time exercise creation (see internal/exercisegen) needs
	// ANTHROPIC_API_KEY — degrades to a clear 501 on that one endpoint if
	// unset, same "this feature degrades, not the app" shape as the
	// backup's off-box copy. exercisegen.New() doesn't itself validate the
	// key is present (the SDK resolves credentials lazily); it's still
	// worth constructing unconditionally so a key added later (no redeploy
	// needed on most hosts, just an env var change + restart) works
	// immediately.
	// Deliberately branching on the raw *exercisegen.Client, not handing
	// api.NewRouter a possibly-nil *exercisegen.Client to wrap itself: an
	// interface variable holding a nil pointer is not itself nil (the
	// classic Go nil-interface-vs-nil-pointer trap) — postGenerateExercise's
	// own `gen == nil` check would never see it, and it'd panic on the nil
	// receiver instead of cleanly 501ing. Passing literal nil keeps the
	// interface itself nil.
	var router chi.Router
	if os.Getenv("ANTHROPIC_API_KEY") != "" {
		router = api.NewRouter(conn, token, exercisegen.New())
	} else {
		log.Print("ANTHROPIC_API_KEY not set — real-time exercise creation disabled (POST /api/exercises/generate will 501)")
		router = api.NewRouter(conn, token, nil)
	}
	// SPA fallback: any path /api/* and /healthz don't claim serves the
	// embedded frontend build (internal/webapp) — the single-binary,
	// same-origin production deploy decided alongside M10's hosting choice.
	// A dev setup running `npm run dev` separately never hits this at all.
	router.NotFound(webapp.Handler(token).ServeHTTP)

	log.Printf("listening on %s (db: %s)", addr, dbPath)
	log.Fatal(http.ListenAndServe(addr, router))
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envIntOr(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		log.Fatalf("%s must be an integer, got %q", key, v)
	}
	return n
}
