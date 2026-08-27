// Package db opens the SQLite database and applies migrations. SQLite is the
// durable backup, not the runtime dependency — the PWA's session runner never
// waits on this (docs/architecture.md §B2).
package db

import (
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"sort"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// Open opens (creating if absent) the SQLite file at path and applies any
// migration files under migrations/ in filename order. Migrations are
// idempotent (CREATE TABLE IF NOT EXISTS) so re-running an already-applied
// file is harmless — there is no separate "applied" ledger yet.
func Open(path string) (*sql.DB, error) {
	conn, err := sql.Open("sqlite", path+"?_pragma=foreign_keys(1)")
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	if err := migrate(conn); err != nil {
		conn.Close()
		return nil, err
	}
	return conn, nil
}

func migrate(conn *sql.DB) error {
	entries, err := fs.ReadDir(migrationsFS, "migrations")
	if err != nil {
		return fmt.Errorf("read migrations dir: %w", err)
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	for _, name := range names {
		sqlBytes, err := fs.ReadFile(migrationsFS, "migrations/"+name)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", name, err)
		}
		if _, err := conn.Exec(string(sqlBytes)); err != nil {
			return fmt.Errorf("apply migration %s: %w", name, err)
		}
	}
	return nil
}
