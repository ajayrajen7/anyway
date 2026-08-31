import { describe, expect, it } from 'vitest';
import {
  buildPainStrip,
  computeActualCoverage,
  computeDayCompletion,
  computePrescribedCoverage,
  computeWeeklyVolume,
  datesInWeek,
  nextWeek,
  previousWeek,
  round1,
  weekBoundsFor,
} from './week';
import type { Exercise, LoggedSet, MorningCheck, ProgrammeResponse } from './types';

describe('weekBoundsFor', () => {
  it('returns Monday..Sunday for a date mid-week', () => {
    // 2026-01-07 is a Wednesday (see server-side ISOWeekday tests).
    expect(weekBoundsFor('2026-01-07')).toEqual({ start: '2026-01-05', end: '2026-01-11' });
  });

  it('a Monday is its own week start', () => {
    expect(weekBoundsFor('2026-01-05')).toEqual({ start: '2026-01-05', end: '2026-01-11' });
  });

  it('a Sunday is its own week end', () => {
    expect(weekBoundsFor('2026-01-11')).toEqual({ start: '2026-01-05', end: '2026-01-11' });
  });
});

describe('previousWeek', () => {
  it('shifts both bounds back exactly 7 days', () => {
    expect(previousWeek({ start: '2026-01-05', end: '2026-01-11' })).toEqual({ start: '2025-12-29', end: '2026-01-04' });
  });
});

describe('nextWeek', () => {
  it('shifts both bounds forward exactly 7 days', () => {
    expect(nextWeek({ start: '2026-01-05', end: '2026-01-11' })).toEqual({ start: '2026-01-12', end: '2026-01-18' });
  });

  it('round-trips with previousWeek', () => {
    const bounds = { start: '2026-01-05', end: '2026-01-11' };
    expect(previousWeek(nextWeek(bounds))).toEqual(bounds);
  });
});

describe('datesInWeek', () => {
  it('returns all 7 dates in order', () => {
    expect(datesInWeek({ start: '2026-01-05', end: '2026-01-11' })).toEqual([
      '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09', '2026-01-10', '2026-01-11',
    ]);
  });
});

describe('computePrescribedCoverage', () => {
  function exercise(overrides: Partial<Exercise> = {}): Exercise {
    return {
      id: 1, slug: 'x', name: 'X', equipment: 'dumbbell', pressure: 'low', impact: 'none',
      unilateral: false, increment_kg: 2.5, blocked: false, block_reason: null, caution: null,
      muscles: { quads: 1.0, glutes: 0.5 },
      ...overrides,
    };
  }

  it('sums weight * sets across all slots in all day_templates, ignoring which week', () => {
    const programme: ProgrammeResponse = {
      phase: { id: 1, name: 'Phase 1', start_week: 1, end_week: 6 },
      day_templates: [
        { id: 1, weekday: 1, name: 'Lower A', kind: 'lifting', slots: [{ id: 1, exercise_id: 10, sets: 3, reps: 12, load_kg: null }] },
        { id: 2, weekday: 4, name: 'Lower B', kind: 'lifting', slots: [{ id: 2, exercise_id: 10, sets: 2, reps: 10, load_kg: null }] },
        { id: 3, weekday: 3, name: 'Mobility', kind: 'cardio_mobility', slots: [] },
      ],
    };
    const exercisesById = new Map([[10, exercise()]]);

    const coverage = computePrescribedCoverage(programme, exercisesById);
    expect(coverage.quads).toBe(5); // (3+2) sets * 1.0
    expect(coverage.glutes).toBe(2.5); // (3+2) sets * 0.5
  });

  it('skips a slot whose exercise is not in the cached library', () => {
    const programme: ProgrammeResponse = {
      phase: { id: 1, name: 'Phase 1', start_week: 1, end_week: 6 },
      day_templates: [{ id: 1, weekday: 1, name: 'Lower A', kind: 'lifting', slots: [{ id: 1, exercise_id: 999, sets: 3, reps: 12, load_kg: null }] }],
    };
    expect(computePrescribedCoverage(programme, new Map())).toEqual({});
  });
});

describe('computeActualCoverage', () => {
  function set(overrides: Partial<LoggedSet> = {}): LoggedSet {
    return {
      client_uuid: 'u', session_id: 1, slot_id: 1, exercise_id: 10, set_index: 1,
      load_kg: 20, reps: 10, status: 'done', provenance: 'prescribed', added_by: null,
      logged_at: '2026-01-06T09:00:00Z',
      ...overrides,
    };
  }
  const exercisesById = new Map([[10, {
    id: 10, slug: 'x', name: 'X', equipment: 'dumbbell', pressure: 'low', impact: 'none',
    unilateral: false, increment_kg: 2.5, blocked: false, block_reason: null, caution: null,
    muscles: { quads: 1.0 },
  } satisfies Exercise]]);
  const bounds = { start: '2026-01-05', end: '2026-01-11' };

  it('sums muscle weight over done sets whose session falls within the week', () => {
    const sessionDateById = new Map([[1, '2026-01-06']]);
    const coverage = computeActualCoverage([set(), set({ set_index: 2 })], sessionDateById, bounds, exercisesById);
    expect(coverage.quads).toBe(2);
  });

  it('excludes skipped sets', () => {
    const sessionDateById = new Map([[1, '2026-01-06']]);
    const coverage = computeActualCoverage([set({ status: 'skipped' })], sessionDateById, bounds, exercisesById);
    expect(coverage.quads ?? 0).toBe(0);
  });

  it('excludes a session dated outside the week — uses the session date, not logged_at', () => {
    // logged_at is inside the week's UTC range, but the session's own local
    // date (from todayCache) is the week before — the session date must win.
    const sessionDateById = new Map([[1, '2025-12-29']]);
    const coverage = computeActualCoverage([set()], sessionDateById, bounds, exercisesById);
    expect(coverage.quads ?? 0).toBe(0);
  });

  it('excludes a set whose session has no known date at all', () => {
    const coverage = computeActualCoverage([set({ session_id: 999 })], new Map(), bounds, exercisesById);
    expect(coverage.quads ?? 0).toBe(0);
  });
});

describe('computeWeeklyVolume', () => {
  it('sums load*reps for done sets within the week only', () => {
    const sets: LoggedSet[] = [
      { client_uuid: 'a', session_id: 1, slot_id: 1, exercise_id: 10, set_index: 1, load_kg: 20, reps: 10, status: 'done', provenance: 'prescribed', added_by: null, logged_at: 'x' },
      { client_uuid: 'b', session_id: 2, slot_id: 1, exercise_id: 10, set_index: 1, load_kg: 100, reps: 100, status: 'done', provenance: 'prescribed', added_by: null, logged_at: 'x' }, // different (excluded) week
    ];
    const sessionDateById = new Map([[1, '2026-01-06'], [2, '2025-12-29']]);
    const volume = computeWeeklyVolume(sets, sessionDateById, { start: '2026-01-05', end: '2026-01-11' });
    expect(volume).toBe(200);
  });
});

describe('buildPainStrip', () => {
  it('maps a pain level for a logged day and null for an absent one, never a default', () => {
    const checks = new Map<string, MorningCheck>([['2026-01-06', { date: '2026-01-06', pain: 'background' }]]);
    const strip = buildPainStrip(checks, ['2026-01-05', '2026-01-06']);
    expect(strip).toEqual([
      { date: '2026-01-05', pain: null },
      { date: '2026-01-06', pain: 'background' },
    ]);
  });
});

describe('computeDayCompletion', () => {
  it('a lifting day is green only when session, protein, and steps are all done', () => {
    const green = computeDayCompletion('2026-01-05', 'lifting', { mainActivityDone: true, proteinLogged: true, stepsLogged: true });
    expect(green).toEqual({ date: '2026-01-05', kind: 'lifting', done: 3, total: 3, color: 'green' });
  });

  it('a lifting day with 1-2 of 3 is yellow', () => {
    const yellow = computeDayCompletion('2026-01-05', 'lifting', { mainActivityDone: true, proteinLogged: false, stepsLogged: false });
    expect(yellow.color).toBe('yellow');
    expect(yellow.done).toBe(1);
  });

  it('a lifting day with nothing done is red', () => {
    const red = computeDayCompletion('2026-01-05', 'lifting', { mainActivityDone: false, proteinLogged: false, stepsLogged: false });
    expect(red.color).toBe('red');
  });

  it('a cardio_mobility day grades the same 3-slot way (main activity = cardio+mobility combined)', () => {
    const result = computeDayCompletion('2026-01-07', 'cardio_mobility', { mainActivityDone: true, proteinLogged: true, stepsLogged: false });
    expect(result).toEqual({ date: '2026-01-07', kind: 'cardio_mobility', done: 2, total: 3, color: 'yellow' });
  });

  it('a rest day has no main-activity slot — only 2 of 2 possible, green needs just protein+steps', () => {
    const result = computeDayCompletion('2026-01-11', 'rest', { mainActivityDone: false, proteinLogged: true, stepsLogged: true });
    expect(result).toEqual({ date: '2026-01-11', kind: 'rest', done: 2, total: 2, color: 'green' });
  });
});

describe('round1', () => {
  it('rounds to one decimal place, matching §B4\'s own ROUND(...,1)', () => {
    expect(round1(14.349)).toBe(14.3);
    expect(round1(14.35)).toBe(14.4);
  });
});
