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

export const ProteinLog = z.object({
  date: z.string(),
  hit: z.boolean(),
});
export type ProteinLog = z.infer<typeof ProteinLog>;

// Presence = done. There is deliberately no `done: false` row — unchecking
// the box deletes the row rather than writing a negative value (mirrors the
// "absence, never a default" discipline used for morning_checks, applied
// here because a checkbox's natural semantics are "logged" vs "not", not a
// meaningful yes/no like protein's).
export const MobilityLog = z.object({
  date: z.string(),
});
export type MobilityLog = z.infer<typeof MobilityLog>;

export const CardioLog = z.object({
  id: z.number().optional(),
  date: z.string(),
  modality: z.string(),
  duration_min: z.number(),
});
export type CardioLog = z.infer<typeof CardioLog>;

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
// prescription — swaps and additions. `todayCache.data` + `SessionOverlay`
// together are "what this session actually is"; see
// src/lib/session.ts#buildRunnerSlots.
export const SessionOverlay = z.object({
  sessionId: z.number(),
  swaps: z.record(z.string(), SwapOverride), // keyed by TodaySlot.id.toString()
  added: z.array(AddedSlot),
});
export type SessionOverlay = z.infer<typeof SessionOverlay>;

// --- Weigh-in (prd.md §A4, "the Vault") — M9 ---

export const WeighIn = z.object({
  date: z.string(),
  weight_kg: z.number(),
});
export type WeighIn = z.infer<typeof WeighIn>;

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
