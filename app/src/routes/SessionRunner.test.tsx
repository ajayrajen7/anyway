import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../lib/db';
import type { CachedToday, TodaySlot } from '../lib/types';
import SessionRunner from './SessionRunner';

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

async function seedCache(slots: TodaySlot[], sessionId = 42) {
  const data: CachedToday['data'] = {
    date: '2026-01-05',
    weekday: 1,
    day_template: { id: 1, name: 'Lower A', kind: 'lifting' },
    session: { id: sessionId, status: 'planned', started_at: null, ended_at: null, note: null },
    slots,
  };
  await db.todayCache.put({ sessionId, date: data.date, cachedAt: new Date().toISOString(), data });
}

function renderRunner(sessionId = 42) {
  return render(
    <MemoryRouter initialEntries={[`/session/${sessionId}`]}>
      <Routes>
        <Route path="/session/:id" element={<SessionRunner />} />
        <Route path="/session/:id/done" element={<div>Session summary screen</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(async () => {
  await db.todayCache.clear();
  await db.loggedSets.clear();
  await db.outbox.clear();
});

describe('SessionRunner — B6.1 hard rule', () => {
  it('never renders a focusable text input anywhere in the subtree', async () => {
    await seedCache([makeSlot()]);
    const { container } = renderRunner();
    await screen.findByText('Leg press');
    expect(container.querySelectorAll('input, textarea')).toHaveLength(0);
  });
});

describe('SessionRunner — offline read path', () => {
  it('shows a graceful message when nothing has been cached', async () => {
    const { findByText } = renderRunner(999);
    await findByText(/not available offline/i);
  });

  it('renders the cached slot with its prescribed sets/reps/load', async () => {
    await seedCache([makeSlot({ sets: 3, reps: 12, load_kg: 20 })]);
    renderRunner();
    await screen.findByTestId('set-row-2'); // wait for all 3 rows — the row-reconstruction effect is async
    expect(screen.getByText('Exercise 1 of 1')).toBeInTheDocument();
    expect(screen.getByText(/Prescribed: 3 × 12/)).toBeInTheDocument();
    expect(screen.getAllByText('20 kg')).toHaveLength(3); // one per pending row, pre-filled from prescribed
  });

  it('pre-fills from last_actual instead of the prescribed values when one exists', async () => {
    await seedCache([makeSlot({ sets: 1, load_kg: 20, reps: 12, last_actual: { load_kg: 27.5, reps: 10 } })]);
    renderRunner();
    expect(await screen.findByText('27.5 kg')).toBeInTheDocument(); // the pending row's editable weight
    expect(screen.getByText(/Last time: 1 × 10/)).toBeInTheDocument();
  });
});

describe('SessionRunner — logging a set', () => {
  it('tapping ✓ logs the set as done, greys the row, and starts the rest timer', async () => {
    const user = userEvent.setup();
    await seedCache([makeSlot({ sets: 1, load_kg: 20, reps: 12 })]);
    renderRunner();

    await user.click(await screen.findByRole('button', { name: 'Log set 1' }));

    await waitFor(() => expect(screen.getByText('done')).toBeInTheDocument());
    expect(await screen.findByText(/Rest: \d:\d\d/)).toBeInTheDocument();

    const stored = await db.loggedSets.toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ session_id: 42, slot_id: 100, exercise_id: 10, set_index: 1, load_kg: 20, reps: 12, status: 'done' });
  });

  it('editing the weight via the stepper then tapping ✓ commits the adjusted value', async () => {
    const user = userEvent.setup();
    await seedCache([makeSlot({ sets: 1, load_kg: 20, reps: 12 })]);
    renderRunner();

    await user.click(await screen.findByText('20 kg')); // enter edit mode
    await user.click(screen.getByRole('button', { name: 'Increase weight' })); // +5kg increment
    await user.click(screen.getByRole('button', { name: 'Log set 1' }));

    await waitFor(async () => {
      const stored = await db.loggedSets.toArray();
      expect(stored[0]?.load_kg).toBe(25);
    });
  });

  it('swiping a row left skips it, storing no load/reps', async () => {
    await seedCache([makeSlot({ sets: 1, load_kg: 20, reps: 12 })]);
    renderRunner();

    const row = await screen.findByTestId('set-row-0');
    fireEvent.pointerDown(row, { clientX: 200 });
    fireEvent.pointerUp(row, { clientX: 100 }); // 100px left swipe, past the 80px threshold

    await waitFor(() => expect(screen.getByText('skipped')).toBeInTheDocument());
    const stored = await db.loggedSets.toArray();
    expect(stored[0]).toMatchObject({ status: 'skipped', load_kg: null, reps: null });
  });

  it('reconstructs already-logged rows from Dexie on remount, not just React state', async () => {
    await seedCache([makeSlot({ sets: 2, load_kg: 20, reps: 12 })]);
    const { unmount } = renderRunner();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Log set 1' }));
    await waitFor(() => expect(screen.getByText('done')).toBeInTheDocument());
    unmount();

    renderRunner();
    expect(await screen.findByText('done')).toBeInTheDocument();
  });
});

describe('SessionRunner — exercise navigation', () => {
  it('Skip logs all pending sets as skipped and advances to the next exercise', async () => {
    const user = userEvent.setup();
    await seedCache([
      makeSlot({ id: 100, exercise: { id: 10, slug: 'a', name: 'Exercise A', unilateral: false, increment_kg: 2.5 }, sets: 2 }),
      makeSlot({ id: 101, exercise: { id: 11, slug: 'b', name: 'Exercise B', unilateral: false, increment_kg: 2.5 }, sets: 1, position: 2 }),
    ]);
    renderRunner();
    await screen.findByTestId('set-row-1'); // wait for both of exercise A's rows, and Skip to be enabled

    await user.click(screen.getByRole('button', { name: 'Skip' }));

    await screen.findByText('Exercise B');
    expect(screen.getByText('Exercise 2 of 2')).toBeInTheDocument();
    const stored = await db.loggedSets.where({ exercise_id: 10 }).toArray();
    expect(stored).toHaveLength(2);
    expect(stored.every((s) => s.status === 'skipped')).toBe(true);
  });

  it('Next on the last exercise navigates to the session summary', async () => {
    const user = userEvent.setup();
    await seedCache([makeSlot({ sets: 1 })]);
    renderRunner();
    await screen.findByTestId('set-row-0'); // wait for Next to be enabled

    await user.click(screen.getByRole('button', { name: 'Next →' }));

    await screen.findByText('Session summary screen');
  });
});
