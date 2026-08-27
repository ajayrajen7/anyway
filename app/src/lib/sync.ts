// The M9 sync worker — drains the local outbox (§B2) to the server whenever
// the app has a real chance to run: on app mount, and whenever the browser
// regains connectivity (see main.tsx's two call sites). This is
// deliberately **foreground-only**, not a true Service-Worker background
// sync — the same iOS/cross-browser delivery unreliability that got M6's
// push notifications deferred applies here too, and the offline-first
// design (§B2) means nothing is ever lost by only draining while the app
// happens to be open; it just syncs a little later. See memory.md (M9).
import { postSync } from './api';
import { db } from './db';

let syncing = false; // avoid overlapping drains (mount firing right as 'online' fires)

export async function runSync(): Promise<void> {
  if (syncing) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  syncing = true;
  try {
    const pending = await db.outbox.filter((entry) => entry.synced_at == null).toArray();
    if (pending.length === 0) return;

    const results = await postSync(
      pending.map((entry) => ({ entity: entry.entity, entity_id: entry.entity_id, payload: JSON.parse(entry.payload) })),
    );
    // Match by (entity, entity_id) pair, not entity_id alone — two
    // different entities can legitimately share one (e.g. a protein_log and
    // a mobility_log both keyed by the same date).
    const okKeys = new Set(results.filter((r) => r.ok).map((r) => `${r.entity}:${r.entity_id}`));

    const now = new Date().toISOString();
    await db.transaction('rw', db.outbox, async () => {
      for (const entry of pending) {
        if (entry.id != null && okKeys.has(`${entry.entity}:${entry.entity_id}`)) {
          await db.outbox.update(entry.id, { synced_at: now });
        }
      }
    });
  } catch (err) {
    // Best-effort, same as cacheExerciseLibrary/cacheProgramme: a failed
    // sync attempt just means the outbox stays as it was and gets drained
    // on the next trigger.
    console.error('sync failed', err);
  } finally {
    syncing = false;
  }
}
