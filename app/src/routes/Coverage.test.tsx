// Component-level coverage for Coverage.tsx — previously untested (the
// underlying computation lives in src/lib/week.test.ts; this file checks
// the screen actually wires that data through and renders it). Seeds Dexie
// directly, same pattern as SessionFlows.test.tsx — no network involved,
// this screen is fully offline (§B2).
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import Coverage from './Coverage';
import { db } from '../lib/db';
import { localDateKey } from '../lib/date';
import { weekBoundsFor } from '../lib/week';
import type { Exercise, LoggedSet, ProgrammeResponse } from '../lib/types';

function fullExercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 1, slug: 'goblet-squat', name: 'Goblet squat', equipment: 'dumbbell', pressure: 'moderate', impact: 'none',
    unilateral: false, increment_kg: 2.5, blocked: false, block_reason: null, caution: null,
    muscles: { quads: 1.0, glutes: 0.5 },
    ...overrides,
  };
}

function loggedSet(overrides: Partial<LoggedSet> = {}): LoggedSet {
  return {
    client_uuid: crypto.randomUUID(), session_id: 42, slot_id: 1, exercise_id: 1,
    set_index: 1, load_kg: 20, reps: 12, status: 'done', provenance: 'prescribed',
    added_by: null, logged_at: new Date().toISOString(),
    ...overrides,
  };
}

function renderCoverage() {
  return render(
    <MemoryRouter>
      <Coverage />
    </MemoryRouter>,
  );
}

afterEach(async () => {
  await db.programmeCache.clear();
  await db.exercises.clear();
  await db.loggedSets.clear();
  await db.todayCache.clear();
  await db.morningChecks.clear();
});

describe('Coverage screen', () => {
  it('shows a message when nothing has been cached yet', async () => {
    renderCoverage();
    await screen.findByText(/open today with a connection first/i);
  });

  it('renders prescribed vs. actual coverage, total volume, and the pain strip once cached data exists', async () => {
    const monday = weekBoundsFor(localDateKey()).start;

    const programme: ProgrammeResponse = {
      phase: { id: 1, name: 'Phase 1', start_week: 1, end_week: 6 },
      day_templates: [
        { id: 1, weekday: 1, name: 'Lower A', kind: 'lifting', slots: [{ id: 1, exercise_id: 1, sets: 3, reps: 12, load_kg: 20 }] },
      ],
    };
    await db.programmeCache.put({ id: 1, cachedAt: new Date().toISOString(), data: programme });
    await db.exercises.put(fullExercise());
    await db.todayCache.put({
      sessionId: 42,
      date: monday,
      cachedAt: new Date().toISOString(),
      data: {
        date: monday, weekday: 1,
        day_template: { id: 1, name: 'Lower A', kind: 'lifting' },
        session: { id: 42, status: 'completed', started_at: null, ended_at: null, note: null },
        slots: [],
      },
    });
    await db.loggedSets.bulkPut([loggedSet({ client_uuid: 'a', set_index: 1 }), loggedSet({ client_uuid: 'b', set_index: 2 })]);
    await db.morningChecks.put({ date: monday, pain: 'none' });

    renderCoverage();

    expect(await screen.findByText('Quads')).toBeInTheDocument();
    // 2 done sets × 1.0 quads weight = 2, prescribed 3 sets × 1.0 = 3.
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    expect(screen.getByText(/Total volume/)).toBeInTheDocument();
    expect(screen.getByText(/480 kg/)).toBeInTheDocument(); // 2 done sets × 20kg × 12 reps (see computeSessionTotals)
    expect(screen.getByRole('img', { name: /pain check-ins/i })).toBeInTheDocument();
  });

  it('navigates to the previous week and back', async () => {
    const user = userEvent.setup();
    const programme: ProgrammeResponse = { phase: { id: 1, name: 'Phase 1', start_week: 1, end_week: 6 }, day_templates: [] };
    await db.programmeCache.put({ id: 1, cachedAt: new Date().toISOString(), data: programme });
    renderCoverage();

    await screen.findByText('This Week');
    expect(screen.getByRole('button', { name: 'Next week' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(screen.queryByText('This Week')).not.toBeInTheDocument();
    // The week nav remounts CoverageBody (keyed by bounds.start), which
    // starts back at 'loading' — wait for it to resolve before clicking
    // again, or the button isn't there yet to click.
    const nextButton = await screen.findByRole('button', { name: 'Next week' });

    await user.click(nextButton);
    await screen.findByText('This Week');
  });
});
