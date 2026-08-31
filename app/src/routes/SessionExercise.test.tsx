import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../lib/db';
import type { CachedToday, TodaySlot } from '../lib/types';
import SessionExercise from './SessionExercise';

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

// slot-100 is the key buildRunnerSlots derives for the first (only) seeded slot.
function renderExercise(key = 'slot-100', sessionId = 42) {
  return render(
    <MemoryRouter initialEntries={[`/session/${sessionId}/exercise/${key}`]}>
      <Routes>
        <Route path="/session/:id" element={<div>Exercise list screen</div>} />
        <Route path="/session/:id/exercise/:key" element={<SessionExercise />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(async () => {
  await db.todayCache.clear();
  await db.loggedSets.clear();
  await db.outbox.clear();
  await db.sessionOverlay.clear();
});

describe('SessionExercise — B6.1 hard rule', () => {
  it('never renders a focusable text input anywhere in the subtree', async () => {
    await seedCache([makeSlot()]);
    const { container } = renderExercise();
    await screen.findByText('Leg press');
    expect(container.querySelectorAll('input, textarea')).toHaveLength(0);
  });
});

describe('SessionExercise — offline read path', () => {
  it('shows a graceful message when nothing has been cached', async () => {
    renderExercise('slot-100', 999);
    await screen.findByText(/not available offline/i);
  });

  it('renders the cached slot with its prescribed sets/reps/load', async () => {
    await seedCache([makeSlot({ sets: 3, reps: 12, load_kg: 20 })]);
    renderExercise();
    await screen.findByTestId('set-row-2'); // wait for all 3 rows
    expect(screen.getByText('1 of 1')).toBeInTheDocument();
    expect(screen.getByText(/Prescribed: 3 × 12/)).toBeInTheDocument();
    expect(screen.getAllByText('20 kg')).toHaveLength(3);
  });

  it('shows a not-found message if the key no longer resolves (e.g. deleted from the session)', async () => {
    await seedCache([makeSlot()]);
    renderExercise('slot-999');
    await screen.findByText(/exercise not found/i);
  });
});

describe('SessionExercise — logging a set', () => {
  it('tapping ✓ logs the set as done, greys the row, and starts the rest timer', async () => {
    const user = userEvent.setup();
    await seedCache([makeSlot({ sets: 1, load_kg: 20, reps: 12 })]);
    renderExercise();

    await user.click(await screen.findByRole('button', { name: 'Log set 1' }));

    await waitFor(() => expect(screen.getByText('done')).toBeInTheDocument());
    expect(await screen.findByText(/Rest: \d:\d\d/)).toBeInTheDocument();

    const stored = await db.loggedSets.toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ session_id: 42, slot_id: 100, exercise_id: 10, set_index: 1, load_kg: 20, reps: 12, status: 'done' });
  });

  it('swiping a row left skips it, storing no load/reps', async () => {
    await seedCache([makeSlot({ sets: 1, load_kg: 20, reps: 12 })]);
    renderExercise();

    const row = await screen.findByTestId('set-row-0');
    fireEvent.pointerDown(row, { clientX: 200 });
    fireEvent.pointerUp(row, { clientX: 100 });

    await waitFor(() => expect(screen.getByText('skipped')).toBeInTheDocument());
    const stored = await db.loggedSets.toArray();
    expect(stored[0]).toMatchObject({ status: 'skipped', load_kg: null, reps: null });
  });

  it('reconstructs already-logged rows from Dexie on remount, not just React state', async () => {
    await seedCache([makeSlot({ sets: 2, load_kg: 20, reps: 12 })]);
    const { unmount } = renderExercise();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Log set 1' }));
    await waitFor(() => expect(screen.getByText('done')).toBeInTheDocument());
    unmount();

    renderExercise();
    expect(await screen.findByText('done')).toBeInTheDocument();
  });
});

describe('SessionExercise — navigation', () => {
  it('Skip logs all pending sets as skipped and advances to the next exercise in list order', async () => {
    const user = userEvent.setup();
    await seedCache([
      makeSlot({ id: 100, exercise: { id: 10, slug: 'a', name: 'Exercise A', unilateral: false, increment_kg: 2.5 }, sets: 2 }),
      makeSlot({ id: 101, exercise: { id: 11, slug: 'b', name: 'Exercise B', unilateral: false, increment_kg: 2.5 }, sets: 1, position: 2 }),
    ]);
    renderExercise();
    await screen.findByTestId('set-row-1');

    await user.click(screen.getByRole('button', { name: 'Skip' }));

    await screen.findByText('Exercise B');
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
    const stored = await db.loggedSets.where({ exercise_id: 10 }).toArray();
    expect(stored).toHaveLength(2);
    expect(stored.every((s) => s.status === 'skipped')).toBe(true);
  });

  it('Next on a non-last exercise moves to the next one', async () => {
    const user = userEvent.setup();
    await seedCache([
      makeSlot({ id: 100, exercise: { id: 10, slug: 'a', name: 'Exercise A', unilateral: false, increment_kg: 2.5 }, sets: 1 }),
      makeSlot({ id: 101, exercise: { id: 11, slug: 'b', name: 'Exercise B', unilateral: false, increment_kg: 2.5 }, sets: 1, position: 2 }),
    ]);
    renderExercise();
    await screen.findByTestId('set-row-0');

    await user.click(screen.getByRole('button', { name: 'Next →' }));

    await screen.findByText('Exercise B');
  });

  it('on the last exercise the advance button reads "← List" and returns to the exercise list, not the summary', async () => {
    const user = userEvent.setup();
    await seedCache([makeSlot({ sets: 1 })]);
    renderExercise();
    await screen.findByTestId('set-row-0');

    const button = screen.getByRole('button', { name: '← List' });
    await user.click(button);

    await screen.findByText('Exercise list screen');
  });
});
