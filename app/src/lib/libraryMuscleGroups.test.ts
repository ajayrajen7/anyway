import { describe, expect, it } from 'vitest';
import { LIBRARY_SECTIONS, groupExercisesBySection } from './libraryMuscleGroups';
import type { Exercise } from './types';
import { MUSCLE_GROUPS } from './types';

function exercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 1,
    slug: 'sample-exercise',
    name: 'Sample exercise',
    equipment: 'dumbbell',
    pressure: 'low',
    impact: 'none',
    unilateral: false,
    increment_kg: 2.5,
    blocked: false,
    block_reason: null,
    caution: null,
    muscles: { chest: 1.0 },
    ...overrides,
  };
}

describe('Library muscle sections', () => {
  it('assigns every canonical muscle tag to exactly one of the five sections', () => {
    const assigned = LIBRARY_SECTIONS.flatMap((section) => section.muscles);

    expect(LIBRARY_SECTIONS.map((section) => section.label)).toEqual([
      'Chest',
      'Back',
      'Shoulders & Arms',
      'Legs',
      'Core',
    ]);
    expect(assigned).toHaveLength(MUSCLE_GROUPS.length);
    expect(new Set(assigned)).toEqual(new Set(MUSCLE_GROUPS));
  });

  it('lists an exercise in every section with a positive-weight impacted muscle', () => {
    const groups = groupExercisesBySection([
      exercise({ muscles: { chest: 1.0, lats: 0.5, biceps: 0.3, core: 0 } }),
    ]);

    expect(groups.filter((group) => group.exercises.length > 0).map((group) => group.id)).toEqual([
      'chest',
      'back',
      'shoulders_arms',
    ]);
  });

  it('sorts exercises by name within each section', () => {
    const groups = groupExercisesBySection([
      exercise({ id: 1, slug: 'z-press', name: 'Z Press', muscles: { chest: 1.0 } }),
      exercise({ id: 2, slug: 'a-press', name: 'A Press', muscles: { chest: 1.0 } }),
    ]);

    expect(groups[0].exercises.map((item) => item.name)).toEqual(['A Press', 'Z Press']);
  });
});
