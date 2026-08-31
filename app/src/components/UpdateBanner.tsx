// Shows a small manual-refresh prompt once a new deploy has taken over,
// instead of silently reloading the page the instant it's detected.
//
// Real bug fixed here: main.tsx already forces a real update check every
// time the app comes back to the foreground (see its own comment) — a
// previous version of this code then reloaded the page automatically the
// moment that check found something new. That's actively destructive here:
// a set's weight/reps stepper (SessionExercise.tsx) is only held in local
// React state until the checkmark is tapped — nothing is written to Dexie
// before that — so an automatic reload mid-edit silently discarded
// whatever had just been dialed in, with no warning. Reported live:
// "data added within an exercise (weights, reps) are not retained."
//
// Mounted once at the top of the route tree (App.tsx) so it's visible on
// every screen, session screens included — that's exactly where the old
// auto-reload was interrupting.
import { useEffect, useState } from 'react';

export default function UpdateBanner() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onControllerChange = () => setAvailable(true);
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
  }, []);

  if (!available) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-50 flex items-center justify-between gap-3 bg-accent px-4 py-2 text-sm text-white">
      <span>Update available — nothing reloads until you tap Refresh.</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="shrink-0 rounded-md bg-white/20 px-3 py-1 font-medium"
      >
        Refresh
      </button>
    </div>
  );
}
