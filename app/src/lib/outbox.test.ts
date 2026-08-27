import { afterEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { logSet, loggedSetsFor } from './outbox';

afterEach(async () => {
  await db.loggedSets.clear();
  await db.outbox.clear();
});

describe('logSet', () => {
  it('writes a loggedSets row and an outbox entry in the same call', async () => {
    const set = await logSet({
      sessionId: 1,
      slotId: 5,
      exerciseId: 10,
      setIndex: 1,
      loadKg: 25,
      reps: 12,
      status: 'done',
    });

    const stored = await db.loggedSets.toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ session_id: 1, slot_id: 5, exercise_id: 10, set_index: 1, load_kg: 25, reps: 12, status: 'done' });

    const outboxRows = await db.outbox.toArray();
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]).toMatchObject({ entity: 'logged_set', entity_id: set.client_uuid, synced_at: null });
    expect(JSON.parse(outboxRows[0].payload)).toMatchObject({ client_uuid: set.client_uuid, load_kg: 25 });
  });

  it('defaults provenance to prescribed', async () => {
    const set = await logSet({ sessionId: 1, slotId: 5, exerciseId: 10, setIndex: 1, loadKg: 20, reps: 10, status: 'done' });
    expect(set.provenance).toBe('prescribed');
  });
});

describe('loggedSetsFor', () => {
  it('returns previously logged sets for a session+exercise keyed by set_index', async () => {
    await logSet({ sessionId: 1, slotId: 5, exerciseId: 10, setIndex: 1, loadKg: 20, reps: 12, status: 'done' });
    await logSet({ sessionId: 1, slotId: 5, exerciseId: 10, setIndex: 2, loadKg: 20, reps: 10, status: 'skipped' });
    // A different exercise's set must not leak in.
    await logSet({ sessionId: 1, slotId: 6, exerciseId: 11, setIndex: 1, loadKg: 30, reps: 8, status: 'done' });

    const bySetIndex = await loggedSetsFor(1, 10);
    expect(bySetIndex.size).toBe(2);
    expect(bySetIndex.get(1)).toMatchObject({ status: 'done', reps: 12 });
    expect(bySetIndex.get(2)).toMatchObject({ status: 'skipped', reps: 10 });
  });

  it('returns an empty map when nothing has been logged yet', async () => {
    const bySetIndex = await loggedSetsFor(99, 99);
    expect(bySetIndex.size).toBe(0);
  });
});
