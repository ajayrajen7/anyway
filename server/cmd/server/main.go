// Command server runs the Anyway API (docs/architecture.md §B1, §B5).
package main

import (
	"log"
	"net/http"
	"os"

	"github.com/ajayrajen7/anyway/server/internal/api"
	"github.com/ajayrajen7/anyway/server/internal/db"
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

	router := api.NewRouter(conn, token)
	log.Printf("listening on %s (db: %s)", addr, dbPath)
	log.Fatal(http.ListenAndServe(addr, router))
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
