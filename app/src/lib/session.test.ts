import { describe, expect, it } from 'vitest';
import {
  buildRunnerSlots,
  clampNonNegative,
  computeSessionTotals,
  computeSlotStatus,
  isSwipeLeft,
  prefillFor,
  removedSlotIdsFrom,
  SWIPE_SKIP_THRESHOLD_PX,
  type RunnerSlot,
} from './session';
import type { AddedSlot, ExerciseRef, LoggedSet, SessionOverlay, TodayResponse, TodaySlot } from './types';

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
    expect(prefillFor({ loadKg: 25, reps: 12, lastActual: null })).toEqual({ loadKg: 25, reps: 12 });
  });

  it('pre-fills from the last logged actual when one exists', () => {
    expect(prefillFor({ loadKg: 25, reps: 12, lastActual: { load_kg: 27.5, reps: 10 } })).toEqual({
      loadKg: 27.5,
      reps: 10,
    });
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
  // Real bug, reported live: a vertical scroll past a pending set row —
  // with only modest horizontal thumb drift — was silently skipping it
  // (a real session came back "0 done, 6 skipped" after data was actually
  // entered for every set). Horizontal movement must dominate vertical.
  it('is false when the movement is mostly vertical (a scroll), even past the X threshold', () => {
    expect(isSwipeLeft(-100, 300)).toBe(false); // scrolled down, drifted left
    expect(isSwipeLeft(-100, -300)).toBe(false); // scrolled up, drifted left
  });
  it('is still true for a real horizontal swipe with only incidental vertical movement', () => {
    expect(isSwipeLeft(-100, 10)).toBe(true);
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

describe('buildRunnerSlots', () => {
  const exA: ExerciseRef = { id: 10, slug: 'leg-press', name: 'Leg press', unilateral: false, increment_kg: 5 };
  const exB: ExerciseRef = { id: 11, slug: 'hip-thrust', name: 'Hip thrust', unilateral: false, increment_kg: 2.5 };
  const swapEx: ExerciseRef = { id: 12, slug: 'leg-press-sl', name: 'Single-leg leg press', unilateral: true, increment_kg: 5 };
  const addedEx: ExerciseRef = { id: 13, slug: 'db-curl', name: 'Dumbbell curl', unilateral: false, increment_kg: 2.5 };

  function makeData(slots: TodaySlot[]): TodayResponse {
    return {
      date: '2026-01-05',
      weekday: 1,
      day_template: { id: 1, name: 'Lower A', kind: 'lifting' },
      session: { id: 42, status: 'planned', started_at: null, ended_at: null, note: null },
      slots,
    };
  }

  function emptyOverlay(): SessionOverlay {
    return { sessionId: 42, swaps: {}, added: [], removed: [] };
  }

  it('with no overlay, mirrors the prescribed slots exactly, in order, with provenance "prescribed"', () => {
    const data = makeData([makeSlot({ id: 1, position: 1, exercise: exA }), makeSlot({ id: 2, position: 2, exercise: exB })]);
    const result = buildRunnerSlots(data, emptyOverlay());
    expect(result.map((s) => s.key)).toEqual(['slot-1', 'slot-2']);
    expect(result.every((s) => s.provenance === 'prescribed')).toBe(true);
  });

  it('a swap replaces the exercise and provenance for that slot only, and clears last_actual', () => {
    const data = makeData([
      makeSlot({ id: 1, position: 1, exercise: exA, last_actual: { load_kg: 30, reps: 10 } }),
      makeSlot({ id: 2, position: 2, exercise: exB }),
    ]);
    const overlay: SessionOverlay = { sessionId: 42, swaps: { '1': { exercise: swapEx, provenance: 'swap_in_list' } }, added: [], removed: [] };
    const result = buildRunnerSlots(data, overlay);

    expect(result[0]).toMatchObject({ key: 'slot-1', exercise: swapEx, provenance: 'swap_in_list', lastActual: null, slotId: 1 });
    expect(result[1]).toMatchObject({ key: 'slot-2', exercise: exB, provenance: 'prescribed' });
  });

  it('an added exercise with after_key=null is appended at the end', () => {
    const data = makeData([makeSlot({ id: 1, position: 1, exercise: exA })]);
    const added: AddedSlot = { id: 'a1', exercise: addedEx, sets: 3, reps: 10, load_kg: null, added_by: 'trainer', after_key: null };
    const result = buildRunnerSlots(data, { sessionId: 42, swaps: {}, added: [added], removed: [] });

    expect(result.map((s) => s.key)).toEqual(['slot-1', 'added-a1']);
    expect(result[1]).toMatchObject({ slotId: null, exercise: addedEx, provenance: 'added', addedBy: 'trainer' });
  });

  it('an added exercise is interleaved right after its target, not appended at the end', () => {
    const data = makeData([
      makeSlot({ id: 1, position: 1, exercise: exA }),
      makeSlot({ id: 2, position: 2, exercise: exB }),
    ]);
    const added: AddedSlot = { id: 'a1', exercise: addedEx, sets: 3, reps: 10, load_kg: null, added_by: 'me', after_key: 'slot-1' };
    const result = buildRunnerSlots(data, { sessionId: 42, swaps: {}, added: [added], removed: [] });

    expect(result.map((s) => s.key)).toEqual(['slot-1', 'added-a1', 'slot-2']);
  });

  it('chains multiple additions correctly when one is added after another', () => {
    const data = makeData([makeSlot({ id: 1, position: 1, exercise: exA })]);
    const first: AddedSlot = { id: 'a1', exercise: addedEx, sets: 3, reps: 10, load_kg: null, added_by: 'me', after_key: 'slot-1' };
    const second: AddedSlot = { id: 'a2', exercise: exB, sets: 3, reps: 10, load_kg: null, added_by: 'trainer', after_key: 'added-a1' };
    const result = buildRunnerSlots(data, { sessionId: 42, swaps: {}, added: [first, second], removed: [] });

    expect(result.map((s) => s.key)).toEqual(['slot-1', 'added-a1', 'added-a2']);
  });

  it('falls back to appending at the end if after_key does not match anything', () => {
    const data = makeData([makeSlot({ id: 1, position: 1, exercise: exA })]);
    const added: AddedSlot = { id: 'a1', exercise: addedEx, sets: 3, reps: 10, load_kg: null, added_by: 'me', after_key: 'slot-999' };
    const result = buildRunnerSlots(data, { sessionId: 42, swaps: {}, added: [added], removed: [] });
    expect(result.map((s) => s.key)).toEqual(['slot-1', 'added-a1']);
  });

  it('an added exercise carries no tier-1 swaps of its own', () => {
    const data = makeData([]);
    const added: AddedSlot = { id: 'a1', exercise: addedEx, sets: 3, reps: 10, load_kg: null, added_by: 'me', after_key: null };
    const result: RunnerSlot[] = buildRunnerSlots(data, { sessionId: 42, swaps: {}, added: [added], removed: [] });
    expect(result[0]?.swaps).toEqual([]);
  });

  it('a deleted prescribed slot never appears in the list at all (UX refactor)', () => {
    const data = makeData([makeSlot({ id: 1, position: 1, exercise: exA }), makeSlot({ id: 2, position: 2, exercise: exB })]);
    const result = buildRunnerSlots(data, { sessionId: 42, swaps: {}, added: [], removed: ['slot-1'] });
    expect(result.map((s) => s.key)).toEqual(['slot-2']);
  });

  it('a deleted added exercise never appears either', () => {
    const data = makeData([makeSlot({ id: 1, position: 1, exercise: exA })]);
    const added: AddedSlot = { id: 'a1', exercise: addedEx, sets: 3, reps: 10, load_kg: null, added_by: 'me', after_key: null };
    const result = buildRunnerSlots(data, { sessionId: 42, swaps: {}, added: [added], removed: ['added-a1'] });
    expect(result.map((s) => s.key)).toEqual(['slot-1']);
  });
});

describe('computeSlotStatus', () => {
  function set(overrides: Partial<LoggedSet>): LoggedSet {
    return {
      client_uuid: 'u', session_id: 1, slot_id: 1, exercise_id: 1, set_index: 1,
      load_kg: null, reps: null, status: 'done', provenance: 'prescribed', added_by: null,
      logged_at: '2026-01-05T09:00:00Z',
      ...overrides,
    };
  }

  it('is pending when nothing has been resolved', () => {
    expect(computeSlotStatus([], 3)).toBe('pending');
  });

  it('is in_progress when some but not all sets are resolved', () => {
    expect(computeSlotStatus([set({ set_index: 1, status: 'done' })], 3)).toBe('in_progress');
  });

  it('is done once every set is resolved, done or skipped', () => {
    const sets = [set({ set_index: 1, status: 'done' }), set({ set_index: 2, status: 'skipped' }), set({ set_index: 3, status: 'done' })];
    expect(computeSlotStatus(sets, 3)).toBe('done');
  });
});

// Post-M12 feature 4 ("this week's actual plan becomes next week's base"):
// tells the server which of a session's deletions were real slots.
describe('removedSlotIdsFrom', () => {
  it('extracts the numeric id from real slot- keys', () => {
    expect(removedSlotIdsFrom({ removed: ['slot-7', 'slot-12'] })).toEqual([7, 12]);
  });

  it('drops added- keys — a session-added exercise was never a real slot', () => {
    expect(removedSlotIdsFrom({ removed: ['slot-7', 'added-uuid-1'] })).toEqual([7]);
  });

  it('is empty for nothing removed', () => {
    expect(removedSlotIdsFrom({ removed: [] })).toEqual([]);
  });
});
