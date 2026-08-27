// Caches a GET /api/today response for offline use by the session runner
// (M4) — see src/lib/types.ts#CachedToday and docs/architecture.md §B2.
// Only lifting days are cached: only they have a session to run offline.
import { db } from './db';
import type { TodayResponse } from './types';

export async function cacheToday(data: TodayResponse): Promise<void> {
  if (!data.session) return;
  await db.todayCache.put({
    sessionId: data.session.id,
    date: data.date,
    cachedAt: new Date().toISOString(),
    data,
  });
}

export async function getCachedToday(sessionId: number) {
  return db.todayCache.get(sessionId);
}
