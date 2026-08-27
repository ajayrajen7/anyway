// Command seed loads seed/exercises.json into the database. Re-runnable —
// the seed file is the source of truth, so re-seeding after an edit to it is
// the expected workflow, not a one-time bootstrap step.
package main

import (
	"context"
	"flag"
	"log"

	"github.com/ajayrajen7/anyway/server/internal/db"
	"github.com/ajayrajen7/anyway/server/internal/seed"
)

func main() {
	dbPath := flag.String("db", "anyway.db", "path to the SQLite database")
	seedFile := flag.String("file", "../seed/exercises.json", "path to the exercise seed JSON")
	flag.Parse()

	exercises, err := seed.ParseFile(*seedFile)
	if err != nil {
		log.Fatalf("parse seed file: %v", err)
	}

	conn, err := db.Open(*dbPath)
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer conn.Close()

	n, err := seed.Apply(context.Background(), conn, exercises)
	if err != nil {
		log.Fatalf("apply seed: %v", err)
	}
	log.Printf("seeded %d exercises into %s", n, *dbPath)
}
