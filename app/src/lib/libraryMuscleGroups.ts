import type { Exercise, MuscleGroup } from './types';

export const LIBRARY_SECTIONS = [
  { id: 'chest', label: 'Chest', muscles: ['chest'] },
  { id: 'back', label: 'Back', muscles: ['lats', 'upper_back', 'erectors'] },
  {
    id: 'shoulders_arms',
    label: 'Shoulders & Arms',
    muscles: ['delts_front', 'delts_side', 'delts_rear', 'biceps', 'triceps'],
  },
  {
    id: 'legs',
    label: 'Legs',
    muscles: ['quads', 'hamstrings', 'glutes', 'adductors', 'calves', 'tibialis', 'foot'],
  },
  { id: 'core', label: 'Core', muscles: ['core'] },
] as const satisfies readonly {
  id: string;
  label: string;
  muscles: readonly MuscleGroup[];
}[];

export type LibrarySectionId = (typeof LIBRARY_SECTIONS)[number]['id'];

export type LibrarySectionExercises = {
  [K in LibrarySectionId]: (typeof LIBRARY_SECTIONS)[number] & { id: K };
}[LibrarySectionId] & { exercises: Exercise[] };

export function groupExercisesBySection(exercises: readonly Exercise[]): LibrarySectionExercises[] {
  return LIBRARY_SECTIONS.map((section) => ({
    ...section,
    exercises: exercises
      .filter((exercise) => section.muscles.some((muscle) => (exercise.muscles[muscle] ?? 0) > 0))
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name)),
  })) as LibrarySectionExercises[];
}
