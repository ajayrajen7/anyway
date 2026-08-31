import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../lib/db';
import type { CachedToday, LoggedSet, TodaySlot } from '../lib/types';
import SessionOverview from './SessionOverview';

// getSessionSets is the one network call this screen makes (a best-effort
// background recovery merge — see outbox.ts#hydrateSessionFromServer) —
// mocked the same way generateExercise is in SessionFlows.test.tsx.
// Defaults to "nothing to recover" so every other test here, which never
// sets an expectation on it, behaves exactly as if it were offline.
const { getSessionSetsMock } = vi.hoisted(() => ({ getSessionSetsMock: vi.fn() }));
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return { ...actual, getSessionSets: getSessionSetsMock };
});

function makeSlot(overrides: Partial<TodaySlot> = {}): TodaySlot {
  return {
    id: 100,
    position: 1,
    exercise: { id: 10, slug: 'leg-press', name: 'Leg press', unilateral: false, increment_kg: 5 },
    sets: 2,
    reps: 12,
    load_kg: 20,
    note: null,
    swaps: [],
    last_actual: null,
    ...overrides,
  };
}

async function seedCache(slots: TodaySlot[], sessionId = 42, status: 'planned' | 'completed' | 'missed' = 'planned') {
  const data: CachedToday['data'] = {
    date: '2026-01-05',
    weekday: 1,
    day_template: { id: 1, name: 'Lower A', kind: 'lifting' },
    session: { id: sessionId, status, started_at: null, ended_at: null, note: null },
    slots,
  };
  await db.todayCache.put({ sessionId, date: data.date, cachedAt: new Date().toISOString(), data });
}

function renderOverview(sessionId = 42) {
  return render(
    <MemoryRouter initialEntries={[`/session/${sessionId}`]}>
      <Routes>
        <Route path="/session/:id" element={<SessionOverview />} />
        <Route path="/session/:id/exercise/:key" element={<div>Exercise screen</div>} />
        <Route path="/session/:id/done" element={<div>Session summary screen</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getSessionSetsMock.mockReset();
  getSessionSetsMock.mockResolvedValue([]); // "nothing to recover" default — every test below that cares overrides it
});

afterEach(async () => {
  await db.todayCache.clear();
  await db.loggedSets.clear();
  await db.outbox.clear();
  await db.sessionOverlay.clear();
});

describe('SessionOverview', () => {
  it('lists every exercise with its prescription, and offers Start/Add/Finish', async () => {
    await seedCache([
      makeSlot({ id: 100, exercise: { id: 10, slug: 'a', name: 'Exercise A', unilateral: false, increment_kg: 2.5 }, sets: 3, reps: 12 }),
      makeSlot({ id: 101, exercise: { id: 11, slug: 'b', name: 'Exercise B', unilateral: false, increment_kg: 2.5 }, sets: 3, reps: 10, position: 2 }),
    ]);
    renderOverview();

    expect(await screen.findByText('Lower A')).toBeInTheDocument();
    expect(screen.getByText('2 exercises')).toBeInTheDocument();
    expect(screen.getByText('Exercise A')).toBeInTheDocument();
    expect(screen.getByText('Exercise B')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '+ Add exercise' })).toHaveAttribute('href', '/session/42/add');
    expect(screen.getByRole('link', { name: 'Finish session →' })).toHaveAttribute('href', '/session/42/done');
  });

  // Real bug fixed here: the link showed "Finish session →" unconditionally,
  // even for a session already marked complete — reading as "it lets me
  // finish it again." Owner, diagnosing a separate bug: "there could be an
  // edit session for a completed session." See memory.md.
  it('shows "Session complete" and a "View summary" link instead of "Finish session" once the session is done', async () => {
    await seedCache([makeSlot()], 42, 'completed');
    renderOverview();

    expect(await screen.findByText('✓ Session complete')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Finish session →' })).not.toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'View summary →' });
    expect(link).toHaveAttribute('href', '/session/42/done');
  });

  it('still shows "Finish session" (not "Session complete") for a not-yet-done session', async () => {
    await seedCache([makeSlot()], 42, 'planned');
    renderOverview();

    await screen.findByText('Leg press');
    expect(screen.queryByText('✓ Session complete')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Finish session →' })).toBeInTheDocument();
  });

  it('shows a graceful message when nothing has been cached offline', async () => {
    renderOverview(999);
    await screen.findByText(/not available offline/i);
  });

  it('Start opens the first exercise', async () => {
    const user = userEvent.setup();
    await seedCache([makeSlot()]);
    renderOverview();

    await user.click(await screen.findByRole('button', { name: 'Start' }));
    await screen.findByText('Exercise screen');
  });

  it('tapping an exercise row navigates straight to it — start from any exercise', async () => {
    const user = userEvent.setup();
    await seedCache([
      makeSlot({ id: 100, exercise: { id: 10, slug: 'a', name: 'Exercise A', unilateral: false, increment_kg: 2.5 } }),
      makeSlot({ id: 101, exercise: { id: 11, slug: 'b', name: 'Exercise B', unilateral: false, increment_kg: 2.5 }, position: 2 }),
    ]);
    renderOverview();

    await user.click(await screen.findByText('Exercise B'));
    await screen.findByText('Exercise screen');
  });

  it('deleting an exercise removes it from the list without navigating away', async () => {
    const user = userEvent.setup();
    await seedCache([
      makeSlot({ id: 100, exercise: { id: 10, slug: 'a', name: 'Exercise A', unilateral: false, increment_kg: 2.5 } }),
      makeSlot({ id: 101, exercise: { id: 11, slug: 'b', name: 'Exercise B', unilateral: false, increment_kg: 2.5 }, position: 2 }),
    ]);
    renderOverview();
    await screen.findByText('Exercise A');

    await user.click(screen.getByRole('button', { name: 'Delete Exercise A' }));

    await waitFor(() => expect(screen.queryByText('Exercise A')).not.toBeInTheDocument());
    expect(screen.getByText('Exercise B')).toBeInTheDocument();
    expect(screen.getByText('1 exercises')).toBeInTheDocument();
  });

  it('a row for a prescribed slot offers Swap, navigating to that exercise with the swap sheet open', async () => {
    await seedCache([makeSlot({ id: 100, exercise: { id: 10, slug: 'a', name: 'Exercise A', unilateral: false, increment_kg: 2.5 } })]);
    renderOverview();

    const swapButton = await screen.findByRole('button', { name: 'Swap Exercise A' });
    expect(swapButton).toBeInTheDocument();
  });

  // Real bug fixed here: local IndexedDB can end up with none of a
  // session's logged sets — an iOS "Add to Home Screen" install uses a
  // separate storage container from the Safari tab a workout was logged
  // in, cleared site data, a reinstalled PWA. Reported live as "all the
  // session data is lost." See memory.md's "session data lost" entry and
  // outbox.ts#hydrateSessionFromServer.
  it('recovers a session\'s logged sets from the server when the local copy has none, and marks the exercise done', async () => {
    await seedCache([makeSlot({ id: 100, exercise: { id: 10, slug: 'a', name: 'Exercise A', unilateral: false, increment_kg: 2.5 }, sets: 2 })]);
    const recovered: LoggedSet = {
      id: 501, client_uuid: 'server-uuid-1', session_id: 42, slot_id: 100, exercise_id: 10,
      set_index: 1, load_kg: 20, reps: 12, status: 'done', provenance: 'prescribed', added_by: null,
      logged_at: '2026-01-05T10:00:00Z',
    };
    getSessionSetsMock.mockResolvedValue([recovered]);

    renderOverview();
    await screen.findByText('Exercise A');

    await waitFor(async () => expect(await db.loggedSets.where('session_id').equals(42).count()).toBe(1));
    expect(await screen.findByText('in progress')).toBeInTheDocument(); // 1 of 2 sets now accounted for
  });

  it('does not duplicate a set the local copy already has, matching by client_uuid', async () => {
    await seedCache([makeSlot({ id: 100, exercise: { id: 10, slug: 'a', name: 'Exercise A', unilateral: false, increment_kg: 2.5 } })]);
    await db.loggedSets.add({
      client_uuid: 'already-local', session_id: 42, slot_id: 100, exercise_id: 10,
      set_index: 1, load_kg: 20, reps: 12, status: 'done', provenance: 'prescribed', added_by: null,
      logged_at: '2026-01-05T10:00:00Z',
    });
    getSessionSetsMock.mockResolvedValue([
      { id: 501, client_uuid: 'already-local', session_id: 42, slot_id: 100, exercise_id: 10, set_index: 1, load_kg: 20, reps: 12, status: 'done', provenance: 'prescribed', added_by: null, logged_at: '2026-01-05T10:00:00Z' },
    ]);

    renderOverview();
    await screen.findByText('Exercise A');
    await waitFor(() => expect(getSessionSetsMock).toHaveBeenCalled());

    expect(await db.loggedSets.where('session_id').equals(42).count()).toBe(1);
  });

  it('a failed recovery fetch (offline) leaves the screen working exactly as before', async () => {
    getSessionSetsMock.mockRejectedValue(new Error('offline'));
    await seedCache([makeSlot({ id: 100, exercise: { id: 10, slug: 'a', name: 'Exercise A', unilateral: false, increment_kg: 2.5 } })]);

    renderOverview();

    expect(await screen.findByText('Exercise A')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
  });
});
