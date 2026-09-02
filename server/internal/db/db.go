// Package db opens the SQLite database and applies migrations. SQLite is the
// durable backup, not the runtime dependency — the PWA's session runner never
// waits on this (docs/architecture.md §B2).
package db

import (
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// Open opens (creating if absent) the SQLite file at path and applies any
// migration files under migrations/ in filename order. Migrations are
// idempotent (CREATE TABLE IF NOT EXISTS) so re-running an already-applied
// file is harmless — there is no separate "applied" ledger yet.
func Open(path string) (*sql.DB, error) {
	// SQLite can create the file itself but never the directory it lives in
	// — a fresh persistent volume/disk mounted at, say, /data won't
	// necessarily have had ANYWAY_DB_PATH's parent directory created by
	// whatever provisioned it. A no-op if the directory already exists (the
	// normal case), and ":memory:"/a bare filename both resolve harmlessly
	// (filepath.Dir gives "." for the latter).
	if path != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return nil, fmt.Errorf("create db directory: %w", err)
		}
	}

	// busy_timeout(5000): Railway (and most rolling-deploy PaaS hosts)
	// starts the *new* container before the *old* one has fully stopped, to
	// avoid downtime — both briefly hold the same SQLite file open on the
	// same persistent volume. Without a busy timeout, a lock held by the
	// still-shutting-down old container makes the new container's very
	// first query (a migration) fail immediately with SQLITE_BUSY, which
	// main.go treats as fatal — a real "Deploy Crashed" notification for a
	// deploy that then succeeds on Railway's automatic restart a moment
	// later (reported live: every deploy alerted, the app always ended up
	// fine). 5s retries through that overlap instead of failing on it —
	// see memory.md.
	conn, err := sql.Open("sqlite", path+"?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	// One connection only. This is a single-user server and SQLite serializes
	// writes anyway; for ":memory:" it also avoids database/sql's pool handing
	// out a second connection that would see a *different*, empty in-memory
	// database (each new "sqlite" connection to ":memory:" is otherwise its
	// own database).
	conn.SetMaxOpenConns(1)
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
			if isDuplicateColumnError(err) {
				// SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
				// (see 0003_logged_sets_client_uuid.sql), so a genuinely
				// idempotent re-run of that file errors here every time
				// after the first. That's expected, not a real failure.
				continue
			}
			return fmt.Errorf("apply migration %s: %w", name, err)
		}
	}
	return nil
}

func isDuplicateColumnError(err error) bool {
	return strings.Contains(err.Error(), "duplicate column name")
}
