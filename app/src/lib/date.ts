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

// "After 18:00, a Protein — hit 120g? row" (prd.md §A3.2) — local wall-clock
// time, same reasoning as localDateKey.
export function isAfter6pm(d: Date = new Date()): boolean {
  return d.getHours() >= 18;
}

// "Weigh-in — Sundays only" (prd.md §A4) — local wall-clock day, same
// reasoning as isAfter6pm/localDateKey.
export function isSunday(d: Date = new Date()): boolean {
  return d.getDay() === 0;
}

// The inverse of localDateKey — parses via local Date components
// (year/month/day), never `new Date(dateString)`, which the spec treats a
// bare YYYY-MM-DD as UTC midnight and would shift the date in any timezone
// ahead of UTC.
export function parseDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}
