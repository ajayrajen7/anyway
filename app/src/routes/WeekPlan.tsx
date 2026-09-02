// UX refactor: Week Plan (`/week`) — the Monday-to-Saturday grid half of the
// old single Week View's split. Each day is graded green (all 3 done),
// yellow (1-2 of 3), or red (none) — see src/lib/week.ts#computeDayCompletion
// for exactly what the "3" are per day kind. Sunday is deliberately not
// shown here (rest day, nothing prescribed to grade) — Coverage's pain
// strip still covers all 7 days. Navigable across weeks, fully offline.
//
// Redesign (M12): day rows rebuilt as Cards with a StatusDot, matching the
// session screens' component language instead of a bare styled <ul>.
//
// Post-M12 UX additions (feature 1/2): a per-row Skip/Unskip action (a real,
// distinct state — src/lib/dailyLogs.ts#logSkipDay) and a tap-to-pick Swap
// action ("do Tuesday's workout on Wednesday" — server/internal/dayplan).
// Tap Swap on one day, then Swap on another day in the same week to confirm;
// tap the highlighted day again (or Swap once more) to cancel picking.
// Swapping is online-only (it changes what a *future* GET /api/today
// resolves — nothing meaningful to do with it offline) and refused by the
// server if either day already has a session (dayplan.ErrAlreadyStarted).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, StatusDot } from '../components/ui';
import { ApiError, swapDays, unswapDay } from '../lib/api';
import { db } from '../lib/db';
import { localDateKey, parseDateKey } from '../lib/date';
import { clearSkipDay, logSkipDay } from '../lib/dailyLogs';
import { cacheDaySwapsForWeek, getCachedDaySwap } from '../lib/daySwapCache';
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

const WEEKDAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface DayRow extends DayCompletion {
  sessionId: number | null; // set only for a lifting day whose session is already cached locally — see the render below for why most days won't have one
  swappedWith: string | null; // another date this week, if this day's prescription has been swapped
}

type State = { status: 'loading' } | { status: 'no-programme' } | { status: 'ready'; days: DayRow[] };

// green/red map onto the shared StatusDot tones (accent = done, none =
// nothing logged); yellow (partial) and skipped keep their own colors — a
// four-state day grade doesn't fit the two-tone accent/muted vocabulary
// StatusDot uses elsewhere, so they render directly rather than forcing a
// third/fourth tone into that shared component.
const DOT_CLASS: Record<DayCompletion['color'], string | null> = {
  green: null, // uses <StatusDot tone="accent" />
  yellow: 'bg-amber-500',
  red: null, // uses <StatusDot tone="none" />
  skipped: 'bg-slate-500',
};

export default function WeekPlan() {
  const thisWeek = weekBoundsFor(localDateKey());
  const [bounds, setBounds] = useState<WeekBounds>(thisWeek);
  // Keyed by the week's bounds, same reasoning as Coverage.tsx's split.
  return <WeekPlanBody key={bounds.start} bounds={bounds} thisWeek={thisWeek} onBoundsChange={setBounds} />;
}

function WeekPlanBody({ bounds, thisWeek, onBoundsChange }: { bounds: WeekBounds; thisWeek: WeekBounds; onBoundsChange: (b: WeekBounds) => void }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [refreshToken, setRefreshToken] = useState(0);
  // The date currently selected as the swap source, mid tap-to-pick — see
  // the file header. null = not picking.
  const [picking, setPicking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const programme = await getCachedProgramme();
      if (!programme) {
        if (!cancelled) setState({ status: 'no-programme' });
        return;
      }

      // Best-effort, non-blocking: refresh the local day-swap cache for this
      // week so DayPreview.tsx (fully offline) can honor a swap too — same
      // "try, don't block" treatment as cacheExerciseLibrary/cacheProgramme
      // on Today.tsx. A failure here (offline) just means swap tags/DayPreview
      // fall back to whatever was cached last time this week was viewed.
      try {
        await cacheDaySwapsForWeek(bounds.start, bounds.end);
      } catch (err: unknown) {
        console.error('failed to refresh day-swap cache', err);
      }

      const [sessionDateById, proteinLogsArr, stepsLogsArr, cardioLogsArr, mobilityLogsArr, outboxArr, skipLogsArr, dates] = await Promise.all([
        getAllCachedSessionDates(),
        db.proteinLogs.toArray(),
        db.stepsLogs.toArray(),
        db.cardioLogs.toArray(),
        db.mobilityLogs.toArray(),
        db.outbox.where('entity').equals('session_complete').toArray(),
        db.daySkips.toArray(),
        Promise.resolve(datesMonToSat(bounds)),
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
      // Any logged gram value counts, not only once it reaches the 120g
      // target — owner-confirmed change; see week.ts's comment on
      // `proteinLogged` for the full reasoning.
      const proteinLoggedDates = new Set(proteinLogsArr.map((p) => p.date));
      const stepsByDate = new Set(stepsLogsArr.map((s) => s.date));
      const cardioDates = new Set(cardioLogsArr.map((c) => c.date));
      const mobilityDates = new Set(mobilityLogsArr.map((m) => m.date));
      const skippedDates = new Set(skipLogsArr.map((s) => s.date));
      const swapByDate = new Map((await Promise.all(dates.map(async (d) => [d, (await getCachedDaySwap(d))?.swapped_with ?? null] as const))));

      const days: DayRow[] = dates.map((date, i) => {
        const weekday = i + 1; // 1=Mon..6=Sat
        const template = programme.data.day_templates.find((t) => t.weekday === weekday);
        const kind = template?.kind ?? 'rest';
        const skipped = skippedDates.has(date);
        const mainActivityDone =
          kind === 'lifting'
            ? completedDates.has(date)
            : kind === 'cardio_mobility'
              ? cardioDates.has(date) && mobilityDates.has(date)
              : false;
        const completion = computeDayCompletion(date, kind, {
          mainActivityDone,
          proteinLogged: proteinLoggedDates.has(date),
          stepsLogged: stepsByDate.has(date),
          skipped,
        });
        // Only a lifting day has an exercise list to navigate to at all —
        // cardio/mobility and rest days are handled entirely inline on
        // Today.tsx, with no separate /session/:id screen for them.
        return {
          ...completion,
          sessionId: kind === 'lifting' ? (sessionIdByDate.get(date) ?? null) : null,
          swappedWith: swapByDate.get(date) ?? null,
        };
      });

      if (!cancelled) setState({ status: 'ready', days });
    })();
    return () => {
      cancelled = true;
    };
  }, [bounds, refreshToken]);

  function refresh() {
    setRefreshToken((t) => t + 1);
  }

  async function handleToggleSkip(day: DayRow) {
    if (day.color === 'skipped') {
      await clearSkipDay(day.date);
    } else {
      await logSkipDay(day.date);
    }
    refresh();
  }

  async function handleSwapTap(date: string) {
    setError(null);
    if (picking === null) {
      setPicking(date);
      return;
    }
    if (picking === date) {
      setPicking(null); // tapped the already-picked day again — cancel
      return;
    }
    try {
      await swapDays(picking, date);
      setPicking(null);
      refresh();
    } catch (err: unknown) {
      setPicking(null);
      setError(err instanceof ApiError && err.status === 409 ? "Can't swap — one of these days has already been started." : "Couldn't swap those days.");
    }
  }

  async function handleUnswap(date: string) {
    setError(null);
    try {
      await unswapDay(date);
      refresh();
    } catch {
      setError("Couldn't undo that swap.");
    }
  }

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

      {picking && <p className="mt-3 text-xs text-accent">Tap another day to swap with {WEEKDAY_LABELS[dayIndex(picking, bounds)]}.</p>}
      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

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
                {WEEKDAY_LABELS[i]}
              </span>
              <span className="text-xs tabular-nums text-ink-muted">{day.color === 'skipped' ? 'Skipped' : `${day.done} of ${day.total}`}</span>
            </>
          );
          return (
            <li key={day.date}>
              <Card className="flex flex-col gap-2">
                <Link to={day.sessionId != null ? `/session/${day.sessionId}` : `/day/${day.date}`} className="flex items-center justify-between">
                  {rowContent}
                </Link>
                <div className="flex items-center gap-4 text-xs">
                  <button type="button" onClick={() => handleToggleSkip(day)} className="text-ink-muted underline">
                    {day.color === 'skipped' ? 'Unskip' : 'Skip'}
                  </button>
                  {day.swappedWith ? (
                    <button type="button" onClick={() => handleUnswap(day.date)} className="text-accent underline">
                      Swapped with {WEEKDAY_LABELS[dayIndex(day.swappedWith, bounds)] ?? day.swappedWith} — Undo
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSwapTap(day.date)}
                      className={picking === day.date ? 'text-accent underline' : 'text-ink-muted underline'}
                    >
                      {picking === day.date ? 'Cancel swap' : 'Swap'}
                    </button>
                  )}
                </div>
              </Card>
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

// Index (0=Mon..5=Sat) of `date` within the displayed week, for labeling a
// swap partner by weekday name — falls back to -1 (renders as "undefined",
// caught by `?? date` at the one call site that needs a fallback) if the
// partner happens to fall outside the currently displayed week (e.g. a swap
// spanning a week boundary — WEEKDAY_NAMES[7] below covers a Sunday partner,
// which never gets its own row here but can still be a valid swap partner).
function dayIndex(date: string, bounds: WeekBounds): number {
  const idx = datesMonToSat(bounds).indexOf(date);
  if (idx !== -1) return idx;
  return -1;
}
