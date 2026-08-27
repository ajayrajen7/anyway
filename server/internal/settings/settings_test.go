package settings_test

import (
	"database/sql"
	"testing"
	"time"

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

func TestVaultUnlockedDefaultsLockedWhenNoStartDateRecorded(t *testing.T) {
	conn := openTestDB(t)
	unlocked, err := settings.VaultUnlocked(t.Context(), conn, time.Now())
	if err != nil {
		t.Fatalf("VaultUnlocked: %v", err)
	}
	if unlocked {
		t.Fatalf("expected locked (conservative default) with no programme_start_date set")
	}
}

func TestVaultUnlockedAt84Days(t *testing.T) {
	conn := openTestDB(t)
	ctx := t.Context()
	if err := settings.Set(ctx, conn, settings.ProgrammeStartDateKey, "2026-01-01"); err != nil {
		t.Fatalf("set start date: %v", err)
	}

	before := time.Date(2026, 3, 25, 12, 0, 0, 0, time.UTC) // day 83
	unlocked, err := settings.VaultUnlocked(ctx, conn, before)
	if err != nil || unlocked {
		t.Fatalf("expected still-locked at day 83, got unlocked=%v err=%v", unlocked, err)
	}

	onDay := time.Date(2026, 3, 26, 0, 0, 0, 0, time.UTC) // exactly day 84
	unlocked, err = settings.VaultUnlocked(ctx, conn, onDay)
	if err != nil || !unlocked {
		t.Fatalf("expected unlocked at exactly day 84, got unlocked=%v err=%v", unlocked, err)
	}

	after := time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC)
	unlocked, err = settings.VaultUnlocked(ctx, conn, after)
	if err != nil || !unlocked {
		t.Fatalf("expected still unlocked well after day 84, got unlocked=%v err=%v", unlocked, err)
	}
}
