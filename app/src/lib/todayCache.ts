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

// session_id → its local calendar date, for every session ever viewed on
// this device. Used by the Week View (M8) to know which calendar day a
// logged set belongs to — deliberately *not* derived from a set's
// `logged_at` timestamp (UTC, via toISOString — could misattribute a set
// logged near local midnight to the wrong day/week). A session is only ever
// reachable through Today, so every session that ran has a todayCache row.
export async function getAllCachedSessionDates(): Promise<Map<number, string>> {
  const rows = await db.todayCache.toArray();
  return new Map(rows.map((r) => [r.sessionId, r.date]));
}
