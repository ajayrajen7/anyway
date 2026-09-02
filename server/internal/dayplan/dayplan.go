// Package dayplan implements a post-M12 UX addition: swapping which day's
// prescription applies to two dates within a week — "do Tuesday's workout on
// Wednesday" — without touching the underlying day_templates/slots
// themselves (that's the *other* post-M12 addition, feature 4's
// server/internal/sync#ReconcileSlots — a deliberately separate concern).
//
// Owner-confirmed scope (see memory.md): a swap is a one-off override for
// exactly those two dates, not a change to the recurring weekday order —
// next week resets to the normal Mon..Sun template mapping unless swapped
// again.
package dayplan

import (
	"context"
	"database/sql"
	"fmt"
)

// ErrAlreadyStarted means one of the two dates already has a `sessions` row.
// internal/today fixes a session's day_template_id at creation and never
// revisits it (see its own "missed days do not reschedule" discipline) —
// swapping after that point would leave an already-created session quietly
// pointing at the pre-swap content, which is worse than just refusing the
// swap outright.
var ErrAlreadyStarted = fmt.Errorf("one of these days already has a session — swap before opening it as Today")

// execQueryer is satisfied by *sql.DB.
type execQueryer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

// Swap records dateA and dateB as swapped with each other (a symmetric
// pair — see the day_swaps migration). Rejects with ErrAlreadyStarted if
// either date already has a session. Either date's *prior* swap (if any) is
// cleared first, since `day_swaps.date` is a primary key — a date can only
// ever be paired with one other date at a time.
func Swap(ctx context.Context, conn execQueryer, dateA, dateB string) error {
	if dateA == dateB {
		return fmt.Errorf("cannot swap a day with itself")
	}
	for _, d := range [2]string{dateA, dateB} {
		var n int
		if err := conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM sessions WHERE date = ?`, d).Scan(&n); err != nil {
			return fmt.Errorf("check existing session for %s: %w", d, err)
		}
		if n > 0 {
			return ErrAlreadyStarted
		}
	}
	if err := Unswap(ctx, conn, dateA); err != nil {
		return err
	}
	if err := Unswap(ctx, conn, dateB); err != nil {
		return err
	}
	if _, err := conn.ExecContext(ctx, `INSERT INTO day_swaps (date, swapped_with) VALUES (?, ?)`, dateA, dateB); err != nil {
		return fmt.Errorf("insert day_swap %s: %w", dateA, err)
	}
	if _, err := conn.ExecContext(ctx, `INSERT INTO day_swaps (date, swapped_with) VALUES (?, ?)`, dateB, dateA); err != nil {
		return fmt.Errorf("insert day_swap %s: %w", dateB, err)
	}
	return nil
}

// Unswap removes date's swap, if any, along with its partner's matching row.
// A no-op (not an error) if date isn't currently swapped.
func Unswap(ctx context.Context, conn execQueryer, date string) error {
	partner, ok, err := Get(ctx, conn, date)
	if err != nil {
		return err
	}
	if !ok {
		return nil
	}
	if _, err := conn.ExecContext(ctx, `DELETE FROM day_swaps WHERE date = ?`, date); err != nil {
		return fmt.Errorf("delete day_swap %s: %w", date, err)
	}
	if _, err := conn.ExecContext(ctx, `DELETE FROM day_swaps WHERE date = ?`, partner); err != nil {
		return fmt.Errorf("delete day_swap %s: %w", partner, err)
	}
	return nil
}

// Get returns date's swap partner, if any — internal/today's read path for
// "which day_template should this date actually use."
func Get(ctx context.Context, conn execQueryer, date string) (partner string, ok bool, err error) {
	err = conn.QueryRowContext(ctx, `SELECT swapped_with FROM day_swaps WHERE date = ?`, date).Scan(&partner)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("look up day_swap for %s: %w", date, err)
	}
	return partner, true, nil
}

// Pair is one swapped pair — ListInRange reports each pair once (the side
// whose date sorts first), not once per date.
type Pair struct {
	DateA string `json:"date_a"`
	DateB string `json:"date_b"`
}

// ListInRange returns every swap pair with at least one side inside
// [start, end] (inclusive) — enough for a client to render both "swapped
// away" and "swapped in" tags across a displayed week.
func ListInRange(ctx context.Context, conn execQueryer, start, end string) ([]Pair, error) {
	rows, err := conn.QueryContext(ctx, `
		SELECT date, swapped_with FROM day_swaps
		WHERE (date >= ? AND date <= ?) OR (swapped_with >= ? AND swapped_with <= ?)
	`, start, end, start, end)
	if err != nil {
		return nil, fmt.Errorf("list day_swaps: %w", err)
	}
	defer rows.Close()

	type key struct{ a, b string }
	seen := map[key]bool{}
	pairs := []Pair{}
	for rows.Next() {
		var a, b string
		if err := rows.Scan(&a, &b); err != nil {
			return nil, err
		}
		if a > b {
			a, b = b, a
		}
		k := key{a, b}
		if seen[k] {
			continue
		}
		seen[k] = true
		pairs = append(pairs, Pair{DateA: a, DateB: b})
	}
	return pairs, rows.Err()
}
