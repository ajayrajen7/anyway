// Integration tests for the M5 swap/add-exercise flows — these need the
// real nested routing (SwapSheet/AddExercise render via SessionRunner's
// <Outlet/>, reading it via useOutletContext), so they render the same
// route tree App.tsx does rather than SwapSheet/AddExercise in isolation.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import AddExercise from './AddExercise';
import { db } from '../lib/db';
import SessionRunner from './SessionRunner';
import SwapSheet from './SwapSheet';
import type { CachedToday, Exercise, TodaySlot } from '../lib/types';

function makeSlot(overrides: Partial<TodaySlot> = {}): TodaySlot {
  return {
    id: 100,
    position: 1,
    exercise: { id: 10, slug: 'leg-press', name: 'Leg press', unilateral: false, increment_kg: 5 },
    sets: 1,
    reps: 12,
    load_kg: 20,
    note: null,
    swaps: [{ id: 20, slug: 'leg-press-sl', name: 'Single-leg leg press', unilateral: true, increment_kg: 5 }],
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

function fullExercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 1,
    slug: 'x',
    name: 'X',
    equipment: 'dumbbell',
    pressure: 'low',
    impact: 'none',
    unilateral: false,
    increment_kg: 2.5,
    blocked: false,
    block_reason: null,
    caution: null,
    muscles: {},
    ...overrides,
  };
}

function renderRunner(sessionId = 42) {
  return render(
    <MemoryRouter initialEntries={[`/session/${sessionId}`]}>
      <Routes>
        <Route path="/session/:id" element={<SessionRunner />}>
          <Route path="swap/:slotId" element={<SwapSheet />} />
          <Route path="add" element={<AddExercise />} />
        </Route>
        <Route path="/session/:id/done" element={<div>Session summary screen</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(async () => {
  await db.todayCache.clear();
  await db.loggedSets.clear();
  await db.outbox.clear();
  await db.sessionOverlay.clear();
  await db.exercises.clear();
});

describe('Swap flow', () => {
  it('picking a tier-1 option replaces the active exercise, and the next logged set uses provenance=swap_in_list', async () => {
    const user = userEvent.setup();
    await seedCache([makeSlot()]);
    renderRunner();

    await user.click(await screen.findByRole('link', { name: 'Swap' }));
    await screen.findByText(/Instead of LEG PRESS/i);
    await user.click(screen.getByRole('button', { name: 'Single-leg leg press' }));

    // Back on the runner, showing the swapped-in exercise.
    await screen.findByText('Single-leg leg press');
    await user.click(await screen.findByRole('button', { name: 'Log set 1' }));

    const stored = await db.loggedSets.toArray();
    expect(stored[0]).toMatchObject({ exercise_id: 20, provenance: 'swap_in_list', slot_id: 100 });
  });

  it('picking a tier-2 search result uses provenance=swap_off_list', async () => {
    const user = userEvent.setup();
    await seedCache([makeSlot()]);
    await db.exercises.bulkPut([fullExercise({ id: 30, name: 'Goblet squat' })]);
    renderRunner();

    await user.click(await screen.findByRole('link', { name: 'Swap' }));
    await user.type(await screen.findByLabelText('Search exercises'), 'goblet');
    await user.click(await screen.findByRole('button', { name: 'Goblet squat' }));

    await screen.findByText('Goblet squat');
    await user.click(await screen.findByRole('button', { name: 'Log set 1' }));

    const stored = await db.loggedSets.toArray();
    expect(stored[0]).toMatchObject({ exercise_id: 30, provenance: 'swap_off_list' });
  });

  it('shows a blocked search match greyed with its reason, not as a selectable button', async () => {
    const user = userEvent.setup();
    await seedCache([makeSlot()]);
    await db.exercises.bulkPut([fullExercise({ id: 40, name: 'Running', blocked: true, block_reason: 'Impact — knee and Achilles' })]);
    renderRunner();

    await user.click(await screen.findByRole('link', { name: 'Swap' }));
    await user.type(await screen.findByLabelText('Search exercises'), 'run');

    await screen.findByText(/Impact — knee and Achilles/);
    expect(screen.queryByRole('button', { name: 'Running' })).not.toBeInTheDocument();
  });
});

describe('Add-exercise flow', () => {
  it('is not added until an attribution is chosen, then records provenance=added with added_by set', async () => {
    const user = userEvent.setup();
    await seedCache([makeSlot()]);
    await db.exercises.bulkPut([fullExercise({ id: 50, name: 'Dumbbell curl' })]);
    renderRunner();

    await user.click(await screen.findByRole('link', { name: 'Add exercise' }));
    await user.type(await screen.findByLabelText('Search exercises'), 'curl');
    await user.click(await screen.findByRole('button', { name: 'Dumbbell curl' }));

    // Mandatory attribution step — not added yet.
    await screen.findByText('Whose call?');
    expect(await db.sessionOverlay.get(42)).toBeUndefined();

    await user.click(screen.getByRole('button', { name: 'Trainer' }));

    await waitFor(async () => {
      const overlay = await db.sessionOverlay.get(42);
      expect(overlay?.added).toHaveLength(1);
    });

    // The runner now shows 2 exercises, and moving to the added one logs
    // with the right provenance/attribution.
    await screen.findByText('Exercise 1 of 2');
    await user.click(screen.getByRole('button', { name: 'Next →' }));
    await screen.findByText('Dumbbell curl');
    await user.click(await screen.findByRole('button', { name: 'Log set 1' }));

    const stored = await db.loggedSets.where({ exercise_id: 50 }).toArray();
    expect(stored[0]).toMatchObject({ provenance: 'added', added_by: 'trainer', slot_id: null });
  });

  it('backing out of the attribution step returns to search without adding anything', async () => {
    const user = userEvent.setup();
    await seedCache([makeSlot()]);
    await db.exercises.bulkPut([fullExercise({ id: 50, name: 'Dumbbell curl' })]);
    renderRunner();

    await user.click(await screen.findByRole('link', { name: 'Add exercise' }));
    await user.type(await screen.findByLabelText('Search exercises'), 'curl');
    await user.click(await screen.findByRole('button', { name: 'Dumbbell curl' }));
    await screen.findByText('Whose call?');

    await user.click(screen.getByText('← back to search'));

    await screen.findByLabelText('Search exercises');
    expect(await db.sessionOverlay.get(42)).toBeUndefined();
  });
});
