// A4 Weigh-in (`/weigh`) — Sundays only, blind entry (prd.md §A4, "the
// Vault"). Sunday-only is enforced here client-side (see isSunday); the
// server never rejects a write by day of week — nothing in §B5 asks it to,
// and the invariant that actually matters (the value never comes back for
// 84 days) is enforced server-side on the *read* instead (GET /api/weigh-ins
// → 423, see docs/architecture.md §B5 and server/internal/settings).
//
// "Blind entry" here means: the number is visible *while dialing it in* —
// hiding it during entry would make it impossible to match the scale
// accurately, which would make the whole log meaningless — but the instant
// Save is tapped, it disappears and this app never shows it again. No
// confirmation, no history, no export screen in this milestone reads
// `weight_kg` back out anywhere. See memory.md (M9) for this being a
// deliberate, conservative reading of "never rendered anywhere in the UI,
// including immediately after entry".
import { useEffect, useState } from 'react';
import { isSunday, localDateKey } from '../lib/date';
import { hasWeighIn, logWeighIn } from '../lib/weighIn';

const DEFAULT_KG = 70;
const STEP_KG = 0.5;

type State =
  | { status: 'loading' }
  | { status: 'not-sunday' }
  | { status: 'entry'; value: number }
  | { status: 'saved' };

export default function WeighIn() {
  // "Not Sunday" is decided once, from an external-but-not-changing-mid-
  // session fact (today's weekday) — initialize it directly rather than via
  // an effect's setState, per the lint guidance below.
  const [state, setState] = useState<State>(() => (isSunday() ? { status: 'loading' } : { status: 'not-sunday' }));
  const today = localDateKey();

  useEffect(() => {
    if (!isSunday()) return; // already resolved to 'not-sunday' at init — nothing to load
    let cancelled = false;
    hasWeighIn(today).then((logged) => {
      if (!cancelled) setState(logged ? { status: 'saved' } : { status: 'entry', value: DEFAULT_KG });
    });
    return () => {
      cancelled = true;
    };
  }, [today]);

  function adjust(delta: number) {
    setState((prev) =>
      prev.status === 'entry' ? { status: 'entry', value: Math.round((prev.value + delta) * 10) / 10 } : prev,
    );
  }

  async function save() {
    if (state.status !== 'entry') return;
    await logWeighIn(today, state.value);
    setState({ status: 'saved' });
  }

  return (
    <main className="mx-auto max-w-md p-4">
      <h1 className="text-lg font-medium">Weigh-in</h1>

      {state.status === 'loading' && <p className="mt-2 text-sm text-slate-400">Loading…</p>}

      {state.status === 'not-sunday' && (
        <p className="mt-2 text-sm text-slate-400">Weigh-ins are Sundays only. Come back Sunday morning.</p>
      )}

      {state.status === 'entry' && (
        <div className="mt-6">
          <p className="text-sm text-slate-400">Step on the scale, then dial in the number below.</p>
          <div className="mt-6 flex items-center justify-center gap-6">
            <button
              type="button"
              aria-label="Decrease weight"
              onClick={() => adjust(-STEP_KG)}
              className="h-12 w-12 rounded-full bg-slate-700 text-xl"
            >
              −
            </button>
            <span className="min-w-24 text-center text-2xl font-semibold tabular-nums">{state.value.toFixed(1)} kg</span>
            <button
              type="button"
              aria-label="Increase weight"
              onClick={() => adjust(STEP_KG)}
              className="h-12 w-12 rounded-full bg-slate-700 text-xl"
            >
              +
            </button>
          </div>
          <button type="button" onClick={save} className="mt-8 w-full rounded-md bg-emerald-600 py-3 font-medium">
            Save
          </button>
        </div>
      )}

      {state.status === 'saved' && (
        <p className="mt-6 text-sm text-emerald-400">
          Saved. The number stays hidden until the programme's 84-day mark — that's deliberate.
        </p>
      )}
    </main>
  );
}
