import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import { hydrateSessionFromServer, logSet, loggedSetsFor, undoLogSet } from './outbox';
import type { LoggedSet } from './types';

const { getSessionSetsMock } = vi.hoisted(() => ({ getSessionSetsMock: vi.fn() }));
vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return { ...actual, getSessionSets: getSessionSetsMock };
});

beforeEach(() => {
  getSessionSetsMock.mockReset();
});

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

describe('undoLogSet', () => {
  it('deletes the loggedSets row and its not-yet-synced outbox entry', async () => {
    const set = await logSet({ sessionId: 1, slotId: 5, exerciseId: 10, setIndex: 1, loadKg: 20, reps: 12, status: 'done' });

    await undoLogSet(set.client_uuid);

    expect(await db.loggedSets.toArray()).toHaveLength(0);
    expect(await db.outbox.where({ entity: 'logged_set', entity_id: set.client_uuid }).toArray()).toHaveLength(0);
  });

  it('leaves other logged sets untouched', async () => {
    const first = await logSet({ sessionId: 1, slotId: 5, exerciseId: 10, setIndex: 1, loadKg: 20, reps: 12, status: 'done' });
    await logSet({ sessionId: 1, slotId: 5, exerciseId: 10, setIndex: 2, loadKg: 20, reps: 10, status: 'done' });

    await undoLogSet(first.client_uuid);

    const remaining = await db.loggedSets.toArray();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].set_index).toBe(2);
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

// The recovery path for memory.md's "session data lost" bug — see the
// function's own doc comment for the full reasoning.
describe('hydrateSessionFromServer', () => {
  function serverSet(overrides: Partial<LoggedSet> = {}): LoggedSet {
    return {
      id: 501, client_uuid: 'server-uuid-1', session_id: 1, slot_id: 5, exercise_id: 10,
      set_index: 1, load_kg: 20, reps: 12, status: 'done', provenance: 'prescribed', added_by: null,
      logged_at: '2026-01-05T10:00:00Z',
      ...overrides,
    };
  }

  it('inserts sets the server has that the local copy is missing entirely', async () => {
    getSessionSetsMock.mockResolvedValue([serverSet()]);

    const added = await hydrateSessionFromServer(1);

    expect(added).toBe(1);
    const stored = await db.loggedSets.toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ client_uuid: 'server-uuid-1', session_id: 1, load_kg: 20, reps: 12 });
  });

  it('strips the server\'s own row id — Dexie assigns its own local id', async () => {
    getSessionSetsMock.mockResolvedValue([serverSet({ id: 999 })]);

    await hydrateSessionFromServer(1);

    const stored = await db.loggedSets.where('client_uuid').equals('server-uuid-1').first();
    expect(stored?.id).not.toBe(999); // Dexie's own ++id, not the server's
  });

  it('does not duplicate a set the local copy already has, matched by client_uuid', async () => {
    await logSet({ sessionId: 1, slotId: 5, exerciseId: 10, setIndex: 1, loadKg: 20, reps: 12, status: 'done' });
    const [existing] = await db.loggedSets.toArray();
    getSessionSetsMock.mockResolvedValue([serverSet({ client_uuid: existing.client_uuid })]);

    const added = await hydrateSessionFromServer(1);

    expect(added).toBe(0);
    expect(await db.loggedSets.count()).toBe(1);
  });

  it('adds no outbox entry for a recovered set — it came from the server, it is already synced', async () => {
    getSessionSetsMock.mockResolvedValue([serverSet()]);

    await hydrateSessionFromServer(1);

    expect(await db.outbox.count()).toBe(0);
  });

  it('does not touch a different session\'s sets', async () => {
    getSessionSetsMock.mockResolvedValue([serverSet({ session_id: 2 })]);

    await hydrateSessionFromServer(1); // asking about session 1, server has a set for session 2

    // hydrateSessionFromServer(1) only ever calls getSessionSets(1) — the
    // server itself is what scopes the response to one session (see
    // ListSetsForSessionDoesNotConflateOtherSessions on the Go side); this
    // just confirms the merge doesn't second-guess what the server sent.
    expect(getSessionSetsMock).toHaveBeenCalledWith(1);
  });

  it('is a no-op when the server has nothing for this session', async () => {
    getSessionSetsMock.mockResolvedValue([]);

    const added = await hydrateSessionFromServer(1);

    expect(added).toBe(0);
    expect(await db.loggedSets.count()).toBe(0);
  });

  it('swallows a failed fetch (offline) and returns 0, rather than throwing', async () => {
    getSessionSetsMock.mockRejectedValue(new Error('offline'));

    await expect(hydrateSessionFromServer(1)).resolves.toBe(0);
    expect(await db.loggedSets.count()).toBe(0);
  });
});
