// A3.5 Add exercise (`/session/:id/add`) — search picker, then one
// mandatory sheet: "Whose call? Trainer · Mine". Records provenance='added',
// added_by set — the single highest-value field in the app, not skippable.
// Nested under SessionRunner (see App.tsx), so the runner never loses its
// place while this is open.
import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import SheetShell from '../components/SheetShell';
import { searchExercisesOffline } from '../lib/exerciseCache';
import { addExercise } from '../lib/overlay';
import type { RunnerOutletContext } from '../lib/session';
import type { Exercise } from '../lib/types';

export default function AddExercise() {
  const navigate = useNavigate();
  const { sessionId, currentSlot, onOverlayChange } = useOutletContext<RunnerOutletContext>();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Exercise[]>([]);
  const [picked, setPicked] = useState<Exercise | null>(null); // non-null once a search result is tapped — shows the mandatory attribution step

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

  if (picked) {
    return (
      <SheetShell onClose={close}>
        <h2 className="text-sm text-slate-400">Adding {picked.name}</h2>
        <p className="mt-1 text-lg font-medium">Whose call?</p>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => confirm('trainer')} className="flex-1 rounded-md bg-slate-800 py-4">
            Trainer
          </button>
          <button type="button" onClick={() => confirm('me')} className="flex-1 rounded-md bg-slate-800 py-4">
            Mine
          </button>
        </div>
        <button type="button" onClick={() => setPicked(null)} className="mt-3 text-sm text-slate-400">
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
        className="mt-3 w-full rounded-md bg-slate-800 px-3 py-3 text-white"
      />
      <ul className="mt-2 flex flex-col gap-1">
        {results.map((r) => (
          <li key={r.id}>
            {r.blocked ? (
              <div className="w-full rounded-md bg-slate-900 px-3 py-3 text-slate-500">
                {r.name} — <span className="text-xs">{r.block_reason}</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setPicked(r)}
                className="w-full rounded-md bg-slate-800 px-3 py-3 text-left"
              >
                {r.name}
              </button>
            )}
          </li>
        ))}
      </ul>
    </SheetShell>
  );
}
