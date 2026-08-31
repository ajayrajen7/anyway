import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../lib/api';
import { db } from '../lib/db';
import type { TodayResponse } from '../lib/types';
import Today from './Today';

const { getTodayMock } = vi.hoisted(() => ({ getTodayMock: vi.fn() }));
vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return { ...actual, getToday: getTodayMock };
});
// cacheExerciseLibrary/cacheProgramme would otherwise attempt a real fetch — stub them out.
vi.mock('../lib/exerciseCache', () => ({ cacheExerciseLibrary: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/programmeCache', () => ({ cacheProgramme: vi.fn().mockResolvedValue(undefined) }));

function renderToday() {
  return render(
    <MemoryRouter>
      <Today />
    </MemoryRouter>,
  );
}

afterEach(async () => {
  getTodayMock.mockReset();
  await db.todayCache.clear();
  await db.proteinLogs.clear();
  await db.mobilityLogs.clear();
  await db.cardioLogs.clear();
  await db.stepsLogs.clear();
  await db.outbox.clear();
});

const liftingDay: TodayResponse = {
  date: '2026-01-05',
  weekday: 1,
  day_template: { id: 1, name: 'Lower A', kind: 'lifting' },
  session: { id: 42, status: 'planned', started_at: null, ended_at: null, note: null },
  slots: Array.from({ length: 6 }, (_, i) => ({
    id: i + 1,
    position: i + 1,
    exercise: { id: i + 1, slug: `ex-${i}`, name: `Exercise ${i}`, unilateral: false, increment_kg: 2.5 },
    sets: 3,
    reps: 12,
    load_kg: null,
    note: null,
    swaps: [],
    last_actual: null,
  })),
};

describe('Today screen', () => {
  it('renders a lifting day card headed by the weekday name (never the phase day-template name), with a Start session link', async () => {
    getTodayMock.mockResolvedValue(liftingDay);
    renderToday();

    expect(await screen.findByRole('heading', { name: 'Monday' })).toBeInTheDocument();
    expect(screen.queryByText('Lower A')).not.toBeInTheDocument();
    expect(screen.getByText('6 exercises · ~55 min')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Start session' });
    expect(link).toHaveAttribute('href', '/session/42');
  });

  it('renders the cardio/mobility day, headed by the weekday name, without a Start session link', async () => {
    getTodayMock.mockResolvedValue({
      date: '2026-01-07',
      weekday: 3,
      day_template: { id: 3, name: 'Mobility + Zone 2', kind: 'cardio_mobility' },
      session: null,
      slots: [],
    } satisfies TodayResponse);
    renderToday();

    expect(await screen.findByRole('heading', { name: 'Wednesday' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Start session' })).not.toBeInTheDocument();
  });

  it('renders the rest day, headed by the weekday name', async () => {
    getTodayMock.mockResolvedValue({
      date: '2026-01-11',
      weekday: 7,
      day_template: { id: 7, name: 'Off', kind: 'rest' },
      session: null,
      slots: [],
    } satisfies TodayResponse);
    renderToday();

    expect(await screen.findByRole('heading', { name: 'Sunday' })).toBeInTheDocument();
    expect(screen.getByText(/flat walk only/i)).toBeInTheDocument();
  });

  it('shows an error message when the fetch fails', async () => {
    getTodayMock.mockRejectedValue(new ApiError(404, 'no active phase — run the programme seed first'));
    renderToday();

    expect(await screen.findByText(/no active phase/i)).toBeInTheDocument();
  });

  it('shows a Mobility stepper (0-10 min) on a lifting day and persists on tap', async () => {
    const user = userEvent.setup();
    getTodayMock.mockResolvedValue(liftingDay);
    renderToday();

    await screen.findByText('Mobility');
    expect(screen.getByText('0 min')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Increase mobility minutes' }));
    expect(screen.getByText('1 min')).toBeInTheDocument();
    expect(await db.mobilityLogs.get('2026-01-05')).toEqual({ date: '2026-01-05', duration_min: 1 });
  });

  it('caps the mobility stepper at 10 min', async () => {
    const user = userEvent.setup();
    getTodayMock.mockResolvedValue(liftingDay);
    renderToday();

    const increase = await screen.findByRole('button', { name: 'Increase mobility minutes' });
    for (let i = 0; i < 12; i++) {
      await user.click(increase);
    }
    expect(screen.getByText('10 min')).toBeInTheDocument();
  });

  it('shows a Steps stepper on any day and persists on tap', async () => {
    const user = userEvent.setup();
    getTodayMock.mockResolvedValue(liftingDay);
    renderToday();

    await screen.findByText('Steps');
    expect(screen.getByText('0')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Increase steps' }));

    expect(screen.getByText('500')).toBeInTheDocument();
    expect(await db.stepsLogs.get('2026-01-05')).toEqual({ date: '2026-01-05', steps: 500 });
  });

  it('shows a working protein grams stepper any time of day, deriving hit from the 120g target', async () => {
    // Follow-up to the M12 redesign: the evening-only gate was removed once
    // the owner tried logging protein earlier in the day and found nothing
    // there — it's shown all day now, same as Steps/Mobility.
    const user = userEvent.setup();
    getTodayMock.mockResolvedValue(liftingDay);
    renderToday();
    await screen.findByText('Protein');
    expect(screen.getByText('0 g')).toBeInTheDocument();

    const increase = screen.getByRole('button', { name: 'Increase protein grams' });
    for (let i = 0; i < 13; i++) {
      await user.click(increase); // 13 × 10g = 130g, over the 120g target
    }

    expect(screen.getByText('130 g')).toBeInTheDocument();
    expect(await db.proteinLogs.get('2026-01-05')).toEqual({ date: '2026-01-05', grams: 130, hit: true });
  });

  it('on a cardio_mobility day (Wed), shows the cross-trainer checkbox defaulting to 20 min and logs on check', async () => {
    const user = userEvent.setup();
    getTodayMock.mockResolvedValue({
      date: '2026-01-07',
      weekday: 3,
      day_template: { id: 3, name: 'Mobility + Zone 2', kind: 'cardio_mobility' },
      session: null,
      slots: [],
    } satisfies TodayResponse);
    renderToday();

    const checkbox = await screen.findByRole('checkbox', { name: 'Cross trainer' });
    expect(screen.getByText('20 min')).toBeInTheDocument();
    await user.click(checkbox);

    const stored = await db.cardioLogs.where({ date: '2026-01-07', modality: 'cross-trainer' }).first();
    expect(stored).toMatchObject({ duration_min: 20 });
  });

  it('on a cardio_mobility day (Sat), defaults the incline-walk duration to 15 min', async () => {
    getTodayMock.mockResolvedValue({
      date: '2026-01-10',
      weekday: 6,
      day_template: { id: 6, name: 'Mobility + Incline Walk', kind: 'cardio_mobility' },
      session: null,
      slots: [],
    } satisfies TodayResponse);
    renderToday();

    await screen.findByRole('checkbox', { name: 'Incline walk' });
    expect(screen.getByText('15 min')).toBeInTheDocument();
  });

  it('adjusting the duration stepper while checked keeps the logged entry in sync', async () => {
    const user = userEvent.setup();
    getTodayMock.mockResolvedValue({
      date: '2026-01-07',
      weekday: 3,
      day_template: { id: 3, name: 'Mobility + Zone 2', kind: 'cardio_mobility' },
      session: null,
      slots: [],
    } satisfies TodayResponse);
    renderToday();

    await user.click(await screen.findByRole('checkbox', { name: 'Cross trainer' }));
    await user.click(screen.getByRole('button', { name: 'Increase minutes' }));

    expect(screen.getByText('25 min')).toBeInTheDocument();
    const stored = await db.cardioLogs.where({ date: '2026-01-07', modality: 'cross-trainer' }).first();
    expect(stored?.duration_min).toBe(25);
  });

  it('checking Full mobility, expanding the checklist, and tapping Done closes the day in 3 taps', async () => {
    const user = userEvent.setup();
    getTodayMock.mockResolvedValue({
      date: '2026-01-07',
      weekday: 3,
      day_template: { id: 3, name: 'Mobility + Zone 2', kind: 'cardio_mobility' },
      session: null,
      slots: [],
    } satisfies TodayResponse);
    renderToday();

    await user.click(await screen.findByRole('checkbox', { name: 'Cross trainer' })); // tap 1
    await user.click(screen.getByRole('checkbox', { name: /Full mobility/ })); // tap 2
    await user.click(screen.getByRole('button', { name: 'Done' })); // tap 3

    expect(await screen.findByText('Done for today.')).toBeInTheDocument();
    expect(await db.mobilityLogs.get('2026-01-07')).toEqual({ date: '2026-01-07', duration_min: 10 });
  });

  it('View expands the 12-item mobility checklist (ticks are not persisted)', async () => {
    const user = userEvent.setup();
    getTodayMock.mockResolvedValue({
      date: '2026-01-07',
      weekday: 3,
      day_template: { id: 3, name: 'Mobility + Zone 2', kind: 'cardio_mobility' },
      session: null,
      slots: [],
    } satisfies TodayResponse);
    renderToday();

    await user.click(await screen.findByRole('button', { name: 'View' }));
    expect(screen.getByText('Knee-to-wall dorsiflexion')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2 + 12); // cross-trainer + full-mobility + 12 item ticks
  });
});
