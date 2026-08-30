import { afterEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { addExercise, applySwap, getOverlay, removeExercise } from './overlay';
import type { ExerciseRef } from './types';

const swapEx: ExerciseRef = { id: 12, slug: 'leg-press-sl', name: 'Single-leg leg press', unilateral: true, increment_kg: 5 };
const addedEx: ExerciseRef = { id: 13, slug: 'db-curl', name: 'Dumbbell curl', unilateral: false, increment_kg: 2.5 };

afterEach(async () => {
  await db.sessionOverlay.clear();
});

describe('getOverlay', () => {
  it('returns an empty overlay when nothing has been swapped, added, or deleted yet', async () => {
    expect(await getOverlay(1)).toEqual({ sessionId: 1, swaps: {}, added: [], removed: [] });
  });
});

describe('applySwap', () => {
  it('records a swap keyed by slot id', async () => {
    await applySwap(1, 5, swapEx, 'swap_in_list');
    const overlay = await getOverlay(1);
    expect(overlay.swaps).toEqual({ '5': { exercise: swapEx, provenance: 'swap_in_list' } });
  });

  it('a second swap on the same slot replaces the first, not adds to it', async () => {
    await applySwap(1, 5, swapEx, 'swap_in_list');
    await applySwap(1, 5, addedEx, 'swap_off_list');
    const overlay = await getOverlay(1);
    expect(Object.keys(overlay.swaps)).toEqual(['5']);
    expect(overlay.swaps['5']).toEqual({ exercise: addedEx, provenance: 'swap_off_list' });
  });

  it('does not affect a different session', async () => {
    await applySwap(1, 5, swapEx, 'swap_in_list');
    expect(await getOverlay(2)).toEqual({ sessionId: 2, swaps: {}, added: [], removed: [] });
  });
});

describe('addExercise', () => {
  it('appends an added slot with a generated id and the given attribution', async () => {
    const added = await addExercise(1, addedEx, 'trainer', 'slot-5');
    expect(added).toMatchObject({ exercise: addedEx, sets: 3, reps: 10, load_kg: null, added_by: 'trainer', after_key: 'slot-5' });
    expect(added.id).toBeTruthy();

    const overlay = await getOverlay(1);
    expect(overlay.added).toHaveLength(1);
    expect(overlay.added[0]).toEqual(added);
  });

  it('accumulates multiple additions in order', async () => {
    await addExercise(1, addedEx, 'me', null);
    await addExercise(1, swapEx, 'trainer', null);
    const overlay = await getOverlay(1);
    expect(overlay.added.map((a) => a.exercise.id)).toEqual([addedEx.id, swapEx.id]);
  });
});

describe('removeExercise', () => {
  it('adds the key to removed', async () => {
    await removeExercise(1, 'slot-5');
    expect((await getOverlay(1)).removed).toEqual(['slot-5']);
  });

  it('is idempotent — deleting the same exercise twice does not duplicate it', async () => {
    await removeExercise(1, 'slot-5');
    await removeExercise(1, 'slot-5');
    expect((await getOverlay(1)).removed).toEqual(['slot-5']);
  });

  it('does not affect a different session', async () => {
    await removeExercise(1, 'slot-5');
    expect((await getOverlay(2)).removed).toEqual([]);
  });
});
