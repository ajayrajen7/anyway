// Pure aggregation for the Week View (prd.md §A3.7, architecture.md §B4) —
// kept free of Dexie/React so the math is trivial to unit test.
//
// Computed entirely client-side from Dexie, not a server GET /api/week:
// §B4's coverage query assumes the server already has synced "actual" data
// to aggregate against (i.e. M9's sync worker exists and has run), which it
// doesn't yet. "Prescribed" comes from the cached GET /api/programme
// response (src/lib/programmeCache.ts); "actual" comes from local
// loggedSets; both are combined here.
import { localDateKey, parseDateKey } from './date';
import { computeSessionTotals } from './session';
import type { Exercise, LoggedSet, MorningCheck, MuscleGroup, PainLevel, ProgrammeResponse } from './types';

export interface WeekBounds {
  start: string; // YYYY-MM-DD, Monday
  end: string; // YYYY-MM-DD, Sunday
}

// The Monday-start ISO week containing `date`.
export function weekBoundsFor(date: string): WeekBounds {
  const d = parseDateKey(date);
  const isoWeekday = d.getDay() === 0 ? 7 : d.getDay(); // 1=Mon..7=Sun, matching architecture.md §B3
  const monday = new Date(d);
  monday.setDate(d.getDate() - (isoWeekday - 1));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: localDateKey(monday), end: localDateKey(sunday) };
}

export function previousWeek(bounds: WeekBounds): WeekBounds {
  const start = parseDateKey(bounds.start);
  start.setDate(start.getDate() - 7);
  const end = parseDateKey(bounds.end);
  end.setDate(end.getDate() - 7);
  return { start: localDateKey(start), end: localDateKey(end) };
}

// UX refactor: both Coverage and Week Plan gained "navigate across weeks" —
// the mirror image of previousWeek.
export function nextWeek(bounds: WeekBounds): WeekBounds {
  const start = parseDateKey(bounds.start);
  start.setDate(start.getDate() + 7);
  const end = parseDateKey(bounds.end);
  end.setDate(end.getDate() + 7);
  return { start: localDateKey(start), end: localDateKey(end) };
}

// The 7 dates Mon..Sun in `bounds`, for the pain strip.
export function datesInWeek(bounds: WeekBounds): string[] {
  const start = parseDateKey(bounds.start);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return localDateKey(d);
  });
}

function isWithin(date: string, bounds: WeekBounds): boolean {
  return date >= bounds.start && date <= bounds.end; // YYYY-MM-DD strings compare lexicographically in date order
}

export type MuscleCoverage = Partial<Record<MuscleGroup, number>>;

function addMuscleWeights(coverage: MuscleCoverage, exercise: Exercise, multiplier: number): void {
  for (const [muscle, weight] of Object.entries(exercise.muscles) as [MuscleGroup, number][]) {
    coverage[muscle] = (coverage[muscle] ?? 0) + weight * multiplier;
  }
}

// "Prescribed coverage is the same shape over slots × day_templates for the
// active phase, multiplied by slots.sets" (§B4) — phase-wide and constant;
// there is no date/week filtering here, by design.
export function computePrescribedCoverage(programme: ProgrammeResponse, exercisesById: Map<number, Exercise>): MuscleCoverage {
  const coverage: MuscleCoverage = {};
  for (const dayTemplate of programme.day_templates) {
    for (const slot of dayTemplate.slots) {
      const exercise = exercisesById.get(slot.exercise_id);
      if (exercise) addMuscleWeights(coverage, exercise, slot.sets);
    }
  }
  return coverage;
}

// Sums exercise_muscles.weight over completed sets in the week (§B4's own
// query, run client-side). `sessionDateById` maps a set's session to its
// local calendar date — deliberately not the set's own `logged_at`
// timestamp; see src/lib/todayCache.ts#getAllCachedSessionDates for why.
export function computeActualCoverage(
  sets: LoggedSet[],
  sessionDateById: Map<number, string>,
  bounds: WeekBounds,
  exercisesById: Map<number, Exercise>,
): MuscleCoverage {
  const coverage: MuscleCoverage = {};
  for (const s of sets) {
    if (s.status !== 'done') continue;
    const date = sessionDateById.get(s.session_id);
    if (!date || !isWithin(date, bounds)) continue;
    const exercise = exercisesById.get(s.exercise_id);
    if (exercise) addMuscleWeights(coverage, exercise, 1);
  }
  return coverage;
}

// Total load-moved volume for the week — the mockup's single "Total volume"
// figure, reusing the same done-sets-only math as a session summary.
export function computeWeeklyVolume(sets: LoggedSet[], sessionDateById: Map<number, string>, bounds: WeekBounds): number {
  const inWeek = sets.filter((s) => {
    const date = sessionDateById.get(s.session_id);
    return date != null && isWithin(date, bounds);
  });
  return computeSessionTotals(inWeek).totalVolumeKg;
}

export interface PainDot {
  date: string;
  pain: PainLevel | null; // null = absent — never defaulted to a real level
}

// "Mornings ● ● ○ ● ● ● ●" (§A3.7) — one dot per day of the week, in order.
export function buildPainStrip(morningChecks: Map<string, MorningCheck>, dates: string[]): PainDot[] {
  return dates.map((date) => ({ date, pain: morningChecks.get(date)?.pain ?? null }));
}

// Matches §B4's own `ROUND(SUM(em.weight), 1)` — one decimal place.
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// --- Week Plan (UX refactor): green/yellow/red per day, Mon..Sat ---
//
// "3 of 3 done" per day, day-appropriate: a lifting day's 3 are the session,
// protein, and steps; a cardio/mobility day's 3 are cardio+mobility (one
// combined item — Today itself presents them as one day's activity),
// protein, and steps; a rest day has no main-activity item at all (2 of 2).
// Pure — the caller (WeekPlan.tsx) resolves each boolean from Dexie first,
// keeping the grading rule itself trivially testable.
//
// `proteinLogged` counts as done the moment any gram value is recorded for
// the date — not whether it reached the 120g target. Originally this was
// `proteinHit` (target-gated), but the owner explicitly asked for "any
// value counts" after finding a day stayed ungraded with 50g logged; see
// memory.md's whole-day-Done, round 3 entry. `grams >= 120` is still
// derived and stored on the log row itself (`ProteinLog.hit`) — it's just
// no longer what gates day completion anywhere.
export type DayKind = 'lifting' | 'cardio_mobility' | 'rest';
// 'skipped' (post-M12 UX addition): a deliberate "not doing this day," kept
// visually and semantically distinct from 'red' (nothing logged, possibly
// just not reached yet) — see src/lib/types.ts#DaySkip and memory.md.
export type DayColor = 'green' | 'yellow' | 'red' | 'skipped';

export interface DayCompletion {
  date: string;
  kind: DayKind;
  done: number;
  total: number;
  color: DayColor;
}

export function computeDayCompletion(
  date: string,
  kind: DayKind,
  signals: { mainActivityDone: boolean; proteinLogged: boolean; stepsLogged: boolean; skipped?: boolean },
): DayCompletion {
  const items = kind === 'rest' ? [signals.proteinLogged, signals.stepsLogged] : [signals.mainActivityDone, signals.proteinLogged, signals.stepsLogged];
  const total = items.length;
  const done = items.filter(Boolean).length;
  // A skip overrides the color even if some fields happened to get logged
  // before the skip was tapped — "I'm not doing this day" is the stronger
  // fact — but `done`/`total` still reflect whatever's actually recorded,
  // so a caller isn't lying about the raw counts, only the color verdict.
  const color: DayColor = signals.skipped ? 'skipped' : done >= total ? 'green' : done > 0 ? 'yellow' : 'red';
  return { date, kind, done, total, color };
}
