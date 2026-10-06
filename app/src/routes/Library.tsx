import { useEffect, useState, type FormEvent } from 'react';
import { Card, Pill } from '../components/ui';
import { ApiError, archiveExercise, generateExercise } from '../lib/api';
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
  const [expandedSections, setExpandedSections] = useState<Set<LibrarySectionId>>(() => new Set());
  const [archivingId, setArchivingId] = useState<number | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);
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

  const groups = groupExercisesBySection(exercises.filter((exercise) => exercise.active !== false));

  function toggleSection(id: LibrarySectionId) {
    setExpandedSections((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function archiveFromLibrary(exercise: Exercise) {
    setArchiveError(null);
    if (!online || !navigator.onLine) {
      setArchiveError('A connection is required to archive an exercise.');
      return;
    }
    if (archivingId !== null) return;
    if (!window.confirm(`Archive ${exercise.name} from the exercise catalogue and future search choices? This leaves existing plans and history intact.`)) return;
    setArchivingId(exercise.id);
    try {
      await archiveExercise(exercise.id);
      await db.exercises.update(exercise.id, { active: false });
      setExercises((current) => current.map((item) => item.id === exercise.id ? { ...item, active: false } : item));
    } catch {
      setArchiveError("Couldn't archive that exercise. Please try again with a connection.");
    } finally {
      setArchivingId(null);
    }
  }

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
      {archiveError && <p role="alert" className="text-sm text-red-400">{archiveError}</p>}

      {exercises.length === 0 && (
        <Card>
          <p className="text-sm text-ink-muted">
            {online ? 'No exercises are cached yet. Connect to refresh the library.' : 'No exercises are cached yet. Open Today with a connection first.'}
          </p>
        </Card>
      )}

      <div className="space-y-4">
        {groups.map((group) => (
          <section key={group.id} aria-label={group.label} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h2 id={`library-${group.id}`} className="min-w-0 flex-1 text-base font-semibold text-ink">
                <button
                  type="button"
                  aria-label={`${group.label}, ${group.exercises.length} exercises`}
                  aria-expanded={expandedSections.has(group.id)}
                  aria-controls={`library-${group.id}-content`}
                  onClick={() => toggleSection(group.id)}
                  className="flex min-h-12 w-full items-center justify-between gap-2 text-left"
                >
                  <span><span className="block">{group.label}</span><span className="block text-xs font-normal text-ink-muted">{group.exercises.length} exercises</span></span>
                  <span aria-hidden="true" className={expandedSections.has(group.id) ? 'rotate-180' : ''}>▾</span>
                </button>
              </h2>
              <button
                type="button"
                aria-label={`Add exercise to ${group.label}`}
                onClick={() => {
                  setActiveSection(activeSection === group.id ? null : group.id);
                  setExpandedSections((current) => new Set(current).add(group.id));
                  setGeneration({ status: 'idle' });
                  setCreated(null);
                }}
                className="min-h-12 rounded-xl bg-surface-alt px-3 text-sm font-medium text-ink"
              >
                + Add
              </button>
            </div>

            <div id={`library-${group.id}-content`} hidden={!expandedSections.has(group.id)}>
            {expandedSections.has(group.id) && activeSection === group.id && (
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

            {expandedSections.has(group.id) && (group.exercises.length > 0 ? (
              <div className="space-y-2">
                {group.exercises.map((exercise) => (
                  <ExerciseCard key={exercise.id} exercise={exercise} sectionMuscles={group.muscles} onArchive={() => void archiveFromLibrary(exercise)} archiving={archivingId === exercise.id} />
                ))}
              </div>
            ) : (
              <p className="rounded-2xl bg-surface px-4 py-3 text-sm text-ink-muted">No exercises in this group yet.</p>
            ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

function ExerciseCard({ exercise, sectionMuscles, onArchive, archiving }: { exercise: Exercise; sectionMuscles: readonly MuscleGroup[]; onArchive: () => void; archiving: boolean }) {
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
      <button type="button" onClick={onArchive} disabled={archiving} aria-label={`Archive ${exercise.name}`} className="mt-3 min-h-11 rounded-xl bg-surface-alt px-3 text-sm text-ink disabled:opacity-40">
        {archiving ? 'Archiving…' : 'Archive'}
      </button>
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
