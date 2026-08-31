// Integration tests for the swap/add-exercise flows against the UX
// refactor's route tree — Add nests under SessionOverview (the list),
// Swap nests under SessionExercise (the single-exercise screen), each
// reading their outlet context via useOutletContext. See App.tsx.
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AddExercise from './AddExercise';
import { ApiError } from '../lib/api';
import { db } from '../lib/db';
import SessionExercise from './SessionExercise';
import SessionOverview from './SessionOverview';
import SwapSheet from './SwapSheet';
import type { CachedToday, Exercise, TodaySlot } from '../lib/types';

const { generateExerciseMock } = vi.hoisted(() => ({ generateExerciseMock: vi.fn() }));
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return { ...actual, generateExercise: generateExerciseMock };
});

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
    id: 1, slug: 'x', name: 'X', equipment: 'dumbbell', pressure: 'low', impact: 'none',
    unilateral: false, increment_kg: 2.5, blocked: false, block_reason: null, caution: null,
    muscles: {},
    ...overrides,
  };
}

function renderApp(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/session/:id" element={<SessionOverview />}>
          <Route path="add" element={<AddExercise />} />
        </Route>
        <Route path="/session/:id/exercise/:key" element={<SessionExercise />}>
          <Route path="swap/:slotId" element={<SwapSheet />} />
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
  generateExerciseMock.mockReset();
  Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
});

describe('Swap flow (from the single-exercise screen)', () => {
  it('picking a tier-1 option replaces the active exercise, and the next logged set uses provenance=swap_in_list', async () => {
    const user = userEvent.setup();
    await seedCache([makeSlot()]);
    renderApp('/session/42/exercise/slot-100');

    await user.click(await screen.findByRole('link', { name: 'Swap' }));
    await screen.findByText(/Instead of LEG PRESS/i);
    await user.click(screen.getByRole('button', { name: 'Single-leg leg press' }));

    await screen.findByText('Single-leg leg press');
    await user.click(await screen.findByRole('button', { name: 'Log set 1' }));

    const stored = await db.loggedSets.toArray();
    expect(stored[0]).toMatchObject({ exercise_id: 20, provenance: 'swap_in_list', slot_id: 100 });
  });

  it('picking a tier-2 search result uses provenance=swap_off_list', async () => {
    const user = userEvent.setup();
    await seedCache([makeSlot()]);
    await db.exercises.bulkPut([fullExercise({ id: 30, name: 'Goblet squat' })]);
    renderApp('/session/42/exercise/slot-100');

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
    renderApp('/session/42/exercise/slot-100');

    await user.click(await screen.findByRole('link', { name: 'Swap' }));
    await user.type(await screen.findByLabelText('Search exercises'), 'run');

    await screen.findByText(/Impact — knee and Achilles/);
    expect(screen.queryByRole('button', { name: 'Running' })).not.toBeInTheDocument();
  });

  it('swap is also reachable directly from the exercise list, landing on the exercise with the sheet open', async () => {
    const user = userEvent.setup();
    await seedCache([makeSlot()]);
    renderApp('/session/42');

    await user.click(await screen.findByRole('button', { name: 'Swap Leg press' }));

    await screen.findByText(/Instead of LEG PRESS/i);
  });
});

describe('Add-exercise flow (from the exercise list)', () => {
  it('is not added until an attribution is chosen, then records provenance=added with added_by set', async () => {
    const user = userEvent.setup();
    await seedCache([makeSlot()]);
    await db.exercises.bulkPut([fullExercise({ id: 50, name: 'Dumbbell curl' })]);
    renderApp('/session/42');

    await user.click(await screen.findByRole('link', { name: '+ Add exercise' }));
    await user.type(await screen.findByLabelText('Search exercises'), 'curl');
    await user.click(await screen.findByRole('button', { name: 'Dumbbell curl' }));

    await screen.findByText('Whose call?');
    expect(await db.sessionOverlay.get(42)).toBeUndefined();

    await user.click(screen.getByRole('button', { name: 'Trainer' }));

    await waitFor(async () => {
      const overlay = await db.sessionOverlay.get(42);
      expect(overlay?.added).toHaveLength(1);
    });

    // Back on the list, now showing 2 exercises including the added one.
    await screen.findByText('2 exercises');
    await user.click(screen.getByText('Dumbbell curl'));
    await user.click(await screen.findByRole('button', { name: 'Log set 1' }));

    const stored = await db.loggedSets.where({ exercise_id: 50 }).toArray();
    expect(stored[0]).toMatchObject({ provenance: 'added', added_by: 'trainer', slot_id: null });
  });

  it('backing out of the attribution step returns to search without adding anything', async () => {
    const user = userEvent.setup();
    await seedCache([makeSlot()]);
    await db.exercises.bulkPut([fullExercise({ id: 50, name: 'Dumbbell curl' })]);
    renderApp('/session/42');

    await user.click(await screen.findByRole('link', { name: '+ Add exercise' }));
    await user.type(await screen.findByLabelText('Search exercises'), 'curl');
    await user.click(await screen.findByRole('button', { name: 'Dumbbell curl' }));
    await screen.findByText('Whose call?');

    await user.click(screen.getByText('← back to search'));

    await screen.findByLabelText('Search exercises');
    expect(await db.sessionOverlay.get(42)).toBeUndefined();
  });
});

describe('Create-exercise flow (from Add-exercise\'s search sheet)', () => {
  it('generates, caches, and flows straight into attribution when not blocked', async () => {
    const user = userEvent.setup();
    await seedCache([makeSlot()]);
    generateExerciseMock.mockResolvedValue(
      fullExercise({ id: 99, name: 'Cable face pull', source: 'llm', muscles: { delts_rear: 1.0 }, caution: 'Keep elbows high.' }),
    );
    renderApp('/session/42');

    await user.click(await screen.findByRole('link', { name: '+ Add exercise' }));
    await user.type(await screen.findByLabelText('Search exercises'), 'face pull');
    await user.click(await screen.findByRole('button', { name: /Create "face pull"/ }));

    await screen.findByText('Whose call?');
    expect(await screen.findByText(/AI-estimated/)).toBeInTheDocument();
    expect(screen.getByText(/Keep elbows high\./)).toBeInTheDocument();
    expect(generateExerciseMock).toHaveBeenCalledWith('face pull');

    // Actually cached — the next search should find it with no further mock call.
    const cached = await db.exercises.get(99);
    expect(cached?.name).toBe('Cable face pull');

    await user.click(screen.getByRole('button', { name: 'Mine' }));
    await waitFor(async () => {
      const overlay = await db.sessionOverlay.get(42);
      expect(overlay?.added).toHaveLength(1);
    });
  });

  it('shows a blocked LLM result greyed with its reason, never reaching attribution', async () => {
    const user = userEvent.setup();
    await seedCache([makeSlot()]);
    generateExerciseMock.mockResolvedValue(
      fullExercise({ id: 98, name: 'Kettlebell swing', source: 'llm', blocked: true, block_reason: 'Braced hinge — high intra-abdominal pressure' }),
    );
    renderApp('/session/42');

    await user.click(await screen.findByRole('link', { name: '+ Add exercise' }));
    await user.type(await screen.findByLabelText('Search exercises'), 'kettlebell swing');
    await user.click(await screen.findByRole('button', { name: /Create "kettlebell swing"/ }));

    await screen.findByText(/Braced hinge — high intra-abdominal pressure/);
    expect(screen.queryByText('Whose call?')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Kettlebell swing' })).not.toBeInTheDocument();
  });

  it('shows a clear error and never adds anything when generation fails', async () => {
    const user = userEvent.setup();
    await seedCache([makeSlot()]);
    generateExerciseMock.mockRejectedValue(new ApiError(502, 'model produced an invalid exercise'));
    renderApp('/session/42');

    await user.click(await screen.findByRole('link', { name: '+ Add exercise' }));
    await user.type(await screen.findByLabelText('Search exercises'), 'something odd');
    await user.click(await screen.findByRole('button', { name: /Create "something odd"/ }));

    await screen.findByText(/Couldn't create that exercise/);
    expect(await db.exercises.toArray()).toHaveLength(0);
  });

  it('offers no create action while offline', async () => {
    const user = userEvent.setup();
    await seedCache([makeSlot()]);
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    renderApp('/session/42');

    await user.click(await screen.findByRole('link', { name: '+ Add exercise' }));
    await user.type(await screen.findByLabelText('Search exercises'), 'face pull');

    await screen.findByText(/needs a connection/);
    expect(screen.queryByRole('button', { name: /Create/ })).not.toBeInTheDocument();
  });
});

describe('Delete flow (from the exercise list)', () => {
  it('a deleted exercise never appears again, even after navigating away and back', async () => {
    const user = userEvent.setup();
    await seedCache([
      makeSlot({ id: 100, exercise: { id: 10, slug: 'a', name: 'Exercise A', unilateral: false, increment_kg: 2.5 } }),
      makeSlot({ id: 101, exercise: { id: 11, slug: 'b', name: 'Exercise B', unilateral: false, increment_kg: 2.5 }, position: 2 }),
    ]);
    renderApp('/session/42');
    await screen.findByText('Exercise A');

    await user.click(screen.getByRole('button', { name: 'Delete Exercise A' }));
    await waitFor(() => expect(screen.queryByText('Exercise A')).not.toBeInTheDocument());

    const overlay = await db.sessionOverlay.get(42);
    expect(overlay?.removed).toEqual(['slot-100']);
  });
});
