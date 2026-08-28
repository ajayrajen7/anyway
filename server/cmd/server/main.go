// Command server runs the Anyway API (docs/architecture.md §B1, §B5).
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"strconv"

	"github.com/ajayrajen7/anyway/server/internal/api"
	"github.com/ajayrajen7/anyway/server/internal/backup"
	"github.com/ajayrajen7/anyway/server/internal/db"
	"github.com/ajayrajen7/anyway/server/internal/webapp"
)

func main() {
	addr := envOr("ANYWAY_ADDR", ":8080")
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

	// Nightly VACUUM INTO backup (docs/architecture.md §B2, M10). Off-box
	// copy is deliberately not wired up yet — see internal/backup's doc
	// comment and memory.md — so `offBox` stays nil for now.
	backupDir := envOr("ANYWAY_BACKUP_DIR", "backups")
	backupHour := envIntOr("ANYWAY_BACKUP_HOUR", 3)
	backupKeep := envIntOr("ANYWAY_BACKUP_KEEP", 30)
	go backup.RunNightly(context.Background(), conn, backupDir, backupHour, backupKeep, nil, log.Printf)

	router := api.NewRouter(conn, token)
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
