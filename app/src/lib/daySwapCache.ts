// A local, offline-readable cache of server-side day swaps
// (server/internal/dayplan) — same "fetch while online, read offline"
// pattern as programmeCache/exerciseCache. The server is the source of
// truth (swapping mutates which day_template a future GET /api/today
// resolves); this just lets DayPreview.tsx honor an already-made swap
// without its own network call, matching its own "fully offline" design.
// Populated by WeekPlan.tsx whenever it loads a week's swaps.
import { getDaySwaps } from './api';
import { db } from './db';

export async function cacheDaySwapsForWeek(start: string, end: string): Promise<void> {
  const pairs = await getDaySwaps(start, end);
  // Clear this range's existing local rows first, not just upsert the
  // fetched pairs over them — otherwise a swap undone since the last fetch
  // would leave a stale "swapped with" entry behind forever.
  const staleDates = await db.daySwaps.where('date').between(start, end, true, true).primaryKeys();
  await db.daySwaps.bulkDelete(staleDates);
  for (const pair of pairs) {
    await db.daySwaps.put({ date: pair.date_a, swapped_with: pair.date_b });
    await db.daySwaps.put({ date: pair.date_b, swapped_with: pair.date_a });
  }
}

export async function getCachedDaySwap(date: string) {
  return db.daySwaps.get(date);
}
