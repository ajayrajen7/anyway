import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../lib/db';
import type { CachedToday, TodaySlot } from '../lib/types';
import SessionOverview from './SessionOverview';

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
});
