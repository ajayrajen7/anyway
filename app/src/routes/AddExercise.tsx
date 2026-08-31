// A3.5 Add exercise (`/session/:id/add`) — search picker, then one
// mandatory sheet: "Whose call? Trainer · Mine". Records provenance='added',
// added_by set — the single highest-value field in the app, not skippable.
// Nested under SessionRunner (see App.tsx), so the runner never loses its
// place while this is open.
//
// Real-time exercise creation (memory.md's "real-time exercise creation"
// decision): when the offline search comes up empty, "Create '<query>'"
// calls POST /api/exercises/generate — the one deliberate online-only step
// in this screen. Everything else here (search, attribution, the overlay
// write) stays exactly as offline as it always was.
import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import SheetShell from '../components/SheetShell';
import { ApiError, generateExercise } from '../lib/api';
import { cacheExercise, searchExercisesOffline } from '../lib/exerciseCache';
import { addExercise } from '../lib/overlay';
import type { RunnerOutletContext } from '../lib/session';
import type { Exercise } from '../lib/types';

type GenState = { status: 'idle' } | { status: 'generating' } | { status: 'error'; message: string };

export default function AddExercise() {
  const navigate = useNavigate();
  const { sessionId, currentSlot, onOverlayChange } = useOutletContext<RunnerOutletContext>();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Exercise[]>([]);
  const [picked, setPicked] = useState<Exercise | null>(null); // non-null once a search result is tapped — shows the mandatory attribution step
  const [gen, setGen] = useState<GenState>({ status: 'idle' });
  const [online, setOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Same "explain, don't hide" treatment as the Swap search (§A3.4) —
    // A3.5 doesn't restate it, but a contraindicated exercise is exactly as
    // risky added mid-session as it is swapped in.
    searchExercisesOffline(query, true).then((r) => {
      if (!cancelled) setResults(r);
    });
    return () => {
      cancelled = true;
    };
  }, [query]);

  function close() {
    navigate('..');
  }

  async function confirm(addedBy: 'trainer' | 'me') {
    if (!picked) return;
    await addExercise(sessionId, picked, addedBy, currentSlot?.key ?? null);
    onOverlayChange();
    close();
  }

  async function createExercise() {
    const name = query.trim();
    if (!name) return;
    setGen({ status: 'generating' });
    try {
      const created = await generateExercise(name);
      await cacheExercise(created); // searchable/pickable immediately, not just after Today's next refresh
      setGen({ status: 'idle' });
      if (created.blocked) {
        // Same non-selectable treatment as a blocked search hit — refresh
        // the search so it shows up greyed with its reason, but don't
        // fall through to attribution.
        setResults((prev) => [...prev, created]);
      } else {
        setPicked(created);
      }
    } catch (err: unknown) {
      const message =
        err instanceof ApiError && err.status === 501
          ? "Exercise creation isn't set up on this server yet."
          : "Couldn't create that exercise — try again.";
      setGen({ status: 'error', message });
    }
  }

  if (picked) {
    return (
      <SheetShell onClose={close}>
        <h2 className="text-sm text-ink-muted">Adding {picked.name}</h2>
        {picked.source === 'llm' && <AiEstimatedNote exercise={picked} />}
        <p className="mt-1 text-lg font-medium">Whose call?</p>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => confirm('trainer')} className="flex-1 rounded-md bg-surface py-4">
            Trainer
          </button>
          <button type="button" onClick={() => confirm('me')} className="flex-1 rounded-md bg-surface py-4">
            Mine
          </button>
        </div>
        <button type="button" onClick={() => setPicked(null)} className="mt-3 text-sm text-ink-muted">
          ← back to search
        </button>
      </SheetShell>
    );
  }

  return (
    <SheetShell onClose={close}>
      <h2 className="text-lg font-medium">Add exercise</h2>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search…"
        aria-label="Search exercises"
        className="mt-3 w-full rounded-md bg-surface px-3 py-3 text-white"
      />
      <ul className="mt-2 flex flex-col gap-1">
        {results.map((r) => (
          <li key={r.id}>
            {r.blocked ? (
              <div className="w-full rounded-md bg-bg px-3 py-3 text-ink-muted">
                {r.name} — <span className="text-xs">{r.block_reason}</span>
                {r.source === 'llm' && <span className="ml-2 text-xs text-amber-600">AI-estimated</span>}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setPicked(r)}
                className="w-full rounded-md bg-surface px-3 py-3 text-left"
              >
                {r.name}
                {r.source === 'llm' && <span className="ml-2 text-xs text-amber-500">AI-estimated</span>}
              </button>
            )}
          </li>
        ))}
      </ul>

      {query.trim() !== '' && (
        <div className="mt-3 border-t border-border pt-3">
          {online ? (
            <button
              type="button"
              onClick={createExercise}
              disabled={gen.status === 'generating'}
              className="w-full rounded-md bg-surface px-3 py-3 text-left text-sm text-ink disabled:opacity-50"
            >
              {gen.status === 'generating' ? 'Creating…' : `Can't find it? Create "${query.trim()}"`}
            </button>
          ) : (
            <p className="text-xs text-ink-muted">Creating a new exercise needs a connection — you're offline.</p>
          )}
          {gen.status === 'error' && <p className="mt-2 text-xs text-red-400">{gen.message}</p>}
        </div>
      )}
    </SheetShell>
  );
}

// Surfaces an LLM-drafted exercise's own guess (muscles, pressure/impact,
// any caution) before the person commits to adding it — CLAUDE.md rule 8
// treats this data as injury-safety-weighted, so an AI guess gets reviewed
// at the moment of creation, not silently trusted at the same level as the
// hand-transcribed library.
function AiEstimatedNote({ exercise }: { exercise: Exercise }) {
  const muscles = Object.entries(exercise.muscles)
    .map(([m, w]) => `${m.replace('_', ' ')} ${w}`)
    .join(' · ');
  return (
    <div className="mt-2 rounded-md bg-amber-950/40 px-3 py-2 text-xs text-amber-500">
      <p className="font-medium">AI-estimated — review before use</p>
      <p className="mt-1 text-amber-400">
        {muscles || 'no muscles tagged'} · pressure {exercise.pressure} · impact {exercise.impact}
      </p>
      {exercise.caution && <p className="mt-1 text-amber-400">{exercise.caution}</p>}
    </div>
  );
}
