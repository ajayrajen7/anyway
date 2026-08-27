// Command programme loads a phase seed file (day templates, slots, tier-1
// swaps) into the database. Run the exercise seed (cmd/seed) first — slots
// resolve exercises by slug and fail loudly if one is missing.
package main

import (
	"context"
	"flag"
	"log"

	"github.com/ajayrajen7/anyway/server/internal/db"
	"github.com/ajayrajen7/anyway/server/internal/programme"
)

func main() {
	dbPath := flag.String("db", "anyway.db", "path to the SQLite database")
	seedFile := flag.String("file", "../seed/phase1.json", "path to the phase seed JSON")
	flag.Parse()

	seed, err := programme.ParseFile(*seedFile)
	if err != nil {
		log.Fatalf("parse programme seed file: %v", err)
	}

	conn, err := db.Open(*dbPath)
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer conn.Close()

	applied, err := programme.Apply(context.Background(), conn, seed)
	if err != nil {
		log.Fatalf("apply programme seed: %v", err)
	}
	log.Printf("seeded %q into %s: %d day templates, %d slots, %d swaps",
		seed.Phase.Name, *dbPath, applied.DayTemplates, applied.Slots, applied.Swaps)
}
