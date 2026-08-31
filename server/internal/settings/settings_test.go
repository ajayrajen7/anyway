package settings_test

import (
	"database/sql"
	"testing"

	"github.com/ajayrajen7/anyway/server/internal/db"
	"github.com/ajayrajen7/anyway/server/internal/settings"
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

func TestGetSetRoundTrip(t *testing.T) {
	conn := openTestDB(t)
	ctx := t.Context()

	if _, ok, err := settings.Get(ctx, conn, "missing"); err != nil || ok {
		t.Fatalf("expected absent key to report ok=false, got ok=%v err=%v", ok, err)
	}

	if err := settings.Set(ctx, conn, "programme_start_date", "2026-01-05"); err != nil {
		t.Fatalf("set: %v", err)
	}
	value, ok, err := settings.Get(ctx, conn, "programme_start_date")
	if err != nil || !ok || value != "2026-01-05" {
		t.Fatalf("expected 2026-01-05/true, got %q/%v (err %v)", value, ok, err)
	}

	// Set again overwrites — it's a plain upsert, unlike SetIfAbsent.
	if err := settings.Set(ctx, conn, "programme_start_date", "2026-02-01"); err != nil {
		t.Fatalf("set again: %v", err)
	}
	value, _, _ = settings.Get(ctx, conn, "programme_start_date")
	if value != "2026-02-01" {
		t.Fatalf("expected overwrite to 2026-02-01, got %q", value)
	}
}

func TestSetIfAbsentNeverOverwrites(t *testing.T) {
	conn := openTestDB(t)
	ctx := t.Context()

	if err := settings.SetIfAbsent(ctx, conn, "programme_start_date", "2026-01-05"); err != nil {
		t.Fatalf("first SetIfAbsent: %v", err)
	}
	if err := settings.SetIfAbsent(ctx, conn, "programme_start_date", "2099-01-01"); err != nil {
		t.Fatalf("second SetIfAbsent: %v", err)
	}
	value, _, _ := settings.Get(ctx, conn, "programme_start_date")
	if value != "2026-01-05" {
		t.Fatalf("expected the first value to stick, got %q", value)
	}
}
