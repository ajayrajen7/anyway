// UX refactor: Week Plan (`/week`) — the Monday-to-Saturday grid half of the
// old single Week View's split. Each day is graded green (all 3 done),
// yellow (1-2 of 3), or red (none) — see src/lib/week.ts#computeDayCompletion
// for exactly what the "3" are per day kind. Sunday is deliberately not
// shown here (rest day, nothing prescribed to grade) — Coverage's pain
// strip still covers all 7 days. Navigable across weeks, fully offline.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../lib/db';
import { localDateKey, parseDateKey } from '../lib/date';
import { getCachedProgramme } from '../lib/programmeCache';
import { getAllCachedSessionDates } from '../lib/todayCache';
import {
  computeDayCompletion,
  nextWeek,
  previousWeek,
  weekBoundsFor,
  type DayCompletion,
  type WeekBounds,
} from '../lib/week';

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type State = { status: 'loading' } | { status: 'no-programme' } | { status: 'ready'; days: DayCompletion[] };

const COLOR_DOT: Record<DayCompletion['color'], string> = {
  green: 'bg-emerald-600',
  yellow: 'bg-amber-500',
  red: 'bg-slate-700',
};

export default function WeekPlan() {
  const thisWeek = weekBoundsFor(localDateKey());
  const [bounds, setBounds] = useState<WeekBounds>(thisWeek);
  // Keyed by the week's bounds, same reasoning as Coverage.tsx's split.
  return <WeekPlanBody key={bounds.start} bounds={bounds} thisWeek={thisWeek} onBoundsChange={setBounds} />;
}

function WeekPlanBody({ bounds, thisWeek, onBoundsChange }: { bounds: WeekBounds; thisWeek: WeekBounds; onBoundsChange: (b: WeekBounds) => void }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const programme = await getCachedProgramme();
      if (!programme) {
        if (!cancelled) setState({ status: 'no-programme' });
        return;
      }

      const [sessionDateById, proteinLogsArr, stepsLogsArr, cardioLogsArr, mobilityLogsArr, outboxArr] = await Promise.all([
        getAllCachedSessionDates(),
        db.proteinLogs.toArray(),
        db.stepsLogs.toArray(),
        db.cardioLogs.toArray(),
        db.mobilityLogs.toArray(),
        db.outbox.where('entity').equals('session_complete').toArray(),
      ]);
      const dateBySessionId = sessionDateById; // session_id -> date
      const completedSessionIds = new Set(outboxArr.map((o) => Number(o.entity_id)));
      const completedDates = new Set(
        Array.from(dateBySessionId.entries())
          .filter(([sessionId]) => completedSessionIds.has(sessionId))
          .map(([, date]) => date),
      );
      const proteinHitByDate = new Map(proteinLogsArr.map((p) => [p.date, p.hit]));
      const stepsByDate = new Set(stepsLogsArr.map((s) => s.date));
      const cardioDates = new Set(cardioLogsArr.map((c) => c.date));
      const mobilityDates = new Set(mobilityLogsArr.map((m) => m.date));

      const days = datesMonToSat(bounds).map((date, i) => {
        const weekday = i + 1; // 1=Mon..6=Sat
        const template = programme.data.day_templates.find((t) => t.weekday === weekday);
        const kind = template?.kind ?? 'rest';
        const mainActivityDone =
          kind === 'lifting'
            ? completedDates.has(date)
            : kind === 'cardio_mobility'
              ? cardioDates.has(date) && mobilityDates.has(date)
              : false;
        return computeDayCompletion(date, kind, {
          mainActivityDone,
          proteinHit: proteinHitByDate.get(date) === true,
          stepsLogged: stepsByDate.has(date),
        });
      });

      if (!cancelled) setState({ status: 'ready', days });
    })();
    return () => {
      cancelled = true;
    };
  }, [bounds]);

  if (state.status === 'loading') {
    return (
      <main className="mx-auto max-w-md p-4">
        <p className="text-sm text-slate-400">Loading…</p>
      </main>
    );
  }
  if (state.status === 'no-programme') {
    return (
      <main className="mx-auto max-w-md p-4">
        <p className="text-sm text-slate-400">Open Today with a connection first.</p>
      </main>
    );
  }

  const isThisWeek = bounds.start === thisWeek.start;

  return (
    <main className="mx-auto max-w-md p-4">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => onBoundsChange(previousWeek(bounds))} className="px-2 text-slate-400" aria-label="Previous week">
          ←
        </button>
        <h1 className="text-lg font-medium">{isThisWeek ? 'This Week' : `${bounds.start} – ${bounds.end}`}</h1>
        <button
          type="button"
          onClick={() => onBoundsChange(nextWeek(bounds))}
          disabled={isThisWeek}
          className="px-2 text-slate-400 disabled:opacity-30"
          aria-label="Next week"
        >
          →
        </button>
      </div>

      <ul className="mt-4 flex flex-col gap-2">
        {state.days.map((day, i) => (
          <li key={day.date} className="flex items-center justify-between rounded-md bg-slate-800 px-3 py-3">
            <span className="flex items-center gap-3">
              <span className={`h-3 w-3 rounded-full ${COLOR_DOT[day.color]}`} aria-hidden="true" />
              {WEEKDAY_NAMES[i]}
            </span>
            <span className="text-xs text-slate-400">
              {day.done} of {day.total}
            </span>
          </li>
        ))}
      </ul>

      <Link to="/coverage" className="mt-4 block text-sm text-slate-400 underline">
        View coverage →
      </Link>
    </main>
  );
}

function datesMonToSat(bounds: WeekBounds): string[] {
  const start = parseDateKey(bounds.start);
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return localDateKey(d);
  });
}
