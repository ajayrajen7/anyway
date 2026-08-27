// Caches GET /api/programme (the active phase's full week structure) so the
// Week View (M8) can compute prescribed coverage offline — same pattern as
// cacheExerciseLibrary/cacheToday. One row: the programme is phase-wide and
// constant across weeks, so there's nothing to key by date or session.
import { db } from './db';
import { getProgramme } from './api';

export async function cacheProgramme(): Promise<void> {
  const data = await getProgramme();
  await db.programmeCache.put({ id: 1, cachedAt: new Date().toISOString(), data });
}

export async function getCachedProgramme() {
  return db.programmeCache.get(1);
}
