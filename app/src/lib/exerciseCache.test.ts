import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import { cacheExerciseLibrary, searchExercisesOffline } from './exerciseCache';
import type { Exercise } from './types';

const { getExerciseLibraryMock } = vi.hoisted(() => ({ getExerciseLibraryMock: vi.fn() }));
vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return { ...actual, getExerciseLibrary: getExerciseLibraryMock };
});

function ex(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 1,
    slug: 'goblet-squat',
    name: 'Goblet squat',
    equipment: 'dumbbell',
    pressure: 'moderate',
    impact: 'none',
    unilateral: false,
    increment_kg: 2.5,
    blocked: false,
    block_reason: null,
    caution: null,
    muscles: { quads: 1.0 },
    ...overrides,
  };
}

afterEach(async () => {
  getExerciseLibraryMock.mockReset();
  await db.exercises.clear();
});

describe('cacheExerciseLibrary', () => {
  it('fetches the full library (including blocked) and bulk-writes it to Dexie', async () => {
    getExerciseLibraryMock.mockResolvedValue([ex({ id: 1 }), ex({ id: 2, blocked: true, block_reason: 'x' })]);
    await cacheExerciseLibrary();
    expect(await db.exercises.count()).toBe(2);
  });
});

describe('searchExercisesOffline', () => {
  it('excludes blocked exercises by default', async () => {
    await db.exercises.bulkPut([ex({ id: 1, name: 'Goblet squat' }), ex({ id: 2, name: 'Running', blocked: true, block_reason: 'Impact' })]);
    const results = await searchExercisesOffline('', false);
    expect(results.map((e) => e.name)).toEqual(['Goblet squat']);
  });

  it('still finds a blocked exercise by name when includeBlocked is true, with its reason intact', async () => {
    await db.exercises.bulkPut([ex({ id: 2, name: 'Running', blocked: true, block_reason: 'Impact — knee and Achilles' })]);
    const results = await searchExercisesOffline('run', true);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: 'Running', block_reason: 'Impact — knee and Achilles' });
  });

  it('matches case-insensitively on a substring of the name', async () => {
    await db.exercises.bulkPut([ex({ id: 1, name: 'Dumbbell curl' })]);
    expect(await searchExercisesOffline('CURL', false)).toHaveLength(1);
    expect(await searchExercisesOffline('nomatch', false)).toHaveLength(0);
  });

  it('returns results sorted by name', async () => {
    await db.exercises.bulkPut([ex({ id: 1, name: 'Zzz exercise' }), ex({ id: 2, name: 'Aaa exercise' })]);
    const results = await searchExercisesOffline('', false);
    expect(results.map((e) => e.name)).toEqual(['Aaa exercise', 'Zzz exercise']);
  });
});
