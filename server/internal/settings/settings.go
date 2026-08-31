// Package settings is a generic key/value store (docs/architecture.md §B3
// gained a `settings` table in M9 — not in the original schema, added to
// hold `programme_start_date`; see memory.md). `programme_start_date` no
// longer gates anything (the Vault it was built for was removed in the UX
// refactor — see memory.md) but is kept: it's the day-0 marker a future
// "week N of the programme" label would still need.
package settings

import (
	"context"
	"database/sql"
)

// execer is satisfied by both *sql.DB and *sql.Tx — Set/Get/SetIfAbsent are
// called both standalone (API handlers) and inside programme.Apply's own
// transaction (to seed programme_start_date the moment a phase is applied).
type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// ProgrammeStartDateKey is written once, by programme.Apply, the first time
// a phase is seeded — see SetIfAbsent's call site there. It marks day 0 of
// the fixed 6-month programme.
const ProgrammeStartDateKey = "programme_start_date"

func Get(ctx context.Context, conn execer, key string) (value string, ok bool, err error) {
	err = conn.QueryRowContext(ctx, `SELECT value FROM settings WHERE key = ?`, key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return value, true, nil
}

func Set(ctx context.Context, conn execer, key, value string) error {
	_, err := conn.ExecContext(ctx, `
		INSERT INTO settings (key, value) VALUES (?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value
	`, key, value)
	return err
}

// SetIfAbsent writes key only if it has never been set — used for
// programme_start_date so re-seeding the same phase (programme.Apply
// replaces it wholesale — see that package) never resets the Vault's clock.
func SetIfAbsent(ctx context.Context, conn execer, key, value string) error {
	_, err := conn.ExecContext(ctx, `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`, key, value)
	return err
}
