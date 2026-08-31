// Component-level coverage for WeekPlan.tsx — previously untested (the
// underlying grading logic lives in src/lib/week.test.ts; this file checks
// the screen wires that data through and renders it). Seeds Dexie directly,
// same pattern as Coverage.test.tsx/SessionFlows.test.tsx.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import WeekPlan from './WeekPlan';
import { db } from '../lib/db';
import { localDateKey } from '../lib/date';
import { weekBoundsFor } from '../lib/week';
import type { ProgrammeResponse } from '../lib/types';

function renderWeekPlan() {
  return render(
    <MemoryRouter>
      <WeekPlan />
    </MemoryRouter>,
  );
}

afterEach(async () => {
  await db.programmeCache.clear();
  await db.todayCache.clear();
  await db.outbox.clear();
  await db.proteinLogs.clear();
  await db.stepsLogs.clear();
  await db.cardioLogs.clear();
  await db.mobilityLogs.clear();
});

describe('Week Plan screen', () => {
  it('shows a message when nothing has been cached yet', async () => {
    renderWeekPlan();
    await screen.findByText(/open today with a connection first/i);
  });

  it('renders Monday through Saturday with a done-count, and a link to Coverage', async () => {
    const programme: ProgrammeResponse = {
      phase: { id: 1, name: 'Phase 1', start_week: 1, end_week: 6 },
      day_templates: [{ id: 1, weekday: 1, name: 'Lower A', kind: 'lifting', slots: [] }],
    };
    await db.programmeCache.put({ id: 1, cachedAt: new Date().toISOString(), data: programme });

    renderWeekPlan();

    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) {
      expect(await screen.findByText(day)).toBeInTheDocument();
    }
    expect(screen.queryByText('Sunday')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View coverage →' })).toHaveAttribute('href', '/coverage');
  });

  it('grades a fully-done lifting day 3 of 3 (session complete, protein hit, steps logged)', async () => {
    const monday = weekBoundsFor(localDateKey()).start;
    const programme: ProgrammeResponse = {
      phase: { id: 1, name: 'Phase 1', start_week: 1, end_week: 6 },
      day_templates: [{ id: 1, weekday: 1, name: 'Lower A', kind: 'lifting', slots: [] }],
    };
    await db.programmeCache.put({ id: 1, cachedAt: new Date().toISOString(), data: programme });
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
    await db.outbox.put({ entity: 'session_complete', entity_id: '42', payload: '{}', created_at: new Date().toISOString(), synced_at: null });
    await db.proteinLogs.put({ date: monday, hit: true });
    await db.stepsLogs.put({ date: monday, steps: 4000 });

    renderWeekPlan();

    await screen.findByText('Monday');
    expect(screen.getByText('3 of 3')).toBeInTheDocument();
  });

  it('links a lifting day to its exercise list once that day has been opened as Today, and leaves other days as plain rows', async () => {
    const monday = weekBoundsFor(localDateKey()).start;
    const programme: ProgrammeResponse = {
      phase: { id: 1, name: 'Phase 1', start_week: 1, end_week: 6 },
      day_templates: [
        { id: 1, weekday: 1, name: 'Lower A', kind: 'lifting', slots: [] },
        { id: 2, weekday: 3, name: 'Mobility + Zone 2', kind: 'cardio_mobility', slots: [] },
      ],
    };
    await db.programmeCache.put({ id: 1, cachedAt: new Date().toISOString(), data: programme });
    await db.todayCache.put({
      sessionId: 42,
      date: monday,
      cachedAt: new Date().toISOString(),
      data: {
        date: monday, weekday: 1,
        day_template: { id: 1, name: 'Lower A', kind: 'lifting' },
        session: { id: 42, status: 'planned', started_at: null, ended_at: null, note: null },
        slots: [],
      },
    });

    renderWeekPlan();

    const mondayLink = await screen.findByRole('link', { name: /Monday/ });
    expect(mondayLink).toHaveAttribute('href', '/session/42');
    // Wednesday is cardio_mobility (no exercise-list screen at all) and
    // Tuesday is a lifting day that hasn't been opened yet (no session
    // cached) — neither should be a link.
    expect(screen.getByText('Tuesday').closest('a')).toBeNull();
    expect(screen.getByText('Wednesday').closest('a')).toBeNull();
  });

  it('navigates to the previous week and back', async () => {
    const user = userEvent.setup();
    const programme: ProgrammeResponse = { phase: { id: 1, name: 'Phase 1', start_week: 1, end_week: 6 }, day_templates: [] };
    await db.programmeCache.put({ id: 1, cachedAt: new Date().toISOString(), data: programme });
    renderWeekPlan();

    await screen.findByText('This Week');
    expect(screen.getByRole('button', { name: 'Next week' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(screen.queryByText('This Week')).not.toBeInTheDocument();
    // The week nav remounts WeekPlanBody (keyed by bounds.start), which
    // starts back at 'loading' — wait for it to resolve before clicking
    // again, or the button isn't there yet to click.
    const nextButton = await screen.findByRole('button', { name: 'Next week' });

    await user.click(nextButton);
    await screen.findByText('This Week');
  });
});
