// A3.2 Today (`/`) — session card, mobility checkbox, protein row (evening
// only). A3.6 Cardio/Mobility day (Wed/Sat) is rendered inline here too —
// prd.md's route table has no separate URL for it, so "route to the light
// flow" means swapping what Today shows, not navigating away.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, getToday } from '../lib/api';
import {
  clearCardioLog,
  clearMobilityLog,
  getCardioLog,
  getMobilityLog,
  getProteinLog,
  logCardio,
  logMobility,
  logProtein,
} from '../lib/dailyLogs';
import { isAfter6pm, localDateKey } from '../lib/date';
import { cacheExerciseLibrary } from '../lib/exerciseCache';
import { MOBILITY_ITEMS } from '../lib/mobilityItems';
import { cacheProgramme } from '../lib/programmeCache';
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
      {state.status === 'loading' && <p className="text-sm text-slate-400">Loading…</p>}
      {state.status === 'error' && <p className="text-sm text-red-400">{state.message}</p>}
      {state.status === 'ready' && <TodayCard data={state.data} />}
    </main>
  );
}

function TodayCard({ data }: { data: TodayResponse }) {
  const { day_template: dayTemplate, weekday, session, slots, date } = data;

  if (dayTemplate.kind === 'rest') {
    return (
      <div>
        <h1 className="text-lg font-medium">{dayTemplate.name}</h1>
        <p className="mt-2 text-sm text-slate-400">Flat walk only. Not training — just movement.</p>
        {isAfter6pm() && <ProteinRow date={date} />}
        <WeekLink />
      </div>
    );
  }

  if (dayTemplate.kind === 'cardio_mobility') {
    return (
      <div>
        <CardioMobilityDay date={date} weekday={weekday} name={dayTemplate.name} />
        {isAfter6pm() && <ProteinRow date={date} />}
        <WeekLink />
      </div>
    );
  }

  // lifting day
  const minutes = SESSION_MINUTES[weekday];
  return (
    <div>
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
      <MobilityCheckbox date={date} />
      {isAfter6pm() && <ProteinRow date={date} />}
      <WeekLink />
    </div>
  );
}

// "Any time: View this week's muscle-group coverage" (§A2) — the app has no
// persistent nav/tab bar yet (out of this milestone's scope), so this is
// the one link that makes /week actually reachable day to day.
function WeekLink() {
  return (
    <Link to="/week" className="mt-4 block text-sm text-slate-400 underline">
      This week →
    </Link>
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
    <label className="mt-4 flex items-center gap-2 text-sm text-slate-300">
      <input type="checkbox" checked={done} onChange={toggle} className="h-5 w-5" />
      Mobility (10 min)
    </label>
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
    <div className="mt-4 flex items-center justify-between rounded-md bg-slate-800 px-3 py-3">
      <span className="text-sm text-slate-300">Protein — hit 120g?</span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => choose(true)}
          className={`rounded-md px-4 py-2 text-sm ${hit === true ? 'bg-emerald-600' : 'bg-slate-700'}`}
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => choose(false)}
          className={`rounded-md px-4 py-2 text-sm ${hit === false ? 'bg-red-800' : 'bg-slate-700'}`}
        >
          No
        </button>
      </div>
    </div>
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
    return <p className="text-sm text-slate-400">Loading…</p>;
  }

  if (closed) {
    return <p className="text-slate-400">Done for today.</p>;
  }

  return (
    <div>
      <h1 className="text-lg font-medium uppercase">{name}</h1>

      {config && (
        <div className="mt-4 flex items-center justify-between rounded-md bg-slate-800 px-3 py-3">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={cardioDone} onChange={toggleCardio} className="h-5 w-5" />
            {config.label}
          </label>
          <div className="flex items-center gap-3">
            <button type="button" aria-label="Decrease minutes" onClick={() => adjustMinutes(-5)} className="h-8 w-8 rounded-full bg-slate-700">
              −
            </button>
            <span className="text-sm">{minutes} min</span>
            <button type="button" aria-label="Increase minutes" onClick={() => adjustMinutes(5)} className="h-8 w-8 rounded-full bg-slate-700">
              +
            </button>
          </div>
        </div>
      )}

      <div className="mt-2 rounded-md bg-slate-800 px-3 py-3">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input type="checkbox" checked={mobilityDone} onChange={toggleMobility} className="h-5 w-5" />
            Full mobility ({MOBILITY_ITEMS.length} items)
          </label>
          <button type="button" onClick={() => setShowChecklist((v) => !v)} className="text-sm text-slate-400 underline">
            {showChecklist ? 'Hide' : 'View'}
          </button>
        </div>
        {showChecklist && <MobilityChecklist />}
      </div>

      <button type="button" onClick={() => setClosed(true)} className="mt-4 w-full rounded-md bg-emerald-600 py-3 font-medium">
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
    <ul className="mt-2 flex flex-col gap-1 text-sm text-slate-300">
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
