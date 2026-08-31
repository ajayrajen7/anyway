// A3.4 Swap (`/session/:id/swap/:slotId`) — tier-1 `slot_swaps`, then a
// tier-2 full-library search. Nested under SessionRunner (see App.tsx) so
// applying a swap never loses the runner's place in the session.
//
// Search is offline (searchExercisesOffline, from the library Today.tsx
// cached) — this route is still under /session/*, so B2's no-network rule
// applies here too, just not B6.1's no-text-input rule (amended in M5 —
// this screen's own mockup requires a search box).
import { useEffect, useState } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router-dom';
import SheetShell from '../components/SheetShell';
import { searchExercisesOffline } from '../lib/exerciseCache';
import { applySwap } from '../lib/overlay';
import type { RunnerOutletContext } from '../lib/session';
import type { Exercise, ExerciseRef } from '../lib/types';

export default function SwapSheet() {
  const { id, slotId } = useParams<{ id: string; slotId: string }>();
  const sessionId = Number(id);
  const navigate = useNavigate();
  const { data, currentSlot, onOverlayChange } = useOutletContext<RunnerOutletContext>();

  const originalSlot = data.slots.find((s) => s.id === Number(slotId));
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Exercise[]>([]);

  useEffect(() => {
    let cancelled = false;
    // include_blocked: true — "explain, don't hide" (§A3.4): a blocked match
    // is shown greyed with its reason, not silently omitted.
    searchExercisesOffline(query, true).then((r) => {
      if (!cancelled) setResults(r);
    });
    return () => {
      cancelled = true;
    };
  }, [query]);

  if (!originalSlot) {
    return <SheetShell onClose={() => navigate('..')}>Slot not found.</SheetShell>;
  }

  async function pick(exercise: ExerciseRef, provenance: 'swap_in_list' | 'swap_off_list') {
    await applySwap(sessionId, Number(slotId), exercise, provenance);
    onOverlayChange();
    navigate('..');
  }

  return (
    <SheetShell onClose={() => navigate('..')}>
      <h2 className="text-sm text-ink-muted">Instead of {(currentSlot ?? originalSlot).exercise.name.toUpperCase()}:</h2>

      <ul className="mt-3 flex flex-col gap-1">
        {originalSlot.swaps.map((option) => (
          <li key={option.id}>
            <button
              type="button"
              onClick={() => pick(option, 'swap_in_list')}
              className="w-full rounded-md bg-surface px-3 py-3 text-left"
            >
              {option.name}
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-4 border-t border-border pt-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          aria-label="Search exercises"
          className="w-full rounded-md bg-surface px-3 py-3 text-white"
        />
        <ul className="mt-2 flex flex-col gap-1">
          {results.map((r) => (
            <li key={r.id}>
              {r.blocked ? (
                <div className="w-full rounded-md bg-bg px-3 py-3 text-ink-muted">
                  {r.name} — <span className="text-xs">{r.block_reason}</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => pick(r, 'swap_off_list')}
                  className="w-full rounded-md bg-surface px-3 py-3 text-left"
                >
                  {r.name}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </SheetShell>
  );
}
