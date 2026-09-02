// Package export implements GET /api/export (docs/architecture.md §B5) —
// a full JSON dump of every table, for the user's own portability/backup
// use (distinct from server/internal/backup's nightly on-disk `VACUUM INTO`
// snapshot, which nothing downloads). Every table is dumped unconditionally
// — the old `weigh_ins`-only Vault gate was removed along with the Vault
// feature itself in the UX refactor; see memory.md.
package export

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// tables is the fixed, whitelisted set of tables dumped — never derived
// from user input, so building a query string from a name in this slice is
// safe.
var tables = []string{
	"exercises", "exercise_muscles", "phases", "day_templates", "slots",
	"slot_swaps", "sessions", "logged_sets", "morning_checks",
	"protein_logs", "mobility_logs", "cardio_logs", "steps_logs", "outbox", "settings",
	// Post-M12 UX additions (feature 1/2) — see memory.md.
	"day_skips", "day_swaps",
}

type Dump struct {
	GeneratedAt string                      `json:"generated_at"`
	Tables      map[string][]map[string]any `json:"tables"`
}

func Build(ctx context.Context, conn *sql.DB, now time.Time) (*Dump, error) {
	dump := &Dump{
		GeneratedAt: now.UTC().Format(time.RFC3339),
		Tables:      make(map[string][]map[string]any, len(tables)),
	}

	for _, table := range tables {
		rows, err := dumpTable(ctx, conn, table)
		if err != nil {
			return nil, fmt.Errorf("dump %s: %w", table, err)
		}
		dump.Tables[table] = rows
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
