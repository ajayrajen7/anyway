// UX refactor: Coverage (`/coverage`) — one of the Coverage/Week Plan split
// of the old single Week View. Muscle-group coverage, total volume, and the
// pain strip, for a chosen week — navigable back/forward (previously fixed
// to "this week" only). Still fully offline (see src/lib/week.ts).
//
// Redesign (M12): rebuilt on the same Card/ProgressBar/Pill components as
// the session screens, replacing the old raw <table> — per-muscle coverage
// reads as a filled bar (actual vs. prescribed) rather than a bare ratio,
// matching the visual language the owner's reference screenshots use.
import { useEffect, useState } from 'react';
import { Card, Pill, ProgressBar, StatusDot } from '../components/ui';
import { db } from '../lib/db';
import { localDateKey } from '../lib/date';
import { MUSCLE_LABELS } from '../lib/muscleLabels';
import { getCachedProgramme } from '../lib/programmeCache';
import { getAllCachedSessionDates } from '../lib/todayCache';
import {
  buildPainStrip,
  computeActualCoverage,
  computePrescribedCoverage,
  computeWeeklyVolume,
  datesInWeek,
  nextWeek,
  previousWeek,
  round1,
  weekBoundsFor,
  type PainDot,
  type WeekBounds,
} from '../lib/week';
import type { MuscleGroup, PainLevel } from '../lib/types';

interface MuscleRow {
  muscle: MuscleGroup;
  actual: number;
  prescribed: number;
}

type State =
  | { status: 'loading' }
  | { status: 'no-programme' }
  | { status: 'ready'; rows: MuscleRow[]; volume: number; lastWeekVolume: number; pain: PainDot[] };

const PAIN_DOT_TONE: Record<PainLevel, 'accent' | 'muted'> = {
  none: 'muted',
  background: 'muted',
  noticeable: 'accent',
  limiting: 'accent',
};

// Not spec-stated: ±10% is a documented UI choice, not a transcribed number.
const ON_TARGET_BAND_PCT = 10;

export default function Coverage() {
  const thisWeek = weekBoundsFor(localDateKey());
  const [bounds, setBounds] = useState<WeekBounds>(thisWeek);
  // Keyed by the week's bounds: switching weeks mounts a fresh CoverageBody
  // whose own state starts at 'loading' naturally, rather than an effect
  // reaching back to reset state on every bounds change.
  return <CoverageBody key={bounds.start} bounds={bounds} thisWeek={thisWeek} onBoundsChange={setBounds} />;
}

function CoverageBody({ bounds, thisWeek, onBoundsChange }: { bounds: WeekBounds; thisWeek: WeekBounds; onBoundsChange: (b: WeekBounds) => void }) {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const programme = await getCachedProgramme();
      if (!programme) {
        if (!cancelled) setState({ status: 'no-programme' });
        return;
      }

      const [exercisesArr, loggedSets, sessionDateById, morningChecksArr] = await Promise.all([
        db.exercises.toArray(),
        db.loggedSets.toArray(),
        getAllCachedSessionDates(),
        db.morningChecks.toArray(),
      ]);
      const exercisesById = new Map(exercisesArr.map((e) => [e.id, e]));
      const morningChecksByDate = new Map(morningChecksArr.map((m) => [m.date, m]));

      const prescribed = computePrescribedCoverage(programme.data, exercisesById);
      const actual = computeActualCoverage(loggedSets, sessionDateById, bounds, exercisesById);
      const volume = computeWeeklyVolume(loggedSets, sessionDateById, bounds);
      const lastWeekVolume = computeWeeklyVolume(loggedSets, sessionDateById, previousWeek(bounds));
      const pain = buildPainStrip(morningChecksByDate, datesInWeek(bounds));

      const muscles = new Set<MuscleGroup>([...(Object.keys(prescribed) as MuscleGroup[]), ...(Object.keys(actual) as MuscleGroup[])]);
      const rows: MuscleRow[] = Array.from(muscles)
        .map((muscle) => ({ muscle, actual: round1(actual[muscle] ?? 0), prescribed: round1(prescribed[muscle] ?? 0) }))
        .filter((r) => r.prescribed > 0 || r.actual > 0)
        .sort((a, b) => MUSCLE_LABELS[a.muscle].localeCompare(MUSCLE_LABELS[b.muscle]));

      if (!cancelled) {
        setState({ status: 'ready', rows, volume: round1(volume), lastWeekVolume: round1(lastWeekVolume), pain });
      }
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

      <p className="mt-4 text-xs font-medium uppercase tracking-wide text-ink-muted">Sets by muscle group</p>
      <div className="mt-2 flex flex-col gap-2">
        {state.rows.map((row) => (
          <MuscleRowView key={row.muscle} row={row} />
        ))}
      </div>

      <Card className="mt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Total volume</p>
        <p className="mt-1 text-sm text-ink">
          <span className="text-xl font-semibold text-ink">{state.volume.toLocaleString()} kg</span>{' '}
          <span className="text-ink-muted">(previous week: {state.lastWeekVolume.toLocaleString()})</span>
        </p>
      </Card>

      <Card className="mt-4">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Mornings</p>
        <div className="mt-2 flex gap-2" role="img" aria-label="This week's morning pain check-ins">
          {state.pain.map((dot) => (
            <span key={dot.date} title={dot.pain ?? 'not logged'}>
              <StatusDot tone={dot.pain ? PAIN_DOT_TONE[dot.pain] : 'none'} />
            </span>
          ))}
        </div>
      </Card>
    </main>
  );
}

function MuscleRowView({ row }: { row: MuscleRow }) {
  const deltaPct = row.prescribed > 0 ? ((row.actual - row.prescribed) / row.prescribed) * 100 : 0;
  let marker = <Pill tone="accent">On target</Pill>;
  if (deltaPct > ON_TARGET_BAND_PCT) {
    marker = <Pill tone="accent">▲ +{Math.round(deltaPct)}%</Pill>;
  } else if (deltaPct < -ON_TARGET_BAND_PCT) {
    marker = <Pill>▼ {Math.round(deltaPct)}%</Pill>;
  }
  const fraction = row.prescribed > 0 ? row.actual / row.prescribed : row.actual > 0 ? 1 : 0;

  return (
    <Card>
      <div className="flex items-center justify-between">
        <span className="text-sm text-ink">{MUSCLE_LABELS[row.muscle]}</span>
        <span className="text-xs tabular-nums text-ink-muted">
          {row.actual} / {row.prescribed}
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="flex-1">
          <ProgressBar value={fraction} />
        </div>
        {marker}
      </div>
    </Card>
  );
}
