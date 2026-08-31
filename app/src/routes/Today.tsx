// A3.2 Today (`/`) — session card, mobility checkbox, protein row (evening
// only), steps row. A3.6 Cardio/Mobility day (Wed/Sat) is rendered inline
// here too — prd.md's route table has no separate URL for it, so "route to
// the light flow" means swapping what Today shows, not navigating away.
//
// UX refactor: the header shows the weekday name (Monday..Sunday), never
// the phase's own day-template name ("Lower A"/"Lower B") — the owner
// doesn't think in phase-day labels day to day, they think in weekdays.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, primaryButtonClass } from '../components/ui';
import { ApiError, getToday } from '../lib/api';
import {
  clearCardioLog,
  clearMobilityLog,
  getCardioLog,
  getMobilityLog,
  getProteinLog,
  getStepsLog,
  logCardio,
  logMobility,
  logProtein,
  logSteps,
} from '../lib/dailyLogs';
import { isAfter6pm, localDateKey } from '../lib/date';
import { cacheExerciseLibrary } from '../lib/exerciseCache';
import { MOBILITY_ITEMS } from '../lib/mobilityItems';
import { cacheProgramme } from '../lib/programmeCache';
import { cacheToday } from '../lib/todayCache';
import type { TodayResponse } from '../lib/types';

const WEEKDAY_NAMES: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};

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

// Cardio modality + starting duration per docs/programme.md's weekly
// structure. Wed's 20 min matches §A3.6's own mockup literally; Sat's 15 min
// is the programme's stated week-1 starting point (no week-by-week
// progression exists in the data model, so there's just the one default —
// see memory.md).
const CARDIO_CONFIG: Record<number, { label: string; modality: string; defaultMinutes: number }> = {
  3: { label: 'Cross trainer', modality: 'cross-trainer', defaultMinutes: 20 },
  6: { label: 'Incline walk', modality: 'incline-walk', defaultMinutes: 15 },
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
        // Best-effort, non-blocking: refresh the offline exercise-search
        // cache for the Swap/Add screens. A failure here shouldn't block
        // Today from rendering — it just means that cache stays stale.
        cacheExerciseLibrary().catch((err: unknown) => {
          console.error('failed to refresh offline exercise cache', err);
        });
        // Same best-effort treatment for the Week View's prescribed-coverage cache.
        cacheProgramme().catch((err: unknown) => {
          console.error('failed to refresh offline programme cache', err);
        });
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
      {state.status === 'loading' && <p className="text-sm text-ink-muted">Loading…</p>}
      {state.status === 'error' && <p className="text-sm text-red-400">{state.message}</p>}
      {state.status === 'ready' && <TodayCard data={state.data} />}
    </main>
  );
}

function TodayCard({ data }: { data: TodayResponse }) {
  const { day_template: dayTemplate, weekday, session, slots, date } = data;
  const weekdayName = WEEKDAY_NAMES[weekday] ?? dayTemplate.name;

  if (dayTemplate.kind === 'rest') {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">{weekdayName}</h1>
        <p className="text-sm text-ink-muted">Flat walk only. Not training — just movement.</p>
        <StepsRow date={date} />
        {isAfter6pm() && <ProteinRow date={date} />}
      </div>
    );
  }

  if (dayTemplate.kind === 'cardio_mobility') {
    return (
      <div className="flex flex-col gap-3">
        <CardioMobilityDay date={date} weekday={weekday} name={weekdayName} />
        <StepsRow date={date} />
        {isAfter6pm() && <ProteinRow date={date} />}
      </div>
    );
  }

  // lifting day
  const minutes = SESSION_MINUTES[weekday];
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold">{weekdayName}</h1>
      <Card>
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Today's session</p>
        <p className="mt-2 text-sm text-ink-muted">
          {slots.length} exercises{minutes ? ` · ~${minutes} min` : ''}
        </p>
        {session && (
          <Link to={`/session/${session.id}`} className={`mt-4 w-full ${primaryButtonClass}`}>
            Start session
          </Link>
        )}
      </Card>
      <MobilityCheckbox date={date} />
      <StepsRow date={date} />
      {isAfter6pm() && <ProteinRow date={date} />}
    </div>
  );
}

function MobilityCheckbox({ date }: { date: string }) {
  const [done, setDone] = useState<boolean | undefined>(undefined); // undefined = loading

  useEffect(() => {
    let cancelled = false;
    getMobilityLog(date).then((log) => {
      if (!cancelled) setDone(!!log);
    });
    return () => {
      cancelled = true;
    };
  }, [date]);

  async function toggle() {
    if (done) {
      await clearMobilityLog(date);
      setDone(false);
    } else {
      await logMobility(date);
      setDone(true);
    }
  }

  if (done === undefined) return null;

  return (
    <Card>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={done} onChange={toggle} className="h-5 w-5" />
        Mobility (10 min)
      </label>
    </Card>
  );
}

function ProteinRow({ date }: { date: string }) {
  const [hit, setHit] = useState<boolean | null | undefined>(undefined); // undefined = loading, null = unanswered

  useEffect(() => {
    let cancelled = false;
    getProteinLog(date).then((log) => {
      if (!cancelled) setHit(log ? log.hit : null);
    });
    return () => {
      cancelled = true;
    };
  }, [date]);

  async function choose(value: boolean) {
    await logProtein(date, value);
    setHit(value);
  }

  if (hit === undefined) return null;

  return (
    <Card className="flex items-center justify-between">
      <span className="text-sm text-ink">Protein — hit 120g?</span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => choose(true)}
          className={`rounded-lg px-4 py-2 text-sm ${hit === true ? 'bg-accent text-white' : 'bg-surface-alt text-ink'}`}
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => choose(false)}
          className={`rounded-lg px-4 py-2 text-sm ${hit === false ? 'bg-red-800 text-white' : 'bg-surface-alt text-ink'}`}
        >
          No
        </button>
      </div>
    </Card>
  );
}

// UX refactor: a manual step count, alongside protein — a real number, not
// a target-hit yes/no (no step target exists anywhere in the spec).
const STEPS_INCREMENT = 500;

function StepsRow({ date }: { date: string }) {
  const [steps, setSteps] = useState<number | undefined>(undefined); // undefined = loading

  useEffect(() => {
    let cancelled = false;
    getStepsLog(date).then((log) => {
      if (!cancelled) setSteps(log?.steps ?? 0);
    });
    return () => {
      cancelled = true;
    };
  }, [date]);

  async function adjust(delta: number) {
    const next = Math.max(0, (steps ?? 0) + delta);
    setSteps(next);
    await logSteps(date, next);
  }

  if (steps === undefined) return null;

  return (
    <Card className="flex items-center justify-between">
      <span className="text-sm text-ink">Steps</span>
      <div className="flex items-center gap-3">
        <button type="button" aria-label="Decrease steps" onClick={() => adjust(-STEPS_INCREMENT)} className="h-8 w-8 rounded-full bg-surface-alt">
          −
        </button>
        <span className="text-sm tabular-nums">{steps.toLocaleString()}</span>
        <button type="button" aria-label="Increase steps" onClick={() => adjust(STEPS_INCREMENT)} className="h-8 w-8 rounded-full bg-surface-alt">
          +
        </button>
      </div>
    </Card>
  );
}

// A3.6 — checkbox + duration stepper for the day's cardio modality, a
// "Full mobility" checkbox with an expandable (unpersisted) checklist, and
// a Done button. Minimal path is 3 taps: cardio checkbox, mobility
// checkbox, Done.
function CardioMobilityDay({ date, weekday, name }: { date: string; weekday: number; name: string }) {
  const config = CARDIO_CONFIG[weekday];
  const [cardioDone, setCardioDone] = useState<boolean | undefined>(undefined);
  const [minutes, setMinutes] = useState(config?.defaultMinutes ?? 20);
  const [mobilityDone, setMobilityDone] = useState<boolean | undefined>(undefined);
  const [showChecklist, setShowChecklist] = useState(false);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([config ? getCardioLog(date, config.modality) : Promise.resolve(undefined), getMobilityLog(date)]).then(
      ([cardio, mobility]) => {
        if (cancelled) return;
        setCardioDone(!!cardio);
        if (cardio) setMinutes(cardio.duration_min);
        setMobilityDone(!!mobility);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [date, config]);

  async function toggleCardio() {
    if (!config) return;
    if (cardioDone) {
      await clearCardioLog(date, config.modality);
      setCardioDone(false);
    } else {
      await logCardio(date, config.modality, minutes);
      setCardioDone(true);
    }
  }

  async function adjustMinutes(delta: number) {
    if (!config) return;
    const next = Math.max(0, minutes + delta);
    setMinutes(next);
    if (cardioDone) {
      await logCardio(date, config.modality, next); // keep the logged entry in sync while checked
    }
  }

  async function toggleMobility() {
    if (mobilityDone) {
      await clearMobilityLog(date);
      setMobilityDone(false);
    } else {
      await logMobility(date);
      setMobilityDone(true);
    }
  }

  if (cardioDone === undefined || mobilityDone === undefined) {
    return <p className="text-sm text-ink-muted">Loading…</p>;
  }

  if (closed) {
    return <p className="text-ink-muted">Done for today.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold">{name}</h1>

      {config && (
        <Card className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={cardioDone} onChange={toggleCardio} className="h-5 w-5" />
            {config.label}
          </label>
          <div className="flex items-center gap-3">
            <button type="button" aria-label="Decrease minutes" onClick={() => adjustMinutes(-5)} className="h-8 w-8 rounded-full bg-surface-alt">
              −
            </button>
            <span className="text-sm">{minutes} min</span>
            <button type="button" aria-label="Increase minutes" onClick={() => adjustMinutes(5)} className="h-8 w-8 rounded-full bg-surface-alt">
              +
            </button>
          </div>
        </Card>
      )}

      <Card>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={mobilityDone} onChange={toggleMobility} className="h-5 w-5" />
            Full mobility ({MOBILITY_ITEMS.length} items)
          </label>
          <button type="button" onClick={() => setShowChecklist((v) => !v)} className="text-sm text-accent underline">
            {showChecklist ? 'Hide' : 'View'}
          </button>
        </div>
        {showChecklist && <MobilityChecklist />}
      </Card>

      <button type="button" onClick={() => setClosed(true)} className={`w-full ${primaryButtonClass}`}>
        Done
      </button>
    </div>
  );
}

// Individual ticks are optional and unpersisted (§A3.6) — the schema has no
// per-item field, only mobility_logs(date) for "done at all today".
function MobilityChecklist() {
  const [ticked, setTicked] = useState<Set<number>>(new Set());

  function toggle(i: number) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  return (
    <ul className="mt-2 flex flex-col gap-1 text-sm text-ink">
      {MOBILITY_ITEMS.map((item, i) => (
        <li key={item}>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={ticked.has(i)} onChange={() => toggle(i)} className="h-4 w-4" />
            {item}
          </label>
        </li>
      ))}
    </ul>
  );
}
