import { afterEach, expect, it, vi } from 'vitest';
import { ApiError, archiveExercise, getExerciseLibrary } from './api';

afterEach(() => vi.unstubAllGlobals());

it('getExerciseLibraryRequestsCompleteCatalogue', async () => {
  const archived = {
    id: 3, slug: 'archived-curl', name: 'Archived curl', equipment: 'dumbbell',
    pressure: 'low', impact: 'none', unilateral: false, increment_kg: 2.5,
    blocked: false, block_reason: null, caution: null, active: false,
    muscles: { biceps: 1 },
  };
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([archived]), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  expect(await getExerciseLibrary()).toMatchObject([{ active: false, muscles: { biceps: 1 } }]);
  expect(fetchMock.mock.calls[0][0]).toBe('/api/exercises?include_blocked=1&include_archived=1');
});

it('archiveExerciseSendsDeleteRequest', async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  await archiveExercise(42);
  expect(fetchMock.mock.calls[0][0]).toBe('/api/exercises/42');
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'DELETE' });
});

it('archiveExerciseRejectsServerError', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('failed', { status: 500 })));
  await expect(archiveExercise(42)).rejects.toMatchObject({ status: 500, message: 'failed' } satisfies Partial<ApiError>);
});
