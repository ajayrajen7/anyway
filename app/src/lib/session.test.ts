import { describe, expect, it } from 'vitest';
import {
  clampNonNegative,
  computeSessionTotals,
  isSwipeLeft,
  prefillFor,
  SWIPE_SKIP_THRESHOLD_PX,
} from './session';
import type { LoggedSet, TodaySlot } from './types';

function makeSlot(overrides: Partial<TodaySlot> = {}): TodaySlot {
  return {
    id: 1,
    position: 1,
    exercise: { id: 10, slug: 'leg-press', name: 'Leg press', unilateral: false, increment_kg: 5 },
    sets: 3,
    reps: 12,
    load_kg: null,
    note: null,
    swaps: [],
    last_actual: null,
    ...overrides,
  };
}

describe('prefillFor', () => {
  it('falls back to prescribed load/reps on first exposure (no last_actual)', () => {
    const slot = makeSlot({ load_kg: 25, reps: 12 });
    expect(prefillFor(slot)).toEqual({ loadKg: 25, reps: 12 });
  });

  it('pre-fills from the last logged actual when one exists', () => {
    const slot = makeSlot({ load_kg: 25, reps: 12, last_actual: { load_kg: 27.5, reps: 10 } });
    expect(prefillFor(slot)).toEqual({ loadKg: 27.5, reps: 10 });
  });
});

describe('clampNonNegative', () => {
  it('floors at 0', () => {
    expect(clampNonNegative(-5)).toBe(0);
    expect(clampNonNegative(0)).toBe(0);
    expect(clampNonNegative(3)).toBe(3);
  });
});

describe('isSwipeLeft', () => {
  it('is true at and beyond the threshold', () => {
    expect(isSwipeLeft(-SWIPE_SKIP_THRESHOLD_PX)).toBe(true);
    expect(isSwipeLeft(-200)).toBe(true);
  });
  it('is false short of the threshold, and for a rightward drag', () => {
    expect(isSwipeLeft(-10)).toBe(false);
    expect(isSwipeLeft(50)).toBe(false);
  });
});

describe('computeSessionTotals', () => {
  function set(overrides: Partial<LoggedSet>): LoggedSet {
    return {
      client_uuid: 'u',
      session_id: 1,
      slot_id: 1,
      exercise_id: 1,
      set_index: 1,
      load_kg: null,
      reps: null,
      status: 'done',
      provenance: 'prescribed',
      added_by: null,
      logged_at: '2026-01-05T09:00:00Z',
      ...overrides,
    };
  }

  it('counts done vs skipped and sums volume from done sets only', () => {
    const totals = computeSessionTotals([
      set({ status: 'done', load_kg: 20, reps: 10 }),
      set({ status: 'done', load_kg: 20, reps: 8 }),
      set({ status: 'skipped', load_kg: 999, reps: 999 }), // must not contribute volume
    ]);
    expect(totals).toEqual({ doneSets: 2, skippedSets: 1, totalVolumeKg: 20 * 10 + 20 * 8 });
  });

  it('treats a null load as 0 volume (bodyweight sets)', () => {
    const totals = computeSessionTotals([set({ status: 'done', load_kg: null, reps: 12 })]);
    expect(totals.totalVolumeKg).toBe(0);
  });

  it('returns zeros for an empty session', () => {
    expect(computeSessionTotals([])).toEqual({ doneSets: 0, skippedSets: 0, totalVolumeKg: 0 });
  });
});
