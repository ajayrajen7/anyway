// Human-readable labels for the canonical muscle-group vocabulary
// (docs/prd.md §A5.1) — shared by Coverage.tsx (the weekly table) and
// SessionExercise.tsx (the per-exercise muscle pills) so both screens use
// exactly the same wording for the same 17 names, not two hand-maintained
// copies that could drift.
import type { MuscleGroup } from './types';

export const MUSCLE_LABELS: Record<MuscleGroup, string> = {
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  adductors: 'Adductors',
  calves: 'Calves',
  tibialis: 'Tibialis',
  foot: 'Foot',
  erectors: 'Erectors',
  chest: 'Chest',
  lats: 'Lats',
  upper_back: 'Upper back',
  delts_front: 'Front delts',
  delts_side: 'Side delts',
  delts_rear: 'Rear delts',
  biceps: 'Biceps',
  triceps: 'Triceps',
  core: 'Core',
};

// A short form for tight spaces (the muscle-pill row on the session
// screen) — the reference mockup shows "GLUTES 1.0 · HAMS 0.5", not the
// full "Hamstrings". Falls back to the full label for anything without a
// dedicated short form.
const SHORT_LABELS: Partial<Record<MuscleGroup, string>> = {
  hamstrings: 'Hams',
  adductors: 'Add.',
  tibialis: 'Tib.',
  erectors: 'Erect.',
  upper_back: 'Up. back',
  delts_front: 'Front delts',
  delts_side: 'Side delts',
  delts_rear: 'Rear delts',
};

export function shortMuscleLabel(muscle: MuscleGroup): string {
  return SHORT_LABELS[muscle] ?? MUSCLE_LABELS[muscle];
}
