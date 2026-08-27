// Caches the full exercise library into Dexie so the Swap and Add-exercise
// screens (M5) can search it with no network call — those two screens live
// under /session/* and must stay offline-first same as the runner itself
// (see docs/architecture.md §B2, §B6.1 amendment).
import { db } from './db';
import { getExerciseLibrary } from './api';
import type { Exercise } from './types';

// Call this only while online (Today.tsx does, right after its own
// successful fetch). Safe to call repeatedly — it's a full replace, and the
// library is small (under 100 rows) and changes rarely.
export async function cacheExerciseLibrary(): Promise<void> {
  const exercises = await getExerciseLibrary();
  await db.exercises.bulkPut(exercises);
}

// Offline substring search over the cached library, mirroring the backend's
// own search semantics (server/internal/seed/seed.go#List): case-insensitive
// match on name, blocked rows excluded unless includeBlocked is set. Never
// hides a blocked *match* when includeBlocked is requested — the swap sheet
// needs to show it greyed with its reason, not silently omit it (§A3.4).
export async function searchExercisesOffline(query: string, includeBlocked: boolean): Promise<Exercise[]> {
  const all = await db.exercises.toArray();
  const q = query.trim().toLowerCase();
  return all
    .filter((e) => (includeBlocked || !e.blocked) && (q === '' || e.name.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name));
}
