// Weigh-in (prd.md §A4, "the Vault") — Sunday-only, blind entry. Offline-
// first like every other log (§B2): Dexie + outbox together, synced later
// by M9's sync worker (POST /api/weigh-ins, write always allowed — the
// *read*, GET /api/weigh-ins, is what the server gates for 84 days).
//
// The value is entered live (the stepper has to show it — the whole point
// is dialing in the number actually on the scale) but is never shown back
// once saved: there is deliberately no export here that reads `weight_kg`
// back out, only presence. That's the "blind entry" the PRD means —
// vanishes the moment you commit it, not invisible while you're entering it.
import { db } from './db';
import type { WeighIn } from './types';

export async function logWeighIn(date: string, weightKg: number): Promise<void> {
  await db.transaction('rw', db.weighIns, db.outbox, async () => {
    await db.weighIns.put({ date, weight_kg: weightKg });
    await db.outbox.add({
      entity: 'weigh_in',
      entity_id: date,
      payload: JSON.stringify({ date, weight_kg: weightKg } satisfies WeighIn),
      created_at: new Date().toISOString(),
      synced_at: null,
    });
  });
}

// Presence-only — whether *a* weigh-in exists for this date, never the
// value itself. Used to show "Saved" and skip re-entry, nothing else.
export async function hasWeighIn(date: string): Promise<boolean> {
  return (await db.weighIns.get(date)) !== undefined;
}
