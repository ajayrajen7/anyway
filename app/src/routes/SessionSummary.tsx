// A3 Session summary (`/session/:id/done`) — counts, volume, optional note.
// No note field yet: this route is still under `/session/*`, so B6.1's
// "no focusable text field" rule applies here too — a note needs a
// non-keyboard input method, deferred (see memory.md).
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { completeSession, loggedSetsForSession } from '../lib/outbox';
import { computeSessionTotals, type SessionTotals } from '../lib/session';

export default function SessionSummary() {
  const { id } = useParams<{ id: string }>();
  const sessionId = Number(id);
  const [totals, setTotals] = useState<SessionTotals | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loggedSetsForSession(sessionId), completeSession(sessionId)]).then(([sets]) => {
      if (!cancelled) setTotals(computeSessionTotals(sets));
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return (
    <main className="mx-auto max-w-md p-4">
      <h1 className="text-lg font-medium">Session summary</h1>
      {totals && (
        <div className="mt-4 space-y-1 text-sm text-slate-300">
          <p>{totals.doneSets} sets done</p>
          <p>{totals.skippedSets} sets skipped</p>
          <p>{totals.totalVolumeKg.toLocaleString()} kg total volume</p>
        </div>
      )}
      <Link to="/" className="mt-6 inline-block rounded-md bg-emerald-600 px-4 py-3 font-medium">
        Done
      </Link>
    </main>
  );
}
