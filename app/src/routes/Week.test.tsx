import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../lib/db';
import { logSet } from '../lib/outbox';
import type { CachedToday, Exercise, ProgrammeResponse } from '../lib/types';
import Week from './Week';

function exercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 10, slug: 'leg-press', name: 'Leg press', equipment: 'machine', pressure: 'high', impact: 'none',
    unilateral: false, increment_kg: 5, blocked: false, block_reason: null, caution: null,
    muscles: { quads: 1.0, glutes: 0.5 },
    ...overrides,
  };
}

const programme: ProgrammeResponse = {
  phase: { id: 1, name: 'Phase 1', start_week: 1, end_week: 6 },
  day_templates: [
    { id: 1, weekday: 1, name: 'Lower A', kind: 'lifting', slots: [{ id: 100, exercise_id: 10, sets: 3, reps: 12, load_kg: 20 }] },
    { id: 2, weekday: 3, name: 'Mobility', kind: 'cardio_mobility', slots: [] },
  ],
};

afterEach(async () => {
  await db.programmeCache.clear();
  await db.exercises.clear();
  await db.loggedSets.clear();
  await db.outbox.clear();
  await db.todayCache.clear();
  await db.morningChecks.clear();
});

describe('Week', () => {
  it('shows a message when the programme has never been cached (never opened Today online)', async () => {
    render(<Week />);
    expect(await screen.findByText(/open today with a connection/i)).toBeInTheDocument();
  });

  it('renders prescribed coverage even with nothing logged yet', async () => {
    await db.programmeCache.put({ id: 1, cachedAt: 'x', data: programme });
    await db.exercises.put(exercise());

    render(<Week />);

    expect(await screen.findByText('Quads')).toBeInTheDocument();
    expect(screen.getByText('0 / 3')).toBeInTheDocument(); // 3 sets prescribed, 0 done
    expect(screen.getByText('Total volume')).toBeInTheDocument();
    expect(screen.getByText('0 kg', { exact: false })).toBeInTheDocument();
  });

  it('combines cached prescribed coverage with actual logged sets from this week, using the session\'s own date', async () => {
    await db.programmeCache.put({ id: 1, cachedAt: 'x', data: programme });
    await db.exercises.put(exercise());

    const sessionId = 555;
    const cached: CachedToday['data'] = {
      date: '2026-01-05', // a Monday — set below during test setup mocks "today" to this week via real Date, so use today's own week
      weekday: 1,
      day_template: { id: 1, name: 'Lower A', kind: 'lifting' },
      session: { id: sessionId, status: 'planned', started_at: null, ended_at: null, note: null },
      slots: [],
    };
    const todayKey = new Date().toISOString().slice(0, 10);
    await db.todayCache.put({ sessionId, date: todayKey, cachedAt: 'x', data: { ...cached, date: todayKey } });

    await logSet({ sessionId, slotId: 100, exerciseId: 10, setIndex: 1, loadKg: 20, reps: 12, status: 'done' });
    await logSet({ sessionId, slotId: 100, exerciseId: 10, setIndex: 2, loadKg: 20, reps: 12, status: 'done' });

    render(<Week />);

    expect(await screen.findByText('2 / 3')).toBeInTheDocument(); // 2 done sets vs. 3 prescribed
    expect(screen.getByText(/480/)).toBeInTheDocument(); // 20*12*2 = 480 kg total volume
  });

  it('renders a pain dot for a logged morning check and a hollow one for an unlogged day', async () => {
    await db.programmeCache.put({ id: 1, cachedAt: 'x', data: { phase: programme.phase, day_templates: [] } });
    const todayKey = new Date().toISOString().slice(0, 10);
    await db.morningChecks.put({ date: todayKey, pain: 'background' });

    render(<Week />);

    await screen.findByText('Mornings');
    const dots = screen.getByRole('img', { name: /morning pain check-ins/i });
    expect(dots.textContent).toContain('●');
    expect(dots.textContent).toContain('○');
  });
});
