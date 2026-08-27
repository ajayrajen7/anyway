// Dexie writes for the session runner (M4). Every mutation goes to
// `loggedSets` (the local source of truth) *and* appends an `outbox` entry
// in the same breath — the background sync worker (M9) drains the outbox to
// the server later. Nothing here ever awaits the network (§B2).
import { db } from './db';
import type { LoggedSet, Provenance } from './types';

async function appendOutbox(entity: string, entityId: string, payload: unknown): Promise<void> {
  await db.outbox.add({
    entity,
    entity_id: entityId,
    payload: JSON.stringify(payload),
    created_at: new Date().toISOString(),
    synced_at: null,
  });
}

export interface LogSetInput {
  sessionId: number;
  slotId: number | null;
  exerciseId: number;
  setIndex: number; // 1-based — "Set 1", "Set 2", ...
  loadKg: number | null;
  reps: number | null; // null for a skipped set — nothing was actually performed
  status: 'done' | 'skipped';
  provenance?: Provenance;
}

// Logs one set (✓ tap, or a swipe-left skip on a single row). Writes to
// `loggedSets` and `outbox` together so a set is never persisted locally
// without also being queued for sync.
export async function logSet(input: LogSetInput): Promise<LoggedSet> {
  const set: LoggedSet = {
    client_uuid: crypto.randomUUID(),
    session_id: input.sessionId,
    slot_id: input.slotId,
    exercise_id: input.exerciseId,
    set_index: input.setIndex,
    load_kg: input.loadKg,
    reps: input.reps,
    status: input.status,
    provenance: input.provenance ?? 'prescribed',
    added_by: null,
    logged_at: new Date().toISOString(),
  };
  await db.transaction('rw', db.loggedSets, db.outbox, async () => {
    await db.loggedSets.add(set);
    await appendOutbox('logged_set', set.client_uuid, set);
  });
  return set;
}

// Sets already logged for a session+exercise, keyed by set_index — the
// reconstruction SessionRunner uses on every mount so its state always comes
// from Dexie, never only from in-memory React state (§B2: Dexie is the
// source of truth during a session, not a cache of it).
export async function loggedSetsFor(sessionId: number, exerciseId: number): Promise<Map<number, LoggedSet>> {
  const rows = await db.loggedSets.where('[session_id+exercise_id]').equals([sessionId, exerciseId]).toArray();
  const bySetIndex = new Map<number, LoggedSet>();
  for (const row of rows) bySetIndex.set(row.set_index, row);
  return bySetIndex;
}

// All sets logged across a whole session (every exercise) — the session
// summary's (`/session/:id/done`) counts and volume.
export async function loggedSetsForSession(sessionId: number): Promise<LoggedSet[]> {
  return db.loggedSets.where('session_id').equals(sessionId).toArray();
}

// Queues a "mark this session complete" intent for the M9 sync worker
// (POST /api/sessions/:id/complete). Idempotent per session — revisiting
// the summary screen must not pile up duplicate outbox entries.
export async function completeSession(sessionId: number): Promise<void> {
  const entityId = String(sessionId);
  const existing = await db.outbox.where({ entity: 'session_complete', entity_id: entityId }).first();
  if (existing) return;
  await appendOutbox('session_complete', entityId, { session_id: sessionId, ended_at: new Date().toISOString() });
}
