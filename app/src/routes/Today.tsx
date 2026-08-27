// A3.2 Today (`/`) — session card, mobility checkbox, protein row (evening only).
// TODO(M6): mobility checkbox. TODO(M7): protein row (after 18:00).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, getToday } from '../lib/api';
import { localDateKey } from '../lib/date';
import { cacheToday } from '../lib/todayCache';
import type { TodayResponse } from '../lib/types';

// Fixed weekly session-length estimates from docs/programme.md Part 2 —
// display-only, not stored anywhere (duration isn't part of the data model).
const SESSION_MINUTES: Record<number, number> = {
  1: 55, // Mon — Lower A
  2: 50, // Tue — Upper A (Push)
  3: 45, // Wed — Mobility + Zone 2
  4: 55, // Thu — Lower B
  5: 50, // Fri — Upper B (Pull)
  6: 45, // Sat — Mobility + Incline Walk
};

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: TodayResponse };

export default function Today() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    getToday(localDateKey())
      .then(async (data) => {
        await cacheToday(data); // so the session runner can run with no signal
        if (!cancelled) setState({ status: 'ready', data });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof ApiError ? err.message : 'Could not load today.';
        setState({ status: 'error', message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto max-w-md p-4">
      {state.status === 'loading' && <p className="text-sm text-slate-400">Loading…</p>}
      {state.status === 'error' && <p className="text-sm text-red-400">{state.message}</p>}
      {state.status === 'ready' && <TodayCard data={state.data} />}
    </main>
  );
}

function TodayCard({ data }: { data: TodayResponse }) {
  const { day_template: dayTemplate, weekday, session, slots } = data;

  if (dayTemplate.kind === 'rest') {
    return (
      <div>
        <h1 className="text-lg font-medium">{dayTemplate.name}</h1>
        <p className="mt-2 text-sm text-slate-400">Flat walk only. Not training — just movement.</p>
      </div>
    );
  }

  if (dayTemplate.kind === 'cardio_mobility') {
    return (
      <div>
        <h1 className="text-lg font-medium">{dayTemplate.name}</h1>
        <p className="mt-2 text-sm text-slate-400">Cardio + mobility logging arrives in a later milestone.</p>
      </div>
    );
  }

  // lifting day
  const minutes = SESSION_MINUTES[weekday];
  return (
    <div className="rounded-lg bg-slate-800 p-4">
      <h1 className="text-lg font-medium">{dayTemplate.name}</h1>
      <p className="mt-1 text-sm text-slate-400">
        {slots.length} exercises{minutes ? ` · ~${minutes} min` : ''}
      </p>
      {session && (
        <Link
          to={`/session/${session.id}`}
          className="mt-4 inline-block rounded-md bg-emerald-600 px-4 py-3 text-center font-medium"
        >
          Start session
        </Link>
      )}
    </div>
  );
}
