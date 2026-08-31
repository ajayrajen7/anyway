// A3 Session summary (`/session/:id/done`) — counts, volume, optional note.
// No note field yet: this route is still under `/session/*`, so B6.1's
// "no focusable text field" rule applies here too — a note needs a
// non-keyboard input method, deferred (see memory.md).
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Card, primaryButtonClass } from '../components/ui';
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
      <h1 className="text-2xl font-semibold">Session summary</h1>
      {totals && (
        <Card className="mt-4 flex flex-col gap-1 text-sm text-ink">
          <p>{totals.doneSets} sets done</p>
          <p>{totals.skippedSets} sets skipped</p>
          <p>{totals.totalVolumeKg.toLocaleString()} kg total volume</p>
        </Card>
      )}
      <Link to="/" className={`mt-6 ${primaryButtonClass}`}>
        Done
      </Link>
    </main>
  );
}
