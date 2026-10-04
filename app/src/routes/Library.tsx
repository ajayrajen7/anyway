import { useEffect, useState, type FormEvent } from 'react';
import { Card, Pill } from '../components/ui';
import { ApiError, generateExercise } from '../lib/api';
import { cacheExercise, cacheExerciseLibrary } from '../lib/exerciseCache';
import { db } from '../lib/db';
import { groupExercisesBySection, LIBRARY_SECTIONS, type LibrarySectionId } from '../lib/libraryMuscleGroups';
import { MUSCLE_LABELS } from '../lib/muscleLabels';
import type { Exercise, MuscleGroup } from '../lib/types';

type GenerateState = { status: 'idle' } | { status: 'generating' } | { status: 'error'; message: string };

export default function Library() {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [activeSection, setActiveSection] = useState<LibrarySectionId | null>(null);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [generation, setGeneration] = useState<GenerateState>({ status: 'idle' });
  const [created, setCreated] = useState<Exercise | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function readCache() {
      const cached = await db.exercises.toArray();
      if (!cancelled) setExercises(cached);
    }

    async function refreshFromServer() {
      try {
        await cacheExerciseLibrary();
        await readCache();
      } catch {
        // A Library cached earlier remains browsable if the refresh fails.
      }
    }

    async function load() {
      try {
        await readCache();
        if (navigator.onLine) void refreshFromServer();
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    function onOnline() {
      setOnline(true);
      void refreshFromServer();
    }
    function onOffline() {
      setOnline(false);
    }

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    void load();
    return () => {
      cancelled = true;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const groups = groupExercisesBySection(exercises);

  async function createExercise(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const section = LIBRARY_SECTIONS.find((item) => item.id === activeSection);
    const exerciseName = name.trim();
    if (!section || !exerciseName || !online || generation.status === 'generating') return;

    setGeneration({ status: 'generating' });
    setCreated(null);
    const context = `From the ${section.label} section. Use that as context only; identify all materially involved canonical muscles, including secondary muscles.`;
    const userNotes = notes.trim();
    const combinedNotes = userNotes ? `${context}\n${userNotes}` : context;

    try {
      const generated = await generateExercise(exerciseName, combinedNotes);
      await cacheExercise(generated);
      setExercises((current) =>
        [...current.filter((item) => item.slug !== generated.slug), generated].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setCreated(generated);
      setGeneration({ status: 'idle' });
      setActiveSection(null);
      setName('');
      setNotes('');
    } catch (error: unknown) {
      const message =
        error instanceof ApiError && error.status === 501
          ? "Exercise creation isn't set up on this server yet."
          : "Couldn't create that exercise — try again.";
      setGeneration({ status: 'error', message });
    }
  }

  if (loading) {
    return (
      <main className="mx-auto max-w-md p-4">
        <p className="text-sm text-ink-muted">Loading library…</p>
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="mx-auto max-w-md p-4">
        <h1 className="text-xl font-semibold text-ink">Exercise library</h1>
        <p className="mt-3 text-sm text-ink-muted">Couldn't load the local exercise library.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md space-y-4 p-4 pb-24">
      <header>
        <h1 className="text-xl font-semibold text-ink">Exercise library</h1>
        <p className="mt-1 text-sm text-ink-muted">Browse exercises by muscle group. Impact weights are shown by muscle.</p>
      </header>

      {created && <GeneratedNotice exercise={created} />}

      {exercises.length === 0 && (
        <Card>
          <p className="text-sm text-ink-muted">
            {online ? 'No exercises are cached yet. Connect to refresh the library.' : 'No exercises are cached yet. Open Today with a connection first.'}
          </p>
        </Card>
      )}

      <div className="space-y-4">
        {groups.map((group) => (
          <section key={group.id} aria-labelledby={`library-${group.id}`} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 id={`library-${group.id}`} className="text-base font-semibold text-ink">
                  {group.label}
                </h2>
                <p className="text-xs text-ink-muted">{group.exercises.length} exercises</p>
              </div>
              <button
                type="button"
                aria-label={`Add exercise to ${group.label}`}
                onClick={() => {
                  setActiveSection(activeSection === group.id ? null : group.id);
                  setGeneration({ status: 'idle' });
                  setCreated(null);
                }}
                className="min-h-12 rounded-xl bg-surface-alt px-3 text-sm font-medium text-ink"
              >
                + Add
              </button>
            </div>

            {activeSection === group.id && (
              <Card>
                <form onSubmit={createExercise} className="space-y-3">
                  <label className="block text-sm text-ink">
                    Exercise name
                    <input
                      type="text"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      required
                      className="mt-1 w-full rounded-xl bg-bg px-3 py-3 text-ink"
                    />
                  </label>
                  <label className="block text-sm text-ink">
                    Description or equipment (optional)
                    <textarea
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      rows={2}
                      className="mt-1 w-full resize-y rounded-xl bg-bg px-3 py-3 text-ink"
                    />
                  </label>
                  <p className="text-xs text-ink-muted">
                    The existing AI generator will estimate every affected muscle and its impact weight.
                  </p>
                  <button
                    type="submit"
                    disabled={!online || generation.status === 'generating' || name.trim() === ''}
                    className="min-h-12 w-full rounded-xl bg-accent px-4 py-3 font-medium text-white disabled:opacity-40"
                  >
                    {generation.status === 'generating' ? 'Creating…' : 'Create exercise'}
                  </button>
                  {!online && <p className="text-xs text-ink-muted">Creating a new exercise needs a connection — you're offline.</p>}
                  {generation.status === 'error' && <p role="alert" className="text-sm text-red-400">{generation.message}</p>}
                </form>
              </Card>
            )}

            {group.exercises.length > 0 ? (
              <div className="space-y-2">
                {group.exercises.map((exercise) => (
                  <ExerciseCard key={exercise.id} exercise={exercise} sectionMuscles={group.muscles} />
                ))}
              </div>
            ) : (
              <p className="rounded-2xl bg-surface px-4 py-3 text-sm text-ink-muted">No exercises in this group yet.</p>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}

function ExerciseCard({ exercise, sectionMuscles }: { exercise: Exercise; sectionMuscles: readonly MuscleGroup[] }) {
  const impacts = sectionMuscles
    .map((muscle) => [muscle, exercise.muscles[muscle]] as const)
    .filter((entry): entry is readonly [MuscleGroup, number] => (entry[1] ?? 0) > 0);

  return (
    <Card className={exercise.blocked ? 'opacity-70' : ''}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-ink">{exercise.name}</h3>
        {exercise.source === 'llm' && <Pill tone="accent">AI-estimated</Pill>}
        {exercise.blocked && <Pill>Blocked</Pill>}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5" aria-label={`${exercise.name} muscle impacts`}>
        {impacts.map(([muscle, weight]) => (
          <Pill key={muscle}>{MUSCLE_LABELS[muscle]} {weight.toFixed(1)}</Pill>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-muted">Pressure {exercise.pressure} · impact {exercise.impact}</p>
      {exercise.block_reason && <p className="mt-1 text-xs text-ink-muted">{exercise.block_reason}</p>}
      {exercise.caution && <p className="mt-1 text-xs text-ink-muted">{exercise.caution}</p>}
    </Card>
  );
}

function GeneratedNotice({ exercise }: { exercise: Exercise }) {
  const impacts = (Object.entries(exercise.muscles) as [MuscleGroup, number][])
    .filter(([, weight]) => weight > 0)
    .sort(([a], [b]) => MUSCLE_LABELS[a].localeCompare(MUSCLE_LABELS[b]));

  return (
    <div role="status" aria-live="polite">
      <Card className="border border-accent/40">
        <p className="text-sm font-medium text-ink">Created {exercise.name}</p>
        <p className="mt-1 text-xs text-ink-muted">AI-estimated — review before use</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {impacts.map(([muscle, weight]) => (
            <Pill key={muscle}>{MUSCLE_LABELS[muscle]} {weight.toFixed(1)}</Pill>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-muted">Pressure {exercise.pressure} · impact {exercise.impact}</p>
        {exercise.block_reason && <p className="mt-1 text-xs text-ink-muted">Blocked: {exercise.block_reason}</p>}
        {exercise.caution && <p className="mt-1 text-xs text-ink-muted">{exercise.caution}</p>}
      </Card>
    </div>
  );
}
