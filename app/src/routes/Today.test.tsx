import { render, screen } from '@testing-library/react';
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
// cacheExerciseLibrary would otherwise attempt a real fetch — stub it out.
vi.mock('../lib/exerciseCache', () => ({ cacheExerciseLibrary: vi.fn().mockResolvedValue(undefined) }));

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
  it('renders a lifting day card with the session card and a Start session link', async () => {
    getTodayMock.mockResolvedValue(liftingDay);
    renderToday();

    expect(await screen.findByRole('heading', { name: 'Lower A' })).toBeInTheDocument();
    expect(screen.getByText('6 exercises · ~55 min')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Start session' });
    expect(link).toHaveAttribute('href', '/session/42');
  });

  it('renders the cardio/mobility day without a Start session link', async () => {
    getTodayMock.mockResolvedValue({
      date: '2026-01-07',
      weekday: 3,
      day_template: { id: 3, name: 'Mobility + Zone 2', kind: 'cardio_mobility' },
      session: null,
      slots: [],
    } satisfies TodayResponse);
    renderToday();

    expect(await screen.findByRole('heading', { name: 'Mobility + Zone 2' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Start session' })).not.toBeInTheDocument();
  });

  it('renders the rest day', async () => {
    getTodayMock.mockResolvedValue({
      date: '2026-01-11',
      weekday: 7,
      day_template: { id: 7, name: 'Off', kind: 'rest' },
      session: null,
      slots: [],
    } satisfies TodayResponse);
    renderToday();

    expect(await screen.findByRole('heading', { name: 'Off' })).toBeInTheDocument();
    expect(screen.getByText(/flat walk only/i)).toBeInTheDocument();
  });

  it('shows an error message when the fetch fails', async () => {
    getTodayMock.mockRejectedValue(new ApiError(404, 'no active phase — run the programme seed first'));
    renderToday();

    expect(await screen.findByText(/no active phase/i)).toBeInTheDocument();
  });
});
