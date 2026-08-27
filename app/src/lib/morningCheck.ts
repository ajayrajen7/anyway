// Morning Check (prd.md §A3.1) — offline-first like everything else the
// user logs (§B2): writes go to Dexie + outbox together, never straight to
// the network. `POST /api/morning-check` stays a 501 stub until M9's sync
// worker drains the outbox, same as logged sets and session completion.
//
// The core invariant this module must never violate: **an unlogged day
// stays absent from `morningChecks`, never defaulted to `'none'`.** There is
// deliberately no code path here that writes a row except a real tap on one
// of the four buttons — no timeout, no "give up and record none" fallback.
import { db } from './db';
import type { MorningCheck, PainLevel } from './types';

export async function getMorningCheck(date: string): Promise<MorningCheck | undefined> {
  return db.morningChecks.get(date);
}

export async function logMorningCheck(date: string, pain: PainLevel): Promise<void> {
  await db.transaction('rw', db.morningChecks, db.outbox, async () => {
    await db.morningChecks.put({ date, pain });
    await db.outbox.add({
      entity: 'morning_check',
      entity_id: date,
      payload: JSON.stringify({ date, pain }),
      created_at: new Date().toISOString(),
      synced_at: null,
    });
  });
}
