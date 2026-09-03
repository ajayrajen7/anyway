package dayplan_test

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/ajayrajen7/anyway/server/internal/dayplan"
	"github.com/ajayrajen7/anyway/server/internal/db"
)

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { conn.Close() })
	return conn
}

func TestSwapCreatesASymmetricPair(t *testing.T) {
	conn := openTestDB(t)
	ctx := context.Background()

	if err := dayplan.Swap(ctx, conn, "2026-01-06", "2026-01-07"); err != nil {
		t.Fatalf("Swap: %v", err)
	}

	partner, ok, err := dayplan.Get(ctx, conn, "2026-01-06")
	if err != nil || !ok || partner != "2026-01-07" {
		t.Fatalf("expected 2026-01-06 -> 2026-01-07, got partner=%q ok=%v err=%v", partner, ok, err)
	}
	partner2, ok2, err := dayplan.Get(ctx, conn, "2026-01-07")
	if err != nil || !ok2 || partner2 != "2026-01-06" {
		t.Fatalf("expected 2026-01-07 -> 2026-01-06, got partner=%q ok=%v err=%v", partner2, ok2, err)
	}
}

func TestSwapAllowsADateWithOnlyAnUntouchedPlannedSession(t *testing.T) {
	// today.Get's ensureSession creates a bare 'planned' row the moment a
	// lifting day is merely viewed — including today's own date, on every
	// visit to Today, before anything is logged. That must not block a swap,
	// or today (and any lifting day already glanced at) becomes permanently
	// unswappable. See ErrAlreadyStarted's doc.
	conn := openTestDB(t)
	ctx := context.Background()
	if _, err := conn.Exec(`INSERT INTO sessions (date, status) VALUES ('2026-01-06', 'planned')`); err != nil {
		t.Fatalf("seed session: %v", err)
	}

	if err := dayplan.Swap(ctx, conn, "2026-01-06", "2026-01-07"); err != nil {
		t.Fatalf("expected swap to succeed, got %v", err)
	}
}

func TestSwapRefusesADateWithACompletedSession(t *testing.T) {
	conn := openTestDB(t)
	ctx := context.Background()
	if _, err := conn.Exec(`INSERT INTO sessions (date, status) VALUES ('2026-01-06', 'completed')`); err != nil {
		t.Fatalf("seed session: %v", err)
	}

	err := dayplan.Swap(ctx, conn, "2026-01-06", "2026-01-07")
	if !errors.Is(err, dayplan.ErrAlreadyStarted) {
		t.Fatalf("expected ErrAlreadyStarted, got %v", err)
	}
	if _, ok, _ := dayplan.Get(ctx, conn, "2026-01-07"); ok {
		t.Fatal("a refused swap must not have written anything")
	}
}

func TestSwapRefusesADateWithAtLeastOneLoggedSet(t *testing.T) {
	conn := openTestDB(t)
	ctx := context.Background()
	if _, err := conn.Exec(`
		INSERT INTO exercises (id, slug, name, equipment, pressure, impact)
		VALUES (1, 'test-exercise', 'Test Exercise', 'bodyweight', 'low', 'none')
	`); err != nil {
		t.Fatalf("seed exercise: %v", err)
	}
	if _, err := conn.Exec(`INSERT INTO sessions (id, date, status) VALUES (1, '2026-01-06', 'planned')`); err != nil {
		t.Fatalf("seed session: %v", err)
	}
	if _, err := conn.Exec(`
		INSERT INTO logged_sets (session_id, exercise_id, set_index, status, provenance, logged_at)
		VALUES (1, 1, 1, 'done', 'prescribed', '2026-01-06T09:00:00Z')
	`); err != nil {
		t.Fatalf("seed logged_set: %v", err)
	}

	err := dayplan.Swap(ctx, conn, "2026-01-06", "2026-01-07")
	if !errors.Is(err, dayplan.ErrAlreadyStarted) {
		t.Fatalf("expected ErrAlreadyStarted, got %v", err)
	}
	if _, ok, _ := dayplan.Get(ctx, conn, "2026-01-07"); ok {
		t.Fatal("a refused swap must not have written anything")
	}
}

func TestSwappingADateAlreadyInAPairClearsTheOldOne(t *testing.T) {
	conn := openTestDB(t)
	ctx := context.Background()

	if err := dayplan.Swap(ctx, conn, "2026-01-06", "2026-01-07"); err != nil {
		t.Fatalf("first swap: %v", err)
	}
	// Re-pair 2026-01-06 with a third date — its old partner (01-07) must
	// end up unswapped, not left pointing at a date that's no longer
	// actually paired with it.
	if err := dayplan.Swap(ctx, conn, "2026-01-06", "2026-01-08"); err != nil {
		t.Fatalf("second swap: %v", err)
	}
	if _, ok, _ := dayplan.Get(ctx, conn, "2026-01-07"); ok {
		t.Fatal("2026-01-07 should have been unswapped when 01-06 was re-paired")
	}
	partner, ok, _ := dayplan.Get(ctx, conn, "2026-01-08")
	if !ok || partner != "2026-01-06" {
		t.Fatalf("expected 2026-01-08 -> 2026-01-06, got %q ok=%v", partner, ok)
	}
}

func TestUnswapRemovesBothSides(t *testing.T) {
	conn := openTestDB(t)
	ctx := context.Background()
	if err := dayplan.Swap(ctx, conn, "2026-01-06", "2026-01-07"); err != nil {
		t.Fatalf("swap: %v", err)
	}
	if err := dayplan.Unswap(ctx, conn, "2026-01-06"); err != nil {
		t.Fatalf("unswap: %v", err)
	}
	if _, ok, _ := dayplan.Get(ctx, conn, "2026-01-06"); ok {
		t.Fatal("expected 01-06 unswapped")
	}
	if _, ok, _ := dayplan.Get(ctx, conn, "2026-01-07"); ok {
		t.Fatal("expected 01-07 (the partner) unswapped too")
	}
}

func TestUnswapOfAnUnswappedDateIsANoOp(t *testing.T) {
	conn := openTestDB(t)
	if err := dayplan.Unswap(context.Background(), conn, "2026-01-06"); err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}

func TestListInRangeReportsEachPairOnce(t *testing.T) {
	conn := openTestDB(t)
	ctx := context.Background()
	if err := dayplan.Swap(ctx, conn, "2026-01-06", "2026-01-07"); err != nil {
		t.Fatalf("swap: %v", err)
	}

	pairs, err := dayplan.ListInRange(ctx, conn, "2026-01-05", "2026-01-11")
	if err != nil {
		t.Fatalf("ListInRange: %v", err)
	}
	if len(pairs) != 1 {
		t.Fatalf("expected exactly 1 pair (not one per side), got %d: %+v", len(pairs), pairs)
	}
	if pairs[0].DateA != "2026-01-06" || pairs[0].DateB != "2026-01-07" {
		t.Fatalf("unexpected pair: %+v", pairs[0])
	}

	// Outside the range entirely — must not show up.
	none, err := dayplan.ListInRange(ctx, conn, "2026-02-01", "2026-02-07")
	if err != nil {
		t.Fatalf("ListInRange: %v", err)
	}
	if len(none) != 0 {
		t.Fatalf("expected no pairs for an unrelated range, got %+v", none)
	}
}
