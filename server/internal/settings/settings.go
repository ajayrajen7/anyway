// Package settings is a generic key/value store (docs/architecture.md §B3
// gained a `settings` table in M9 — not in the original schema, added to
// hold `programme_start_date`, which architecture.md §A4's Vault needs but
// the original schema had nowhere to put; see memory.md) plus the one piece
// of logic built on top of it so far: the Vault's 84-day lock.
package settings

import (
	"context"
	"database/sql"
	"fmt"
	"time"
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
// the fixed 6-month programme and is the base the Vault's 84-day lock
// counts from.
const ProgrammeStartDateKey = "programme_start_date"

// VaultDays is the Vault's lock period (docs/prd.md §A4): "GET
// /api/weigh-ins → 423 Locked before start+84d" (architecture.md §B5).
const VaultDays = 84

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

// VaultUnlocked reports whether GET /api/weigh-ins may return data as of
// `now`. Absence of programme_start_date — the programme seed has never
// been run — resolves to **locked**, not unlocked: a missing start date is
// exactly the kind of ambiguity where the safer wrong answer is "keep it
// hidden", never "show it". See memory.md for this being a deliberate
// conservative default, not an oversight.
func VaultUnlocked(ctx context.Context, conn execer, now time.Time) (bool, error) {
	raw, ok, err := Get(ctx, conn, ProgrammeStartDateKey)
	if err != nil {
		return false, fmt.Errorf("load %s: %w", ProgrammeStartDateKey, err)
	}
	if !ok {
		return false, nil
	}
	start, err := time.Parse("2006-01-02", raw)
	if err != nil {
		return false, fmt.Errorf("stored %s %q is not a date: %w", ProgrammeStartDateKey, raw, err)
	}
	unlockDate := start.AddDate(0, 0, VaultDays)
	// Compare calendar days only, using the server's own local day — not the
	// requesting client's (unlike GET /api/today's `date` param). A duration
	// gate like this only needs to compare against a single global start
	// instant; using the server's clock can at most delay the unlock by a
	// few hours across timezones, never bring it forward, which is the
	// direction this feature must always err in.
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	return !today.Before(unlockDate), nil
}
