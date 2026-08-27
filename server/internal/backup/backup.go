// Package backup implements the nightly on-disk snapshot docs/architecture.md
// §B2 calls "the one unrecoverable failure mode": "Nightly VACUUM INTO to a
// timestamped file, plus off-box copy." SQLite is the durable store but it's
// still one file on one disk — VACUUM INTO gives a consistent, compacted
// snapshot that's safe to copy even while the server keeps writing to the
// live file.
//
// The "off-box copy" half of that sentence is deliberately NOT implemented
// here. It names a real destination (object storage, another host, etc.)
// that nobody has specified — CLAUDE.md's own rule 4 is "ask before...
// architectural changes... surface, don't assume," and picking S3 vs. rsync
// vs. something else on no information would be exactly that kind of
// unasked assumption. OffBoxCopy below is the extension point: nil by
// default (logged clearly, not silently skipped), ready to be filled in
// once a real destination is chosen. See memory.md (M10).
package backup

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"
)

// timestampFormat sorts correctly as a plain string, which Prune relies on
// instead of parsing each filename back into a time.Time.
const timestampFormat = "20060102-150405"

const filePrefix = "anyway-"
const fileSuffix = ".db"

// Run performs one VACUUM INTO backup into dir, named from `now`. VACUUM
// INTO refuses to overwrite an existing file, which is the right failure
// mode for a backup path: a stray retry within the same second errors
// loudly rather than silently clobbering a good snapshot.
func Run(ctx context.Context, conn *sql.DB, dir string, now time.Time) (string, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("create backup dir %s: %w", dir, err)
	}
	path := filepath.Join(dir, filePrefix+now.UTC().Format(timestampFormat)+fileSuffix)
	if _, err := conn.ExecContext(ctx, `VACUUM INTO ?`, path); err != nil {
		return "", fmt.Errorf("vacuum into %s: %w", path, err)
	}
	return path, nil
}

// Prune deletes this package's own backup files in dir beyond the `keep`
// most recent, by filename (which sorts chronologically — see
// timestampFormat). Never touches a file that doesn't match this package's
// own naming pattern, so a shared backups/ directory holding something else
// is left alone.
func Prune(dir string, keep int) error {
	if keep < 0 {
		return fmt.Errorf("keep must be >= 0, got %d", keep)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil // nothing backed up yet — nothing to prune
		}
		return fmt.Errorf("read backup dir %s: %w", dir, err)
	}

	var names []string
	for _, e := range entries {
		if !e.IsDir() && isBackupFilename(e.Name()) {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names) // filePrefix + timestampFormat sorts oldest..newest lexically

	if len(names) <= keep {
		return nil
	}
	for _, name := range names[:len(names)-keep] {
		if err := os.Remove(filepath.Join(dir, name)); err != nil {
			return fmt.Errorf("remove old backup %s: %w", name, err)
		}
	}
	return nil
}

func isBackupFilename(name string) bool {
	return len(name) > len(filePrefix)+len(fileSuffix) &&
		name[:len(filePrefix)] == filePrefix &&
		name[len(name)-len(fileSuffix):] == fileSuffix
}

// OffBoxCopy, when set, is called with the path Run just wrote, after a
// successful local backup — the not-yet-implemented "off-box copy" half of
// §B2. Left nil until a real destination is chosen (see the package doc and
// memory.md, M10); RunNightly logs plainly when it's unset rather than
// pretending the backup is fully off-box already.
type OffBoxCopy func(ctx context.Context, path string) error

// RunNightly blocks, running one backup+prune cycle at the next occurrence
// of atHour:00 local time and every 24h after that, until ctx is canceled.
// Intended to run in its own goroutine (see cmd/server) — a single-user app
// backing up a single small SQLite file doesn't need anything fancier than
// a plain loop.
func RunNightly(ctx context.Context, conn *sql.DB, dir string, atHour, keep int, offBox OffBoxCopy, log func(string, ...any)) {
	for {
		wait := time.Until(nextOccurrence(time.Now(), atHour))
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}

		path, err := Run(ctx, conn, dir, time.Now())
		if err != nil {
			log("nightly backup failed: %v", err)
			continue
		}
		log("nightly backup written to %s", path)

		if offBox != nil {
			if err := offBox(ctx, path); err != nil {
				log("off-box copy of %s failed: %v", path, err)
			}
		} else {
			log("off-box copy not configured — %s exists only on this host's disk", path)
		}

		if err := Prune(dir, keep); err != nil {
			log("prune old backups failed: %v", err)
		}
	}
}

// nextOccurrence is the next time atHour:00:00 occurs in local time,
// strictly after `now` (so calling this exactly at atHour:00:00.000 waits a
// full day, not zero seconds — an edge case not worth the complexity of
// distinguishing "just fired" from "about to fire").
func nextOccurrence(now time.Time, atHour int) time.Time {
	next := time.Date(now.Year(), now.Month(), now.Day(), atHour, 0, 0, 0, now.Location())
	if !next.After(now) {
		next = next.AddDate(0, 0, 1)
	}
	return next
}
