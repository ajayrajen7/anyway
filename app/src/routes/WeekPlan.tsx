// UX refactor: Week Plan (`/week`) — the Monday-to-Saturday grid half of the
// old single Week View's split. Each day is graded green (all 3 done),
// yellow (1-2 of 3), or red (none) — see src/lib/week.ts#computeDayCompletion
// for exactly what the "3" are per day kind. Sunday is deliberately not
// shown here (rest day, nothing prescribed to grade) — Coverage's pain
// strip still covers all 7 days. Navigable across weeks, fully offline.
//
// Redesign (M12): day rows rebuilt as Cards with a StatusDot, matching the
// session screens' component language instead of a bare styled <ul>.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, StatusDot } from '../components/ui';
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

interface DayRow extends DayCompletion {
  sessionId: number | null; // set only for a lifting day whose session is already cached locally — see the render below for why most days won't have one
}

type State = { status: 'loading' } | { status: 'no-programme' } | { status: 'ready'; days: DayRow[] };

// green/red map onto the shared StatusDot tones (accent = done, none =
// nothing logged); yellow (partial) keeps its own amber — a three-state
// day grade doesn't fit the two-tone accent/muted vocabulary StatusDot
// uses elsewhere, so it renders directly rather than forcing a third tone
// into that shared component.
const DOT_CLASS: Record<DayCompletion['color'], string | null> = {
  green: null, // uses <StatusDot tone="accent" />
  yellow: 'bg-amber-500',
  red: null, // uses <StatusDot tone="none" />
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
      // The reverse lookup — only ever populated for dates that have
      // actually been opened as "Today" at some point (todayCache is
      // written by Today.tsx, once per date it's loaded for; a day this
      // week that hasn't been reached yet simply has no session_id to link
      // to, offline or not — see the render below for how that's handled).
      const sessionIdByDate = new Map(Array.from(dateBySessionId.entries()).map(([sessionId, date]) => [date, sessionId]));
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

      const days: DayRow[] = datesMonToSat(bounds).map((date, i) => {
        const weekday = i + 1; // 1=Mon..6=Sat
        const template = programme.data.day_templates.find((t) => t.weekday === weekday);
        const kind = template?.kind ?? 'rest';
        const mainActivityDone =
          kind === 'lifting'
            ? completedDates.has(date)
            : kind === 'cardio_mobility'
              ? cardioDates.has(date) && mobilityDates.has(date)
              : false;
        const completion = computeDayCompletion(date, kind, {
          mainActivityDone,
          proteinHit: proteinHitByDate.get(date) === true,
          stepsLogged: stepsByDate.has(date),
        });
        // Only a lifting day has an exercise list to navigate to at all —
        // cardio/mobility and rest days are handled entirely inline on
        // Today.tsx, with no separate /session/:id screen for them.
        return { ...completion, sessionId: kind === 'lifting' ? (sessionIdByDate.get(date) ?? null) : null };
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
        <p className="text-sm text-ink-muted">Loading…</p>
      </main>
    );
  }
  if (state.status === 'no-programme') {
    return (
      <main className="mx-auto max-w-md p-4">
        <p className="text-sm text-ink-muted">Open Today with a connection first.</p>
      </main>
    );
  }

  const isThisWeek = bounds.start === thisWeek.start;

  return (
    <main className="mx-auto max-w-md p-4">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => onBoundsChange(previousWeek(bounds))} className="px-2 text-ink-muted" aria-label="Previous week">
          ←
        </button>
        <h1 className="text-lg font-medium">{isThisWeek ? 'This Week' : `${bounds.start} – ${bounds.end}`}</h1>
        <button
          type="button"
          onClick={() => onBoundsChange(nextWeek(bounds))}
          disabled={isThisWeek}
          className="px-2 text-ink-muted disabled:opacity-30"
          aria-label="Next week"
        >
          →
        </button>
      </div>

      {/* Every row links somewhere: the real session if one's already
          cached (today, or an earlier day this week already opened as
          Today), otherwise a read-only preview of what's prescribed
          (/day/:date, sourced from the offline programme cache — no
          session needed to look, just to log). */}
      <ul className="mt-4 flex flex-col gap-2">
        {state.days.map((day, i) => {
          const rowContent = (
            <>
              <span className="flex items-center gap-3 text-ink">
                {DOT_CLASS[day.color] ? (
                  <span className={`inline-block h-3 w-3 rounded-full ${DOT_CLASS[day.color]}`} aria-hidden="true" />
                ) : (
                  <StatusDot tone={day.color === 'green' ? 'accent' : 'none'} />
                )}
                {WEEKDAY_NAMES[i]}
              </span>
              <span className="text-xs tabular-nums text-ink-muted">
                {day.done} of {day.total}
              </span>
            </>
          );
          return (
            <li key={day.date}>
              <Link to={day.sessionId != null ? `/session/${day.sessionId}` : `/day/${day.date}`}>
                <Card className="flex items-center justify-between">{rowContent}</Card>
              </Link>
            </li>
          );
        })}
      </ul>

      <Link to="/coverage" className="mt-4 block text-sm text-accent underline">
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
