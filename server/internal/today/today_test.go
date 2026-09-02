package today_test

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/ajayrajen7/anyway/server/internal/dayplan"
	"github.com/ajayrajen7/anyway/server/internal/db"
	"github.com/ajayrajen7/anyway/server/internal/programme"
	"github.com/ajayrajen7/anyway/server/internal/seed"
	"github.com/ajayrajen7/anyway/server/internal/today"
)

func TestISOWeekdayMapsMondayToSunday(t *testing.T) {
	cases := []struct {
		date string // a known Monday..Sunday run, 2026-01-05 is a Monday
		want int
	}{
		{"2026-01-05", 1}, // Mon
		{"2026-01-06", 2}, // Tue
		{"2026-01-07", 3}, // Wed
		{"2026-01-08", 4}, // Thu
		{"2026-01-09", 5}, // Fri
		{"2026-01-10", 6}, // Sat
		{"2026-01-11", 7}, // Sun
	}
	for _, c := range cases {
		parsed, err := time.Parse("2006-01-02", c.date)
		if err != nil {
			t.Fatalf("parse %s: %v", c.date, err)
		}
		if got := today.ISOWeekday(parsed); got != c.want {
			t.Errorf("%s: got weekday %d, want %d", c.date, got, c.want)
		}
	}
}

// seedFullConn loads the real M1+M2 seed files into a fresh in-memory DB —
// the fixture every test below builds on, since today.Get needs a real
// active phase and real exercises to resolve against.
func seedFullConn(t *testing.T) *sql.DB {
	t.Helper()
	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	ctx := context.Background()

	exercises, err := seed.ParseFile("../../../seed/exercises.json")
	if err != nil {
		t.Fatalf("parse exercises: %v", err)
	}
	if _, err := seed.Apply(ctx, conn, exercises); err != nil {
		t.Fatalf("apply exercises: %v", err)
	}

	phase1, err := programme.ParseFile("../../../seed/phase1.json")
	if err != nil {
		t.Fatalf("parse phase1: %v", err)
	}
	if _, err := programme.Apply(ctx, conn, phase1); err != nil {
		t.Fatalf("apply phase1: %v", err)
	}

	return conn
}

func TestGetOnLiftingDayCreatesSessionAndReturnsSlots(t *testing.T) {
	conn := seedFullConn(t)
	defer conn.Close()
	ctx := context.Background()

	// 2026-01-05 is a Monday — Lower A, 6 slots.
	resp, err := today.Get(ctx, conn, "2026-01-05")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if resp.DayTemplate.Kind != "lifting" {
		t.Fatalf("expected lifting day, got %q", resp.DayTemplate.Kind)
	}
	if resp.DayTemplate.Name != "Lower A" {
		t.Fatalf("expected Lower A, got %q", resp.DayTemplate.Name)
	}
	if resp.Session == nil || resp.Session.Status != "planned" {
		t.Fatalf("expected a freshly-created planned session, got %+v", resp.Session)
	}
	if len(resp.Slots) != 6 {
		t.Fatalf("expected 6 slots for Lower A, got %d", len(resp.Slots))
	}
	if resp.Slots[0].Exercise.Slug != "leg-press" {
		t.Fatalf("expected slot 1 to be leg-press, got %s", resp.Slots[0].Exercise.Slug)
	}
	if resp.Slots[0].ID == 0 {
		t.Fatal("expected slot.ID to be populated (needed for /session/:id/swap/:slotId and logged_sets.slot_id)")
	}
	if len(resp.Slots[0].Swaps) != 3 {
		t.Fatalf("expected 3 tier-1 swaps for leg-press, got %d", len(resp.Slots[0].Swaps))
	}
	if resp.Slots[0].LastActual != nil {
		t.Fatalf("expected no last_actual with nothing logged yet, got %+v", resp.Slots[0].LastActual)
	}

	// Calling Get again for the same date must not create a second session row.
	resp2, err := today.Get(ctx, conn, "2026-01-05")
	if err != nil {
		t.Fatalf("second Get: %v", err)
	}
	if resp2.Session.ID != resp.Session.ID {
		t.Fatalf("expected the same session id on repeat view, got %d vs %d", resp2.Session.ID, resp.Session.ID)
	}
}

func TestGetOnCardioMobilityDayReturnsNoSession(t *testing.T) {
	conn := seedFullConn(t)
	defer conn.Close()

	// 2026-01-07 is a Wednesday — Mobility + Zone 2, no slots/session.
	resp, err := today.Get(context.Background(), conn, "2026-01-07")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if resp.DayTemplate.Kind != "cardio_mobility" {
		t.Fatalf("expected cardio_mobility, got %q", resp.DayTemplate.Kind)
	}
	if resp.Session != nil {
		t.Fatalf("expected no session for a non-lifting day, got %+v", resp.Session)
	}
	if len(resp.Slots) != 0 {
		t.Fatalf("expected no slots for a non-lifting day, got %d", len(resp.Slots))
	}
}

func TestMissedDaysDoNotReschedule(t *testing.T) {
	conn := seedFullConn(t)
	defer conn.Close()
	ctx := context.Background()

	// View Thursday (2026-01-08, Lower B) but never complete it...
	thu, err := today.Get(ctx, conn, "2026-01-08")
	if err != nil {
		t.Fatalf("Get thursday: %v", err)
	}
	if thu.Session.Status != "planned" {
		t.Fatalf("expected thursday planned, got %s", thu.Session.Status)
	}

	// ...then view Friday, two days later. Thursday's session must flip to
	// 'missed', and Friday must still show Friday's own full template —
	// not Thursday's leftover exercises, not a merged/rescheduled day.
	fri, err := today.Get(ctx, conn, "2026-01-09")
	if err != nil {
		t.Fatalf("Get friday: %v", err)
	}
	if fri.DayTemplate.Name != "Upper B — Pull" {
		t.Fatalf("expected Friday's own template, got %q", fri.DayTemplate.Name)
	}
	if len(fri.Slots) != 7 {
		t.Fatalf("expected Friday's full 7 slots, got %d", len(fri.Slots))
	}

	thuAgain, err := today.Get(ctx, conn, "2026-01-08")
	if err != nil {
		t.Fatalf("re-Get thursday: %v", err)
	}
	if thuAgain.Session.Status != "missed" {
		t.Fatalf("expected thursday's session to have flipped to missed, got %s", thuAgain.Session.Status)
	}
	if thuAgain.Session.ID != thu.Session.ID {
		t.Fatalf("expected the same session row, just with status updated")
	}
}

func TestLastActualReflectsOnlyDoneSets(t *testing.T) {
	conn := seedFullConn(t)
	defer conn.Close()
	ctx := context.Background()

	// Create Monday's session and find leg-press's exercise id + a session id to log against.
	mon, err := today.Get(ctx, conn, "2026-01-05")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	legPressID := mon.Slots[0].Exercise.ID

	if _, err := conn.ExecContext(ctx, `
		INSERT INTO logged_sets (session_id, slot_id, exercise_id, set_index, load_kg, reps, status, provenance, logged_at)
		VALUES (?, NULL, ?, 1, 22.5, 12, 'done', 'prescribed', '2026-01-05T09:00:00Z')
	`, mon.Session.ID, legPressID); err != nil {
		t.Fatalf("insert done set: %v", err)
	}
	if _, err := conn.ExecContext(ctx, `
		INSERT INTO logged_sets (session_id, slot_id, exercise_id, set_index, load_kg, reps, status, provenance, logged_at)
		VALUES (?, NULL, ?, 2, 999, 1, 'skipped', 'prescribed', '2026-01-05T09:05:00Z')
	`, mon.Session.ID, legPressID); err != nil {
		t.Fatalf("insert skipped set: %v", err)
	}

	// Re-view Monday — the skipped set (later, higher load) must not win;
	// the done set is the only thing that counts as a "last actual".
	monAgain, err := today.Get(ctx, conn, "2026-01-05")
	if err != nil {
		t.Fatalf("re-Get: %v", err)
	}
	last := monAgain.Slots[0].LastActual
	if last == nil {
		t.Fatal("expected a last_actual after logging a done set")
	}
	if last.Reps != 12 || last.LoadKg == nil || *last.LoadKg != 22.5 {
		t.Fatalf("expected last_actual {22.5kg x12} from the done set, got %+v", last)
	}
}

func TestGetResolvesADaySwapToItsPartnersContent(t *testing.T) {
	conn := seedFullConn(t)
	defer conn.Close()
	ctx := context.Background()

	// 2026-01-06 (Tue, Upper A) <-> 2026-01-07 (Wed, cardio_mobility).
	if err := dayplan.Swap(ctx, conn, "2026-01-06", "2026-01-07"); err != nil {
		t.Fatalf("Swap: %v", err)
	}

	wed, err := today.Get(ctx, conn, "2026-01-07")
	if err != nil {
		t.Fatalf("Get wed: %v", err)
	}
	if wed.Weekday != 3 {
		t.Fatalf("Weekday must stay Wednesday's own (3) for header display, got %d", wed.Weekday)
	}
	if wed.EffectiveWeekday == nil || *wed.EffectiveWeekday != 2 {
		t.Fatalf("expected EffectiveWeekday 2 (Tuesday), got %v", wed.EffectiveWeekday)
	}
	if wed.DayTemplate.Kind != "lifting" {
		t.Fatalf("expected Wednesday to show Tuesday's lifting content, got kind %q", wed.DayTemplate.Kind)
	}
	if wed.Session == nil {
		t.Fatal("expected a session to be created for the swapped-in lifting content")
	}

	tue, err := today.Get(ctx, conn, "2026-01-06")
	if err != nil {
		t.Fatalf("Get tue: %v", err)
	}
	if tue.Weekday != 2 {
		t.Fatalf("Weekday must stay Tuesday's own (2), got %d", tue.Weekday)
	}
	if tue.EffectiveWeekday == nil || *tue.EffectiveWeekday != 3 {
		t.Fatalf("expected EffectiveWeekday 3 (Wednesday), got %v", tue.EffectiveWeekday)
	}
	if tue.DayTemplate.Kind != "cardio_mobility" {
		t.Fatalf("expected Tuesday to show Wednesday's cardio_mobility content, got kind %q", tue.DayTemplate.Kind)
	}

	// An unswapped day (Thursday) must carry no EffectiveWeekday at all.
	thu, err := today.Get(ctx, conn, "2026-01-08")
	if err != nil {
		t.Fatalf("Get thu: %v", err)
	}
	if thu.EffectiveWeekday != nil {
		t.Fatalf("expected no EffectiveWeekday for an unswapped day, got %v", thu.EffectiveWeekday)
	}
}
