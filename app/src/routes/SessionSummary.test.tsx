import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../lib/db';
import { logSet } from '../lib/outbox';
import SessionSummary from './SessionSummary';

// See SessionOverview.test.tsx's identical setup — getSessionSets is the
// one network call this screen makes (a best-effort background recovery
// merge, see outbox.ts#hydrateSessionFromServer).
const { getSessionSetsMock } = vi.hoisted(() => ({ getSessionSetsMock: vi.fn() }));
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return { ...actual, getSessionSets: getSessionSetsMock };
});

function renderSummary(sessionId = 42) {
  return render(
    <MemoryRouter initialEntries={[`/session/${sessionId}/done`]}>
      <Routes>
        <Route path="/session/:id/done" element={<SessionSummary />} />
        <Route path="/" element={<div>Today screen</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getSessionSetsMock.mockReset();
  getSessionSetsMock.mockResolvedValue([]); // "nothing to recover" default — the recovery test below overrides it
});

afterEach(async () => {
  await db.loggedSets.clear();
  await db.outbox.clear();
  await db.sessionOverlay.clear();
});

describe('SessionSummary', () => {
  it('shows counts and total volume computed from this session\'s logged sets', async () => {
    await logSet({ sessionId: 42, slotId: 1, exerciseId: 10, setIndex: 1, loadKg: 20, reps: 10, status: 'done' });
    await logSet({ sessionId: 42, slotId: 1, exerciseId: 10, setIndex: 2, loadKg: 20, reps: 8, status: 'done' });
    await logSet({ sessionId: 42, slotId: 1, exerciseId: 10, setIndex: 3, loadKg: null, reps: null, status: 'skipped' });
    // a different session's sets must not leak into this summary
    await logSet({ sessionId: 999, slotId: 2, exerciseId: 20, setIndex: 1, loadKg: 100, reps: 100, status: 'done' });

    renderSummary(42);

    expect(await screen.findByText('2 sets done')).toBeInTheDocument();
    expect(screen.getByText('1 sets skipped')).toBeInTheDocument();
    expect(screen.getByText(`${20 * 10 + 20 * 8} kg total volume`)).toBeInTheDocument();
  });

  it('queues a session_complete outbox entry exactly once, even if revisited', async () => {
    renderSummary(42);
    await screen.findByText('0 sets done');

    renderSummary(42); // simulate a second visit
    await screen.findAllByText('0 sets done');

    const entries = await db.outbox.where({ entity: 'session_complete', entity_id: '42' }).toArray();
    expect(entries).toHaveLength(1);
  });

  // Post-M12 feature 4 ("this week's actual plan becomes next week's
  // base"): the server needs to know which deletions were real slots.
  it('queues session_complete with the real slot ids explicitly deleted from this session', async () => {
    await db.sessionOverlay.put({ sessionId: 42, swaps: {}, added: [], removed: ['slot-5', 'added-uuid-1'] });

    renderSummary(42);
    await screen.findByText('0 sets done');

    const entries = await db.outbox.where({ entity: 'session_complete', entity_id: '42' }).toArray();
    expect(entries).toHaveLength(1);
    expect(JSON.parse(entries[0].payload)).toMatchObject({ removed_slot_ids: [5] });
  });

  it('links back to Today', async () => {
    renderSummary(42);
    const link = await screen.findByRole('link', { name: 'Done' });
    expect(link).toHaveAttribute('href', '/');
  });

  // Real bug fixed here: a genuine "0 sets done, 0 skipped, 0 kg" (all the
  // session's local data gone — see memory.md's "session data lost" entry)
  // becomes the real total once the recovery fetch finds what the server
  // actually has.
  it('recovers the real totals from the server when the local copy has nothing for this session', async () => {
    getSessionSetsMock.mockResolvedValue([
      { id: 501, client_uuid: 'server-uuid-1', session_id: 42, slot_id: 1, exercise_id: 10, set_index: 1, load_kg: 20, reps: 10, status: 'done', provenance: 'prescribed', added_by: null, logged_at: '2026-01-05T10:00:00Z' },
      { id: 502, client_uuid: 'server-uuid-2', session_id: 42, slot_id: 1, exercise_id: 10, set_index: 2, load_kg: 20, reps: 8, status: 'done', provenance: 'prescribed', added_by: null, logged_at: '2026-01-05T10:01:00Z' },
    ]);

    renderSummary(42);
    await screen.findByText('0 sets done'); // renders from the (empty) local copy first, same as before

    expect(await screen.findByText('2 sets done')).toBeInTheDocument();
    expect(screen.getByText(`${20 * 10 + 20 * 8} kg total volume`)).toBeInTheDocument();
    expect(await db.loggedSets.where('session_id').equals(42).count()).toBe(2);
  });

  it('a failed recovery fetch (offline) leaves the real local totals showing, unchanged', async () => {
    getSessionSetsMock.mockRejectedValue(new Error('offline'));
    await logSet({ sessionId: 42, slotId: 1, exerciseId: 10, setIndex: 1, loadKg: 20, reps: 10, status: 'done' });

    renderSummary(42);

    expect(await screen.findByText('1 sets done')).toBeInTheDocument();
    await waitFor(() => expect(getSessionSetsMock).toHaveBeenCalled());
    expect(screen.getByText('1 sets done')).toBeInTheDocument(); // unchanged after the failed attempt resolves
  });
});
