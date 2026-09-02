// Component-level coverage for DayPreview.tsx — a read-only look at a
// day's prescription, reached from Week Plan for a day without a session
// yet. Fully offline: seeds Dexie directly, same pattern as
// Coverage.test.tsx/WeekPlan.test.tsx.
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import DayPreview from './DayPreview';
import { db } from '../lib/db';
import type { Exercise, ProgrammeResponse } from '../lib/types';

function fullExercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 1, slug: 'goblet-squat', name: 'Goblet squat', equipment: 'dumbbell', pressure: 'moderate', impact: 'none',
    unilateral: false, increment_kg: 2.5, blocked: false, block_reason: null, caution: null, muscles: { quads: 1.0 },
    ...overrides,
  };
}

function renderPreview(date: string) {
  return render(
    <MemoryRouter initialEntries={[`/day/${date}`]}>
      <Routes>
        <Route path="/day/:date" element={<DayPreview />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(async () => {
  await db.programmeCache.clear();
  await db.exercises.clear();
  await db.daySwaps.clear();
});

describe('DayPreview', () => {
  it('shows a message when nothing has been cached yet', async () => {
    renderPreview('2026-01-05');
    await screen.findByText(/open today with a connection first/i);
  });

  it('lists a lifting day\'s prescribed exercises, resolved by name from the exercise cache', async () => {
    const programme: ProgrammeResponse = {
      phase: { id: 1, name: 'Phase 1', start_week: 1, end_week: 6 },
      day_templates: [
        {
          id: 1, weekday: 4, name: 'Lower B', kind: 'lifting', // 2026-01-08 is a Thursday
          slots: [{ id: 1, exercise_id: 1, sets: 3, reps: 12, load_kg: 20 }],
        },
      ],
    };
    await db.programmeCache.put({ id: 1, cachedAt: new Date().toISOString(), data: programme });
    await db.exercises.put(fullExercise());

    renderPreview('2026-01-08');

    await screen.findByRole('heading', { name: 'Thursday' });
    expect(screen.getByText('Preview')).toBeInTheDocument();
    expect(await screen.findByText('Goblet squat')).toBeInTheDocument();
    expect(screen.getByText('3 × 12 @ 20 kg')).toBeInTheDocument();
  });

  it('shows the cardio + mobility prescription for a cardio_mobility day, with no exercise list', async () => {
    const programme: ProgrammeResponse = {
      phase: { id: 1, name: 'Phase 1', start_week: 1, end_week: 6 },
      day_templates: [{ id: 2, weekday: 3, name: 'Mobility + Zone 2', kind: 'cardio_mobility', slots: [] }], // 2026-01-07 is a Wednesday
    };
    await db.programmeCache.put({ id: 1, cachedAt: new Date().toISOString(), data: programme });

    renderPreview('2026-01-07');

    await screen.findByRole('heading', { name: 'Wednesday' });
    expect(await screen.findByText(/Cross trainer/)).toBeInTheDocument();
    expect(screen.getByText(/Full mobility/)).toBeInTheDocument();
  });

  it('shows the rest-day message with no prescription', async () => {
    const programme: ProgrammeResponse = {
      phase: { id: 1, name: 'Phase 1', start_week: 1, end_week: 6 },
      day_templates: [], // no template for Sunday -> falls back to 'rest'
    };
    await db.programmeCache.put({ id: 1, cachedAt: new Date().toISOString(), data: programme });

    renderPreview('2026-01-11'); // a Sunday

    await screen.findByRole('heading', { name: 'Sunday' });
    expect(await screen.findByText(/flat walk only/i)).toBeInTheDocument();
  });

  // Post-M12 UX addition (feature 2): honors a locally-cached day swap
  // offline, same as the real GET /api/today would resolve server-side.
  it("shows the swap partner's content, keeping the real calendar weekday as the header", async () => {
    const programme: ProgrammeResponse = {
      phase: { id: 1, name: 'Phase 1', start_week: 1, end_week: 6 },
      day_templates: [
        { id: 1, weekday: 4, name: 'Lower B', kind: 'lifting', slots: [{ id: 1, exercise_id: 1, sets: 3, reps: 12, load_kg: 20 }] }, // Thursday
        { id: 2, weekday: 3, name: 'Mobility + Zone 2', kind: 'cardio_mobility', slots: [] }, // Wednesday
      ],
    };
    await db.programmeCache.put({ id: 1, cachedAt: new Date().toISOString(), data: programme });
    await db.exercises.put(fullExercise());
    // 2026-01-07 (Wed) swapped with 2026-01-08 (Thu) — the preview for
    // Wednesday must show Thursday's lifting content.
    await db.daySwaps.put({ date: '2026-01-07', swapped_with: '2026-01-08' });

    renderPreview('2026-01-07');

    await screen.findByRole('heading', { name: 'Wednesday' }); // header stays the real calendar day
    expect(await screen.findByText('Goblet squat')).toBeInTheDocument(); // but shows Thursday's content
  });
});
