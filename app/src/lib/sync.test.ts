import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import { runSync } from './sync';

const { postSyncMock } = vi.hoisted(() => ({ postSyncMock: vi.fn() }));
vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return { ...actual, postSync: postSyncMock };
});

afterEach(async () => {
  postSyncMock.mockReset();
  await db.outbox.clear();
});

describe('runSync', () => {
  it('does nothing when the outbox is empty', async () => {
    await runSync();
    expect(postSyncMock).not.toHaveBeenCalled();
  });

  it('sends every unsynced outbox row and marks the ones the server accepted', async () => {
    await db.outbox.bulkAdd([
      { entity: 'protein_log', entity_id: '2026-01-05', payload: JSON.stringify({ date: '2026-01-05', hit: true }), created_at: 'x', synced_at: null },
      { entity: 'mobility_log', entity_id: '2026-01-05', payload: JSON.stringify({ date: '2026-01-05' }), created_at: 'x', synced_at: null },
    ]);
    postSyncMock.mockResolvedValue([
      { entity: 'protein_log', entity_id: '2026-01-05', ok: true },
      { entity: 'mobility_log', entity_id: '2026-01-05', ok: false, error: 'boom' },
    ]);

    await runSync();

    expect(postSyncMock).toHaveBeenCalledWith([
      { entity: 'protein_log', entity_id: '2026-01-05', payload: { date: '2026-01-05', hit: true } },
      { entity: 'mobility_log', entity_id: '2026-01-05', payload: { date: '2026-01-05' } },
    ]);

    const rows = await db.outbox.toArray();
    const protein = rows.find((r) => r.entity === 'protein_log')!;
    const mobility = rows.find((r) => r.entity === 'mobility_log')!;
    expect(protein.synced_at).not.toBeNull();
    expect(mobility.synced_at).toBeNull(); // server rejected it — stays pending for the next drain
  });

  it('never syncs an already-synced row again', async () => {
    await db.outbox.add({
      entity: 'protein_log',
      entity_id: '2026-01-05',
      payload: JSON.stringify({ date: '2026-01-05', hit: true }),
      created_at: 'x',
      synced_at: 'already-done',
    });

    await runSync();

    expect(postSyncMock).not.toHaveBeenCalled();
  });

  it('leaves the outbox untouched if the request itself fails', async () => {
    await db.outbox.add({
      entity: 'protein_log',
      entity_id: '2026-01-05',
      payload: JSON.stringify({ date: '2026-01-05', hit: true }),
      created_at: 'x',
      synced_at: null,
    });
    postSyncMock.mockRejectedValue(new Error('offline'));

    await expect(runSync()).resolves.toBeUndefined(); // never throws

    const row = await db.outbox.toArray();
    expect(row[0].synced_at).toBeNull();
  });
});
