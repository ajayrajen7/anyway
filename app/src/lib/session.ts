// Pure helpers for the session runner (M4) — kept free of Dexie/React so
// they're trivial to unit test. See src/lib/outbox.ts for the actual writes.
import type { Actual, LoggedSet, TodaySlot } from './types';

export interface SetValues {
  loadKg: number | null;
  reps: number;
}

// "Set rows pre-fill with the last logged actual for that exercise, falling
// back to prescribed load/reps on first exposure" (prd.md §A3.3).
export function prefillFor(slot: TodaySlot): SetValues {
  const actual: Actual | null = slot.last_actual;
  if (actual) return { loadKg: actual.load_kg, reps: actual.reps };
  return { loadKg: slot.load_kg, reps: slot.reps };
}

// Neither a weight nor a rep count can go negative via the stepper.
export function clampNonNegative(n: number): number {
  return Math.max(0, n);
}

// "Swipe row left → skipped" (§A3.3). A pure threshold check so the gesture
// math is testable without simulating real touch/pointer events.
export const SWIPE_SKIP_THRESHOLD_PX = 80;
export function isSwipeLeft(deltaX: number): boolean {
  return deltaX <= -SWIPE_SKIP_THRESHOLD_PX;
}

export interface SessionTotals {
  doneSets: number;
  skippedSets: number;
  totalVolumeKg: number;
}

// Session summary (`/session/:id/done`, §A3.3): counts + volume. Volume only
// counts *done* sets — a skipped set moved no load.
export function computeSessionTotals(loggedSets: LoggedSet[]): SessionTotals {
  let doneSets = 0;
  let skippedSets = 0;
  let totalVolumeKg = 0;
  for (const s of loggedSets) {
    if (s.status === 'done') {
      doneSets++;
      totalVolumeKg += (s.load_kg ?? 0) * (s.reps ?? 0);
    } else {
      skippedSets++;
    }
  }
  return { doneSets, skippedSets, totalVolumeKg };
}
