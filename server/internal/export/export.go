// Package export implements GET /api/export (docs/architecture.md §B5) —
// a full JSON dump of every table, for the user's own portability/backup
// use (distinct from server/internal/backup's nightly on-disk `VACUUM INTO`
// snapshot, which nothing downloads).
//
// One deliberate exception to "full": `weigh_ins` is included only once the
// Vault has unlocked (see server/internal/settings#VaultUnlocked), same as
// GET /api/weigh-ins. prd.md §A4 says "enforce server-side, not just in the
// UI" — a raw JSON export is exactly the kind of alternate route that would
// otherwise let the app's own UI restraint be trivially bypassed by just
// opening this URL, so the same gate applies here. Every other table is
// dumped unconditionally.
package export

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/ajayrajen7/anyway/server/internal/settings"
)

// tables is the fixed, whitelisted set of tables dumped — never derived
// from user input, so building a query string from a name in this slice is
// safe.
var tables = []string{
	"exercises", "exercise_muscles", "phases", "day_templates", "slots",
	"slot_swaps", "sessions", "logged_sets", "morning_checks",
	"protein_logs", "mobility_logs", "cardio_logs", "outbox", "settings",
}

type Dump struct {
	GeneratedAt string                      `json:"generated_at"`
	VaultLocked bool                        `json:"vault_locked"`
	Tables      map[string][]map[string]any `json:"tables"`
}

func Build(ctx context.Context, conn *sql.DB, now time.Time) (*Dump, error) {
	unlocked, err := settings.VaultUnlocked(ctx, conn, now)
	if err != nil {
		return nil, fmt.Errorf("check vault: %w", err)
	}

	dump := &Dump{
		GeneratedAt: now.UTC().Format(time.RFC3339),
		VaultLocked: !unlocked,
		Tables:      make(map[string][]map[string]any, len(tables)+1),
	}

	for _, table := range tables {
		rows, err := dumpTable(ctx, conn, table)
		if err != nil {
			return nil, fmt.Errorf("dump %s: %w", table, err)
		}
		dump.Tables[table] = rows
	}

	// weigh_ins: only while unlocked. Locked, it's present as an empty list
	// rather than an absent key — a caller can tell "no data yet" apart
	// from "you can't see this yet" without guessing from a missing key.
	if unlocked {
		rows, err := dumpTable(ctx, conn, "weigh_ins")
		if err != nil {
			return nil, fmt.Errorf("dump weigh_ins: %w", err)
		}
		dump.Tables["weigh_ins"] = rows
	} else {
		dump.Tables["weigh_ins"] = []map[string]any{}
	}

	return dump, nil
}

// dumpTable is a generic SELECT * scanner — deliberately not one struct per
// table, so this dump reflects the schema as it actually is, including any
// column added by a future migration, without needing a matching update
// here every time.
func dumpTable(ctx context.Context, conn *sql.DB, table string) ([]map[string]any, error) {
	rows, err := conn.QueryContext(ctx, "SELECT * FROM "+table) //nolint:gosec // table is from the fixed `tables` whitelist above, never user input
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}

	out := []map[string]any{}
	for rows.Next() {
		values := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		row := make(map[string]any, len(cols))
		for i, col := range cols {
			v := values[i]
			// database/sql commonly hands back []byte for TEXT columns via
			// this generic any-scan path; encoding/json would otherwise
			// base64-encode it as an opaque blob instead of a plain string.
			if b, ok := v.([]byte); ok {
				v = string(b)
			}
			row[col] = v
		}
		out = append(out, row)
	}
	return out, rows.Err()
}
