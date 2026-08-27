// A3.7 Week View (`/week`) — the only non-capture screen in v1. Coverage
// numbers AND the 7-day pain strip render in one scroll view — never split
// into tabs/routes (§B6.5). Descriptive only: no correlation, no trend
// lines, no multi-week charts, no generated insight text (§B6.6).
//
// Computed entirely offline from Dexie (see src/lib/week.ts for why this
// isn't a GET /api/week call): the cached GET /api/programme response for
// prescribed coverage, local loggedSets/morningChecks for actual.
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
  previousWeek,
  round1,
  weekBoundsFor,
  type PainDot,
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
  | { status: 'ready'; rows: MuscleRow[]; thisWeekVolume: number; lastWeekVolume: number; pain: PainDot[] };

// Display labels only — the canonical (lowercase, underscored) names live in
// src/lib/types.ts#MUSCLE_GROUPS.
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

// Not spec-stated: the mockup shows one over-target example
// ("Glutes 17 / 14 ▲ +21%") but no threshold for what counts as "on
// target" vs. under. ±10% is a reasonable, documented choice, not a
// transcribed number.
const ON_TARGET_BAND_PCT = 10;

export default function Week() {
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

      const bounds = weekBoundsFor(localDateKey());
      const prescribed = computePrescribedCoverage(programme.data, exercisesById);
      const actual = computeActualCoverage(loggedSets, sessionDateById, bounds, exercisesById);
      const thisWeekVolume = computeWeeklyVolume(loggedSets, sessionDateById, bounds);
      const lastWeekVolume = computeWeeklyVolume(loggedSets, sessionDateById, previousWeek(bounds));
      const pain = buildPainStrip(morningChecksByDate, datesInWeek(bounds));

      const muscles = new Set<MuscleGroup>([...(Object.keys(prescribed) as MuscleGroup[]), ...(Object.keys(actual) as MuscleGroup[])]);
      const rows: MuscleRow[] = Array.from(muscles)
        .map((muscle) => ({ muscle, actual: round1(actual[muscle] ?? 0), prescribed: round1(prescribed[muscle] ?? 0) }))
        .filter((r) => r.prescribed > 0 || r.actual > 0) // a muscle nothing in the phase ever touches has nothing to show
        .sort((a, b) => MUSCLE_LABELS[a.muscle].localeCompare(MUSCLE_LABELS[b.muscle]));

      if (!cancelled) {
        setState({
          status: 'ready',
          rows,
          thisWeekVolume: round1(thisWeekVolume),
          lastWeekVolume: round1(lastWeekVolume),
          pain,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  return (
    <main className="mx-auto max-w-md p-4">
      {/* No week number shown — there's no PROGRAMME_START_DATE yet to know
          which week of the phase this is (see memory.md, tied to the same
          eventual Vault work in M9). */}
      <h1 className="text-lg font-medium">This Week</h1>

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
        Total volume <span className="font-medium text-white">{state.thisWeekVolume.toLocaleString()} kg</span>{' '}
        <span className="text-slate-400">(last week: {state.lastWeekVolume.toLocaleString()})</span>
      </p>

      {/* The pain strip renders directly below the load numbers, on this
          same screen, always — never a separate tab (§A3.7, §B6.5). */}
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
