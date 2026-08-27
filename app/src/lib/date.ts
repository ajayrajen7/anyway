// A "day" is the user's *local* calendar day, not the server's and not UTC's
// — the backend's GET /api/today takes exactly this string (see
// docs/architecture.md §B5 amendment in memory.md). `Date#toISOString()`
// would silently use UTC and could name the wrong day near local midnight
// (e.g. anywhere ahead of UTC, like IST), so build the key from the local
// getters instead.
export function localDateKey(d: Date = new Date()): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
