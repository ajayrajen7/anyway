// Weekday-indexed display info shared by Today.tsx (the live day) and
// DayPreview.tsx (a read-only look at a day not reached yet) — pulled out
// so both render the exact same labels/defaults instead of two hand-kept
// copies. None of this is stored anywhere; it's display-only, transcribed
// from docs/programme.md Part 2 (see each map's own note).
export const WEEKDAY_NAMES: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};

// Fixed weekly session-length estimates from docs/programme.md Part 2 —
// display-only, not stored anywhere (duration isn't part of the data model).
export const SESSION_MINUTES: Record<number, number> = {
  1: 55, // Mon — Lower A
  2: 50, // Tue — Upper A (Push)
  3: 45, // Wed — Mobility + Zone 2
  4: 55, // Thu — Lower B
  5: 50, // Fri — Upper B (Pull)
  6: 45, // Sat — Mobility + Incline Walk
};

// Cardio modality + starting duration per docs/programme.md's weekly
// structure. Wed's 20 min matches §A3.6's own mockup literally; Sat's 15 min
// is the programme's stated week-1 starting point (no week-by-week
// progression exists in the data model, so there's just the one default —
// see memory.md).
export const CARDIO_CONFIG: Record<number, { label: string; modality: string; defaultMinutes: number }> = {
  3: { label: 'Cross trainer', modality: 'cross-trainer', defaultMinutes: 20 },
  6: { label: 'Incline walk', modality: 'incline-walk', defaultMinutes: 15 },
};
