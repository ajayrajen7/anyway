// Shared types — mirrors docs/architecture.md §B3 schema. Zod schemas validate
// anything crossing a boundary (API response, IndexedDB read after a schema
// bump) per the carried-over "Zod at every boundary" discipline.
import { z } from 'zod';

export const MUSCLE_GROUPS = [
  'quads', 'hamstrings', 'glutes', 'adductors', 'calves', 'tibialis', 'foot',
  'erectors', 'chest', 'lats', 'upper_back', 'delts_front', 'delts_side',
  'delts_rear', 'biceps', 'triceps', 'core',
] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export const PainLevel = z.enum(['none', 'background', 'noticeable', 'limiting']);
export type PainLevel = z.infer<typeof PainLevel>;

export const Provenance = z.enum(['prescribed', 'swap_in_list', 'swap_off_list', 'added']);
export type Provenance = z.infer<typeof Provenance>;

export const Exercise = z.object({
  id: z.number(),
  slug: z.string(),
  name: z.string(),
  equipment: z.string(),
  pressure: z.enum(['low', 'moderate', 'high']),
  impact: z.enum(['none', 'low', 'high']),
  unilateral: z.boolean(),
  increment_kg: z.number(),
  blocked: z.boolean(),
  block_reason: z.string().nullable(),
  caution: z.string().nullable(),
  // partialRecord, not record: a real exercise only ever specifies a
  // handful of the 17 muscle groups (§A5.2) — z.record(enum, ...) infers a
  // TS type requiring *every* key present, which no real exercise satisfies.
  muscles: z.partialRecord(z.enum(MUSCLE_GROUPS), z.number()),
  // 'programme' = the hand-transcribed prd.md §A5 library; 'llm' = drafted
  // in real time by the server's exercisegen package (see AddExercise.tsx).
  // Optional, not defaulted: a stale cached record from before this field
  // existed (or any fixture/test object built without it) should still
  // parse/typecheck — undefined is treated the same as 'programme'
  // everywhere this is read (e.g. `exercise.source === 'llm'`).
  source: z.enum(['programme', 'llm']).optional(),
});
export type Exercise = z.infer<typeof Exercise>;

export const LoggedSet = z.object({
  id: z.number().optional(), // absent for a not-yet-synced local row
  client_uuid: z.string(),
  session_id: z.number(),
  slot_id: z.number().nullable(),
  exercise_id: z.number(),
  set_index: z.number(),
  load_kg: z.number().nullable(),
  reps: z.number().nullable(),
  status: z.enum(['done', 'skipped']),
  provenance: Provenance,
  added_by: z.enum(['trainer', 'me']).nullable(),
  logged_at: z.string(),
});
export type LoggedSet = z.infer<typeof LoggedSet>;

export const MorningCheck = z.object({
  date: z.string(),
  pain: PainLevel,
});
export type MorningCheck = z.infer<typeof MorningCheck>;

// --- Protein / mobility / cardio (M7, prd.md §A3.2/§A3.6) ---

// UX addition (post-M12): `grams` is the real manually-entered value (like
// Steps — a stepper, not Yes/No); `hit` (grams >= 120) is still derived and
// stored so Week Plan's existing day-completion grading needs no changes.
// Optional, not required: a pre-this-change fixture/cached row has no
// `grams` field at all — same "don't break every existing literal" reasoning
// as Exercise.source (see types.ts's note there).
export const ProteinLog = z.object({
  date: z.string(),
  hit: z.boolean(),
  grams: z.number().optional(),
});
export type ProteinLog = z.infer<typeof ProteinLog>;

// UX addition (post-M12): mobility is now a manual 0-10 min entry on a
// lifting day (like Steps), not a plain checkbox — see dailyLogs.ts. The
// Wed/Sat "Full mobility" checkbox (Today.tsx#CardioMobilityDay) still uses
// this same table, now always carrying a real duration too. `duration_min`
// is optional for the same reason `grams` is above.
export const MobilityLog = z.object({
  date: z.string(),
  duration_min: z.number().optional(),
});
export type MobilityLog = z.infer<typeof MobilityLog>;

export const CardioLog = z.object({
  id: z.number().optional(),
  date: z.string(),
  modality: z.string(),
  duration_min: z.number(),
});
export type CardioLog = z.infer<typeof CardioLog>;

// A real daily count, like protein — not presence-only like mobility.
export const StepsLog = z.object({
  date: z.string(),
  steps: z.number(),
});
export type StepsLog = z.infer<typeof StepsLog>;

// Whole-day "Done for today" (post-M12 follow-up, round 2): the owner asked
// for an explicit "Done" button they tap, not a silent auto-collapse the
// instant the last field is filled — so this one bit of state (was the
// button actually pressed for this date?) needs its own persisted row, the
// same lesson learned from the earlier ephemeral-`closed`-flag bug ("how do
// I save a day, that button is missing" — see memory.md). Local-only, never
// synced: purely a UI confirmation, not domain data anything server-side or
// any other screen needs to know about.
export const DayConfirmation = z.object({
  date: z.string(),
});
export type DayConfirmation = z.infer<typeof DayConfirmation>;

// --- GET /api/today (docs/architecture.md §B5, M3) ---

export const ExerciseRef = z.object({
  id: z.number(),
  slug: z.string(),
  name: z.string(),
  unilateral: z.boolean(),
  increment_kg: z.number(),
});
export type ExerciseRef = z.infer<typeof ExerciseRef>;

const Actual = z.object({
  load_kg: z.number().nullable(),
  reps: z.number(),
});
export type Actual = z.infer<typeof Actual>;

const TodaySlot = z.object({
  id: z.number(), // slots.id — needed for /session/:id/swap/:slotId (M5) and logged_sets.slot_id
  position: z.number(),
  exercise: ExerciseRef,
  sets: z.number(),
  reps: z.number(),
  load_kg: z.number().nullable(),
  note: z.string().nullable(),
  swaps: z.array(ExerciseRef),
  last_actual: Actual.nullable(),
});
export type TodaySlot = z.infer<typeof TodaySlot>;

const TodaySession = z.object({
  id: z.number(),
  status: z.enum(['planned', 'completed', 'missed']),
  started_at: z.string().nullable(),
  ended_at: z.string().nullable(),
  note: z.string().nullable(),
});
export type TodaySession = z.infer<typeof TodaySession>;

export const TodayResponse = z.object({
  date: z.string(),
  weekday: z.number().min(1).max(7),
  day_template: z.object({
    id: z.number(),
    name: z.string(),
    kind: z.enum(['lifting', 'cardio_mobility', 'rest']),
  }),
  session: TodaySession.nullable(),
  slots: z.array(TodaySlot),
});
export type TodayResponse = z.infer<typeof TodayResponse>;

// --- GET /api/programme (docs/architecture.md §B5 amendment, M8) ---

const ProgrammeSlot = z.object({
  id: z.number(),
  exercise_id: z.number(),
  sets: z.number(),
  reps: z.number(),
  load_kg: z.number().nullable(),
});
export type ProgrammeSlot = z.infer<typeof ProgrammeSlot>;

const ProgrammeDayTemplate = z.object({
  id: z.number(),
  weekday: z.number().min(1).max(7),
  name: z.string(),
  kind: z.enum(['lifting', 'cardio_mobility', 'rest']),
  slots: z.array(ProgrammeSlot),
});
export type ProgrammeDayTemplate = z.infer<typeof ProgrammeDayTemplate>;

export const ProgrammeResponse = z.object({
  phase: z.object({
    id: z.number(),
    name: z.string(),
    start_week: z.number(),
    end_week: z.number(),
  }),
  day_templates: z.array(ProgrammeDayTemplate),
});
export type ProgrammeResponse = z.infer<typeof ProgrammeResponse>;

// A local cache of GET /api/programme — one row, refreshed whenever Today
// loads successfully (same trigger as cacheExerciseLibrary). The Week View
// (M8) reads this for *prescribed* coverage; it's phase-wide and constant
// across weeks, so unlike todayCache there's nothing to key by date/session.
export const CachedProgramme = z.object({
  id: z.literal(1),
  cachedAt: z.string(),
  data: ProgrammeResponse,
});
export type CachedProgramme = z.infer<typeof CachedProgramme>;

// A local cache of a GET /api/today response, written while online (e.g. from
// the Today screen) so the offline-first session runner (M4) can read it
// without ever awaiting the network — see docs/architecture.md §B2.
export const CachedToday = z.object({
  sessionId: z.number(), // primary key — only lifting days (which have a session) are cached
  date: z.string(),
  cachedAt: z.string(),
  data: TodayResponse,
});
export type CachedToday = z.infer<typeof CachedToday>;

// A locally-added, ad-hoc exercise (prd.md §A3.5) — no `slots` row exists for
// it server-side (logged_sets.slot_id stays null for these), so its
// prescription is invented client-side: 3×10, no load, adjustable via the
// normal steppers like anything else.
export const AddedSlot = z.object({
  id: z.string(), // locally generated (crypto.randomUUID()) — never a real slots.id
  exercise: ExerciseRef,
  sets: z.number(),
  reps: z.number(),
  load_kg: z.number().nullable(),
  added_by: z.enum(['trainer', 'me']),
  after_key: z.string().nullable(), // RunnerSlot.key to insert after; null = append at the end
});
export type AddedSlot = z.infer<typeof AddedSlot>;

// A swap applied to a prescribed slot (prd.md §A3.4) — overrides which
// exercise that slot logs against, without touching the immutable
// `todayCache` snapshot of what the server originally prescribed.
export const SwapOverride = z.object({
  exercise: ExerciseRef,
  provenance: z.enum(['swap_in_list', 'swap_off_list']),
});
export type SwapOverride = z.infer<typeof SwapOverride>;

// Local, session-scoped record of everything that changed from the original
// prescription — swaps, additions, and deletions (UX refactor: "delete an
// exercise from today's session" — session-local, never synced, same as
// swaps/additions; see memory.md). `todayCache.data` + `SessionOverlay`
// together are "what this session actually is"; see
// src/lib/session.ts#buildRunnerSlots.
export const SessionOverlay = z.object({
  sessionId: z.number(),
  swaps: z.record(z.string(), SwapOverride), // keyed by TodaySlot.id.toString()
  added: z.array(AddedSlot),
  removed: z.array(z.string()).default([]), // RunnerSlot.key values deleted from this session's list
});
export type SessionOverlay = z.infer<typeof SessionOverlay>;

// --- POST /api/sync (docs/architecture.md §B5, M9) ---

export const SyncResult = z.object({
  entity: z.string(),
  entity_id: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
});
export type SyncResult = z.infer<typeof SyncResult>;

export const OutboxEntry = z.object({
  id: z.number().optional(),
  entity: z.string(),
  entity_id: z.string(),
  payload: z.string(),
  created_at: z.string(),
  synced_at: z.string().nullable(),
});
export type OutboxEntry = z.infer<typeof OutboxEntry>;
