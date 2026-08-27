// A3.1 Morning Check (`/check`) — full-screen, 4 buttons, closes on tap.
// No history, streak, graph, or encouragement text on this screen. Ever.
// No back button, no chrome (App.tsx renders this with nothing wrapping
// it), and no routing to `/` — tapping a level persists and attempts to
// close the window; only if that's a no-op (most browser contexts outside
// a real notification-launched window) does a neutral "Logged." replace
// the question, so the screen doesn't look broken.
//
// Reachability note (see memory.md): the 07:00 local notification that's
// meant to *open* this screen isn't built yet (deferred — Web Push needs
// VAPID keys, server-side subscription storage, and a real device to
// verify delivery on, none of which fit this milestone). Until then this
// route has no in-app link pointing to it either, matching prd.md's own
// framing that it's reached by notification, not navigation — it's
// reachable by URL for now.
import { useEffect, useState } from 'react';
import { localDateKey } from '../lib/date';
import { getMorningCheck, logMorningCheck } from '../lib/morningCheck';
import type { PainLevel } from '../lib/types';

const PAIN_LEVELS: { value: PainLevel; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'background', label: 'Background' },
  { value: 'noticeable', label: 'Noticeable' },
  { value: 'limiting', label: 'Limiting' },
];

type State = 'loading' | 'unanswered' | 'logged';

export default function MorningCheck() {
  const [state, setState] = useState<State>('loading');

  useEffect(() => {
    let cancelled = false;
    getMorningCheck(localDateKey()).then((existing) => {
      if (!cancelled) setState(existing ? 'logged' : 'unanswered');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function choose(pain: PainLevel) {
    await logMorningCheck(localDateKey(), pain);
    setState('logged');
    window.close(); // no-ops silently outside a script-opened window — the 'logged' state below is the fallback
  }

  return (
    <main className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      {state === 'unanswered' && (
        <>
          <h1 className="text-xl">How are the last 24 hours?</h1>
          <div className="grid w-full max-w-sm grid-cols-2 gap-3">
            {PAIN_LEVELS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                onClick={() => choose(value)}
                className="rounded-lg bg-slate-800 py-4 text-base"
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}
      {state === 'logged' && <p className="text-slate-400">Logged.</p>}
    </main>
  );
}
