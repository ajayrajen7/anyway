// UX refactor: Coverage (`/coverage`) — one of the Coverage/Week Plan split
// of the old single Week View. Muscle-group coverage, total volume, and the
// pain strip, for a chosen week — navigable back/forward (previously fixed
// to "this week" only). Still fully offline (see src/lib/week.ts).
import { useEffect, useState } from 'react';
import { db } from '../lib/db';
import { localDateKey } from '../lib/date';
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

const MUSCLE_LABELS: Record<MuscleGroup, string> = {
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  adductors: 'Adductors',
  calves: 'Calves',
  tibialis: 'Tibialis',
  foot: 'Foot',
  erectors: 'Erectors',
  chest: 'Chest',
  lats: 'Lats',
  upper_back: 'Upper back',
  delts_front: 'Front delts',
  delts_side: 'Side delts',
  delts_rear: 'Rear delts',
  biceps: 'Biceps',
  triceps: 'Triceps',
  core: 'Core',
};

const PAIN_COLOR: Record<PainLevel, string> = {
  none: 'text-emerald-500',
  background: 'text-yellow-500',
  noticeable: 'text-orange-500',
  limiting: 'text-red-600',
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

      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="text-left text-slate-400">
            <th className="pb-2 font-normal">Sets by muscle group</th>
            <th className="pb-2 text-right font-normal">actual / prescribed</th>
            <th className="pb-2 pl-2 font-normal" aria-hidden="true"></th>
          </tr>
        </thead>
        <tbody>
          {state.rows.map((row) => (
            <MuscleRowView key={row.muscle} row={row} />
          ))}
        </tbody>
      </table>

      <p className="mt-6 text-sm text-slate-300">
        Total volume <span className="font-medium text-white">{state.volume.toLocaleString()} kg</span>{' '}
        <span className="text-slate-400">(previous week: {state.lastWeekVolume.toLocaleString()})</span>
      </p>

      <div className="mt-6">
        <p className="text-sm text-slate-400">Mornings</p>
        <div className="mt-1 flex gap-2 text-xl" role="img" aria-label="This week's morning pain check-ins">
          {state.pain.map((dot) => (
            <span key={dot.date} className={dot.pain ? PAIN_COLOR[dot.pain] : 'text-slate-600'} title={dot.pain ?? 'not logged'}>
              {dot.pain ? '●' : '○'}
            </span>
          ))}
        </div>
      </div>
    </main>
  );
}

function MuscleRowView({ row }: { row: MuscleRow }) {
  const deltaPct = row.prescribed > 0 ? ((row.actual - row.prescribed) / row.prescribed) * 100 : 0;
  let marker = <span className="text-emerald-500">●</span>;
  if (deltaPct > ON_TARGET_BAND_PCT) {
    marker = <span className="text-amber-500">▲ +{Math.round(deltaPct)}%</span>;
  } else if (deltaPct < -ON_TARGET_BAND_PCT) {
    marker = <span className="text-slate-400">▼ {Math.round(deltaPct)}%</span>;
  }

  return (
    <tr>
      <td className="py-1">{MUSCLE_LABELS[row.muscle]}</td>
      <td className="py-1 text-right tabular-nums">
        {row.actual} / {row.prescribed}
      </td>
      <td className="py-1 pl-2 text-right">{marker}</td>
    </tr>
  );
}
