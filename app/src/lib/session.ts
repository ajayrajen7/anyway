// Pure helpers for the session runner (M4/M5) — kept free of Dexie/React so
// they're trivial to unit test. See src/lib/outbox.ts for the actual writes,
// src/lib/overlay.ts for the swap/add-exercise Dexie layer.
import type { Actual, CachedToday, ExerciseRef, LoggedSet, Provenance, SessionOverlay, TodayResponse } from './types';

export interface SetValues {
  loadKg: number | null;
  reps: number;
}

// "Set rows pre-fill with the last logged actual for that exercise, falling
// back to prescribed load/reps on first exposure" (prd.md §A3.3). A swapped-
// in exercise (M5) has no offline last-actual data to draw on, so it always
// falls back to the slot's originally prescribed sets/reps.
export function prefillFor(slot: Pick<RunnerSlot, 'loadKg' | 'reps' | 'lastActual'>): SetValues {
  const actual: Actual | null = slot.lastActual;
  if (actual) return { loadKg: actual.load_kg, reps: actual.reps };
  return { loadKg: slot.loadKg, reps: slot.reps };
}

// The unified, ordered list of exercises to run *this* session — the
// original prescription (todayCache, immutable) with any swaps applied in
// place and any added exercises interleaved (M5). Everything downstream
// (SessionRunner, ExercisePanel) works off this, never off TodaySlot/
// SessionOverlay directly.
export interface RunnerSlot {
  key: string; // stable React key — `slot-<slots.id>` or `added-<uuid>`
  slotId: number | null; // real slots.id for logged_sets.slot_id — null when added
  exercise: ExerciseRef;
  sets: number;
  reps: number;
  loadKg: number | null;
  note: string | null;
  swaps: ExerciseRef[]; // tier-1 options — always from the *original* slot, empty for an added exercise
  lastActual: Actual | null;
  provenance: Provenance;
  addedBy: 'trainer' | 'me' | null;
}

export function buildRunnerSlots(data: TodayResponse, overlay: SessionOverlay): RunnerSlot[] {
  const prescribed: RunnerSlot[] = data.slots.map((slot) => {
    const swap = overlay.swaps[String(slot.id)];
    return {
      key: `slot-${slot.id}`,
      slotId: slot.id,
      exercise: swap ? swap.exercise : slot.exercise,
      sets: slot.sets,
      reps: slot.reps,
      loadKg: slot.load_kg,
      note: slot.note,
      swaps: slot.swaps,
      lastActual: swap ? null : slot.last_actual,
      provenance: swap ? swap.provenance : 'prescribed',
      addedBy: null,
    };
  });

  // Insert each added exercise right after its target key, in the order
  // they were added. `after_key` always refers to something that already
  // existed at add-time — an original prescribed slot, or an *earlier*
  // added exercise — so processing overlay.added in push order and
  // searching the list built so far always finds it (handles chains of
  // several exercises added back-to-back correctly, not just one).
  const result = [...prescribed];
  for (const a of overlay.added) {
    const runnerSlot: RunnerSlot = {
      key: `added-${a.id}`,
      slotId: null,
      exercise: a.exercise,
      sets: a.sets,
      reps: a.reps,
      loadKg: a.load_kg,
      note: null,
      swaps: [],
      lastActual: null,
      provenance: 'added',
      addedBy: a.added_by,
    };
    const afterIndex = a.after_key === null ? -1 : result.findIndex((s) => s.key === a.after_key);
    if (afterIndex === -1) {
      result.push(runnerSlot); // null after_key, or a stale/unmatched one — append at the end
    } else {
      result.splice(afterIndex + 1, 0, runnerSlot);
    }
  }

  // Deletions (UX refactor) apply last, after swaps and interleaving —
  // a deleted exercise simply never appears in the session's list at all,
  // no matter whether it was prescribed or added.
  return result.filter((s) => !overlay.removed.includes(s.key));
}

// Neither a weight nor a rep count can go negative via the stepper.
export function clampNonNegative(n: number): number {
  return Math.max(0, n);
}

// What the nested Swap/Add sheets read via useOutletContext — everything
// they need to act, without re-fetching what their parent screen already
// loaded. Shared by SessionOverview (parent of Add) and SessionExercise
// (parent of Swap) — see docs/architecture.md §B6.1's amendment.
export interface RunnerOutletContext {
  sessionId: number;
  data: CachedToday['data'];
  currentSlot: RunnerSlot | undefined; // the exercise being viewed when the sheet was opened, if any
  onOverlayChange: () => void; // call after writing to sessionOverlay, before navigating back
}

// "Swipe row left → skipped" (§A3.3). A pure threshold check so the gesture
// math is testable without simulating real touch/pointer events.
//
// Real bug fixed here: the original version only checked horizontal
// distance, so an ordinary vertical scroll past a pending set row — with
// even modest horizontal thumb drift, easily >80px over a long scroll on a
// real phone — registered as a left-swipe and silently skipped the set.
// Reported live: a real session came back "0 done, 6 skipped" after the
// owner had actually entered data for every set. Requiring the horizontal
// movement to *dominate* the vertical movement is the standard fix for
// this exact swipe-vs-scroll ambiguity. deltaY defaults to 0 so existing
// callers that only ever tracked X keep working unchanged.
export const SWIPE_SKIP_THRESHOLD_PX = 80;
export function isSwipeLeft(deltaX: number, deltaY = 0): boolean {
  return deltaX <= -SWIPE_SKIP_THRESHOLD_PX && Math.abs(deltaX) > Math.abs(deltaY);
}

// The session's exercise-list screen (UX refactor) shows a status per
// exercise without needing to open it. "in_progress" — some but not all of
// its sets resolved — matters: a partially-logged exercise should read
// differently from one nothing has happened on yet.
export type SlotStatus = 'pending' | 'in_progress' | 'done';

export function computeSlotStatus(setsForExercise: LoggedSet[], totalSets: number): SlotStatus {
  const resolved = setsForExercise.filter((s) => s.status === 'done' || s.status === 'skipped').length;
  if (resolved === 0) return 'pending';
  if (resolved >= totalSets) return 'done';
  return 'in_progress';
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
