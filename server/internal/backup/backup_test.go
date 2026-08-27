package backup_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/ajayrajen7/anyway/server/internal/backup"
	"github.com/ajayrajen7/anyway/server/internal/db"
)

func TestRunWritesATimestampedFileThatOpensCleanly(t *testing.T) {
	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer conn.Close()
	if _, err := conn.Exec(`INSERT INTO exercises (slug, name, equipment, pressure, impact, increment_kg) VALUES ('squat','Squat','barbell','moderate','low',2.5)`); err != nil {
		t.Fatalf("seed: %v", err)
	}

	dir := t.TempDir()
	now := time.Date(2026, 3, 1, 3, 0, 0, 0, time.UTC)
	path, err := backup.Run(context.Background(), conn, dir, now)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if filepath.Base(path) != "anyway-20260301-030000.db" {
		t.Fatalf("unexpected backup filename: %s", filepath.Base(path))
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("backup file missing: %v", err)
	}

	// The backup is a real, independently-openable SQLite file with the
	// seeded row in it — not just an empty file at the right path.
	restored, err := db.Open(path)
	if err != nil {
		t.Fatalf("open backup file: %v", err)
	}
	defer restored.Close()
	var slug string
	if err := restored.QueryRow(`SELECT slug FROM exercises`).Scan(&slug); err != nil || slug != "squat" {
		t.Fatalf("expected the seeded exercise to survive the backup, got slug=%q err=%v", slug, err)
	}
}

func TestRunRefusesToOverwriteAnExistingBackup(t *testing.T) {
	conn, err := db.Open(":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer conn.Close()
	dir := t.TempDir()
	now := time.Date(2026, 3, 1, 3, 0, 0, 0, time.UTC)

	if _, err := backup.Run(context.Background(), conn, dir, now); err != nil {
		t.Fatalf("first Run: %v", err)
	}
	if _, err := backup.Run(context.Background(), conn, dir, now); err == nil {
		t.Fatalf("expected the second Run at the identical timestamp to fail rather than overwrite")
	}
}

func TestPruneKeepsOnlyTheMostRecentN(t *testing.T) {
	dir := t.TempDir()
	names := []string{
		"anyway-20260101-030000.db",
		"anyway-20260102-030000.db",
		"anyway-20260103-030000.db",
		"anyway-20260104-030000.db",
		"not-a-backup.txt", // must survive Prune untouched
	}
	for _, name := range names {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o644); err != nil {
			t.Fatalf("write %s: %v", name, err)
		}
	}

	if err := backup.Prune(dir, 2); err != nil {
		t.Fatalf("Prune: %v", err)
	}

	remaining, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read dir: %v", err)
	}
	var got []string
	for _, e := range remaining {
		got = append(got, e.Name())
	}
	want := []string{"anyway-20260103-030000.db", "anyway-20260104-030000.db", "not-a-backup.txt"}
	if len(got) != len(want) {
		t.Fatalf("expected %v, got %v", want, got)
	}
	for _, w := range want {
		found := false
		for _, g := range got {
			if g == w {
				found = true
			}
		}
		if !found {
			t.Fatalf("expected %s to survive pruning, got %v", w, got)
		}
	}
}

func TestPruneOnAMissingDirectoryIsANoOp(t *testing.T) {
	if err := backup.Prune(filepath.Join(t.TempDir(), "does-not-exist"), 5); err != nil {
		t.Fatalf("expected no error for a missing directory, got %v", err)
	}
}
