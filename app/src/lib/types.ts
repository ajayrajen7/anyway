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
  muscles: z.record(z.enum(MUSCLE_GROUPS), z.number()),
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

export const OutboxEntry = z.object({
  id: z.number().optional(),
  entity: z.string(),
  entity_id: z.string(),
  payload: z.string(),
  created_at: z.string(),
  synced_at: z.string().nullable(),
});
export type OutboxEntry = z.infer<typeof OutboxEntry>;
