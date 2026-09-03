// Component-level coverage for WeekPlan.tsx — previously untested (the
// underlying grading logic lives in src/lib/week.test.ts; this file checks
// the screen wires that data through and renders it). Seeds Dexie directly,
// same pattern as Coverage.test.tsx/SessionFlows.test.tsx.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WeekPlan from './WeekPlan';
import { db } from '../lib/db';
import { localDateKey, parseDateKey } from '../lib/date';
import { weekBoundsFor } from '../lib/week';
import type { ProgrammeResponse } from '../lib/types';

const { swapDaysMock, unswapDayMock, getDaySwapsMock } = vi.hoisted(() => ({
  swapDaysMock: vi.fn(),
  unswapDayMock: vi.fn(),
  getDaySwapsMock: vi.fn().mockResolvedValue([]),
}));
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return { ...actual, swapDays: swapDaysMock, unswapDay: unswapDayMock, getDaySwaps: getDaySwapsMock };
});

function renderWeekPlan() {
  return render(
    <MemoryRouter>
      <WeekPlan />
    </MemoryRouter>,
  );
}

afterEach(async () => {
  swapDaysMock.mockReset();
  unswapDayMock.mockReset();
  getDaySwapsMock.mockReset().mockResolvedValue([]);
  await db.programmeCache.clear();
  await db.todayCache.clear();
  await db.outbox.clear();
  await db.proteinLogs.clear();
  await db.stepsLogs.clear();
  await db.cardioLogs.clear();
  await db.mobilityLogs.clear();
  await db.daySkips.clear();
  await db.daySwaps.clear();
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

  it('grades protein as done from any logged gram value, even well under the 120g target', async () => {
    // Owner-confirmed change: a day with 50g logged still counts — the
    // 120g figure is a derived fact on the log row (`hit: false` here), not
    // a gate on day completion anywhere. See week.ts's `proteinLogged` note.
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
    await db.proteinLogs.put({ date: monday, grams: 50, hit: false });
    await db.stepsLogs.put({ date: monday, steps: 9000 });

    renderWeekPlan();

    await screen.findByText('Monday');
    expect(screen.getByText('3 of 3')).toBeInTheDocument();
  });

  it('links a lifting day to its session once opened as Today, and every other day to a read-only preview', async () => {
    const monday = weekBoundsFor(localDateKey()).start;
    const mondayDate = parseDateKey(monday);
    const tuesday = localDateKey(new Date(mondayDate.getFullYear(), mondayDate.getMonth(), mondayDate.getDate() + 1));
    const wednesday = localDateKey(new Date(mondayDate.getFullYear(), mondayDate.getMonth(), mondayDate.getDate() + 2));
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
    // Tuesday (lifting, not yet opened) and Wednesday (cardio_mobility,
    // no exercise-list screen at all) both fall back to the read-only
    // preview, keyed by their own date — not a dead row.
    expect(screen.getByRole('link', { name: /Tuesday/ })).toHaveAttribute('href', `/day/${tuesday}`);
    expect(screen.getByRole('link', { name: /Wednesday/ })).toHaveAttribute('href', `/day/${wednesday}`);
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

  // Post-M12 UX addition (feature 1): a per-row Skip action, distinct from
  // "nothing logged" (red).
  it('Skip on a row marks it Skipped, and Unskip clears it', async () => {
    const user = userEvent.setup();
    const monday = weekBoundsFor(localDateKey()).start;
    const programme: ProgrammeResponse = {
      phase: { id: 1, name: 'Phase 1', start_week: 1, end_week: 6 },
      day_templates: [{ id: 1, weekday: 1, name: 'Lower A', kind: 'lifting', slots: [] }],
    };
    await db.programmeCache.put({ id: 1, cachedAt: new Date().toISOString(), data: programme });

    renderWeekPlan();
    await screen.findByText('Monday');

    const mondayRow = screen.getByText('Monday').closest('li')!;
    await user.click(within(mondayRow).getByRole('button', { name: 'Skip' }));

    expect(await within(mondayRow).findByText('Skipped')).toBeInTheDocument();
    expect(within(mondayRow).getByRole('button', { name: 'Unskip' })).toBeInTheDocument();
    expect(await db.daySkips.get(monday)).toEqual({ date: monday });

    await user.click(within(mondayRow).getByRole('button', { name: 'Unskip' }));
    expect(await within(mondayRow).findByText('0 of 3')).toBeInTheDocument();
    expect(await db.daySkips.get(monday)).toBeUndefined();
  });

  // Post-M12 UX addition (feature 2, redesigned into a sheet after the
  // owner reported the original tap-to-pick flow as confusing): Swap opens
  // a sheet listing every other day; picking one shows a one-line confirm;
  // Confirm commits it.
  it('Swap opens a sheet, picking a day shows a confirm step, and Confirm calls the API', async () => {
    const user = userEvent.setup();
    const monday = weekBoundsFor(localDateKey()).start;
    const mondayDate = parseDateKey(monday);
    const tuesday = localDateKey(new Date(mondayDate.getFullYear(), mondayDate.getMonth(), mondayDate.getDate() + 1));
    const programme: ProgrammeResponse = {
      phase: { id: 1, name: 'Phase 1', start_week: 1, end_week: 6 },
      day_templates: [
        { id: 1, weekday: 1, name: 'Lower A', kind: 'lifting', slots: [] },
        { id: 2, weekday: 2, name: 'Upper A', kind: 'lifting', slots: [] },
      ],
    };
    await db.programmeCache.put({ id: 1, cachedAt: new Date().toISOString(), data: programme });
    swapDaysMock.mockResolvedValue(undefined);
    getDaySwapsMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ date_a: monday, date_b: tuesday }]);

    renderWeekPlan();
    await screen.findByText('Monday');
    const mondayRow = screen.getByText('Monday').closest('li')!;
    const tuesdayRow = screen.getByText('Tuesday').closest('li')!;

    await user.click(within(mondayRow).getByRole('button', { name: 'Swap' }));
    const sheetHeading = await screen.findByText('Swap Monday with:');
    const sheet = sheetHeading.closest('div')!; // h2's own nearest ancestor div is SheetShell's outer container
    expect(swapDaysMock).not.toHaveBeenCalled(); // opening the sheet must not swap anything yet

    await user.click(within(sheet).getByRole('button', { name: 'Tuesday' }));
    await screen.findByText('Swap Monday with Tuesday?');
    expect(swapDaysMock).not.toHaveBeenCalled(); // picking a target must not swap yet either — Confirm does

    await user.click(screen.getByRole('button', { name: 'Confirm swap' }));

    expect(swapDaysMock).toHaveBeenCalledWith(monday, tuesday);
    expect(await within(mondayRow).findByText(/Swapped with Tuesday/)).toBeInTheDocument();
    expect(within(tuesdayRow).getByText(/Swapped with Monday/)).toBeInTheDocument();
  });

  it('the swap sheet flags a skipped day, and its ✕ closes the whole flow without calling the API', async () => {
    const user = userEvent.setup();
    const monday = weekBoundsFor(localDateKey()).start;
    const mondayDate = parseDateKey(monday);
    const tuesday = localDateKey(new Date(mondayDate.getFullYear(), mondayDate.getMonth(), mondayDate.getDate() + 1));
    const programme: ProgrammeResponse = {
      phase: { id: 1, name: 'Phase 1', start_week: 1, end_week: 6 },
      day_templates: [
        { id: 1, weekday: 1, name: 'Lower A', kind: 'lifting', slots: [] },
        { id: 2, weekday: 2, name: 'Upper A', kind: 'lifting', slots: [] },
      ],
    };
    await db.programmeCache.put({ id: 1, cachedAt: new Date().toISOString(), data: programme });
    await db.daySkips.put({ date: tuesday });

    renderWeekPlan();
    await screen.findByText('Monday');
    const mondayRow = screen.getByText('Monday').closest('li')!;

    await user.click(within(mondayRow).getByRole('button', { name: 'Swap' }));
    const tuesdayOption = await screen.findByRole('button', { name: /Tuesday/ });
    expect(within(tuesdayOption).getByText('Skipped')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText('Swap Monday with:')).not.toBeInTheDocument();
    expect(swapDaysMock).not.toHaveBeenCalled();
  });

  it('"Choose a different day" from the confirm step goes back to the day list', async () => {
    const user = userEvent.setup();
    const programme: ProgrammeResponse = {
      phase: { id: 1, name: 'Phase 1', start_week: 1, end_week: 6 },
      day_templates: [
        { id: 1, weekday: 1, name: 'Lower A', kind: 'lifting', slots: [] },
        { id: 2, weekday: 2, name: 'Upper A', kind: 'lifting', slots: [] },
      ],
    };
    await db.programmeCache.put({ id: 1, cachedAt: new Date().toISOString(), data: programme });

    renderWeekPlan();
    await screen.findByText('Monday');
    const mondayRow = screen.getByText('Monday').closest('li')!;

    await user.click(within(mondayRow).getByRole('button', { name: 'Swap' }));
    await user.click(screen.getByRole('button', { name: 'Tuesday' }));
    await screen.findByText('Swap Monday with Tuesday?');

    await user.click(screen.getByRole('button', { name: 'Choose a different day' }));

    expect(await screen.findByText('Swap Monday with:')).toBeInTheDocument();
    expect(swapDaysMock).not.toHaveBeenCalled();
  });

  it('shows a message when the server refuses a swap because a day already has a session', async () => {
    const user = userEvent.setup();
    const programme: ProgrammeResponse = {
      phase: { id: 1, name: 'Phase 1', start_week: 1, end_week: 6 },
      day_templates: [
        { id: 1, weekday: 1, name: 'Lower A', kind: 'lifting', slots: [] },
        { id: 2, weekday: 2, name: 'Upper A', kind: 'lifting', slots: [] },
      ],
    };
    await db.programmeCache.put({ id: 1, cachedAt: new Date().toISOString(), data: programme });
    const { ApiError } = await import('../lib/api');
    swapDaysMock.mockRejectedValue(new ApiError(409, 'already started'));

    renderWeekPlan();
    await screen.findByText('Monday');
    const mondayRow = screen.getByText('Monday').closest('li')!;

    await user.click(within(mondayRow).getByRole('button', { name: 'Swap' }));
    await user.click(screen.getByRole('button', { name: 'Tuesday' }));
    await user.click(screen.getByRole('button', { name: 'Confirm swap' }));

    expect(await screen.findByText(/already been started/i)).toBeInTheDocument();
  });
});
