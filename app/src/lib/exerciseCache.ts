// Caches the full exercise library into Dexie so the Library, Swap, and
// Add-exercise screens can browse/search it from local storage — the two
// under /session/* and must stay offline-first same as the runner itself
// (see docs/architecture.md §B2, §B6.1 amendment).
import { db } from './db';
import { getExerciseLibrary } from './api';
import type { Exercise } from './types';

// Call this only while online (Today.tsx and Library.tsx do, right after their
// successful fetch). Safe to call repeatedly — it's a full replace, and the
// library is small (under 100 rows) and changes rarely.
export async function cacheExerciseLibrary(): Promise<void> {
  const exercises = await getExerciseLibrary();
  await db.transaction('rw', db.exercises, async () => {
    // A response may have been requested before a successful archive and land
    // afterward. Archive is monotonic, so keep any locally archived IDs false.
    const cached = await db.exercises.toArray();
    const archivedIds = new Set(cached.filter((exercise) => exercise.active === false).map((exercise) => exercise.id));
    await db.exercises.bulkPut(exercises.map((exercise) =>
      archivedIds.has(exercise.id) ? { ...exercise, active: false } : exercise,
    ));
  });
}

// Writes one freshly-created exercise straight into the cache — used right
// after POST /api/exercises/generate (see AddExercise.tsx and Library.tsx) so a real-time
// LLM-drafted exercise is searchable/pickable immediately, without waiting
// for the next full cacheExerciseLibrary() refresh (from Today or Library).
export async function cacheExercise(exercise: Exercise): Promise<void> {
  await db.exercises.put(exercise);
}

// Session snapshots retain the approved swap list they were created with.
// Use the shared archive state to keep a later archive out of that list too.
export async function getArchivedExerciseIds(): Promise<Set<number>> {
  const exercises = await db.exercises.toArray();
  return new Set(exercises.filter((exercise) => exercise.active === false).map((exercise) => exercise.id));
}

// Offline substring search over the cached library, mirroring the backend's
// own search semantics (server/internal/seed/seed.go#List): case-insensitive
// match on name. Archived rows are excluded; blocked rows are excluded unless
// includeBlocked is set. Never hides a blocked *match* when requested — the swap sheet
// needs to show it greyed with its reason, not silently omit it (§A3.4).
export async function searchExercisesOffline(query: string, includeBlocked: boolean): Promise<Exercise[]> {
  const all = await db.exercises.toArray();
  const q = query.trim().toLowerCase();
  return all
    .filter((e) => e.active !== false && (includeBlocked || !e.blocked) && (q === '' || e.name.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name));
}
