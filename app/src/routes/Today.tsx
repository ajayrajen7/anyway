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
import { Card, Pill, primaryButtonClass } from '../components/ui';
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
  logProteinGrams,
  logSteps,
} from '../lib/dailyLogs';
import { localDateKey } from '../lib/date';
import { CARDIO_CONFIG, SESSION_MINUTES, WEEKDAY_NAMES } from '../lib/dayInfo';
import { cacheExerciseLibrary } from '../lib/exerciseCache';
import { MOBILITY_ITEMS } from '../lib/mobilityItems';
import { cacheProgramme } from '../lib/programmeCache';
import { cacheToday } from '../lib/todayCache';
import type { TodayResponse } from '../lib/types';

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
        <ProteinRow date={date} />
      </div>
    );
  }

  if (dayTemplate.kind === 'cardio_mobility') {
    return (
      <div className="flex flex-col gap-3">
        <CardioMobilityDay date={date} weekday={weekday} name={weekdayName} />
        <StepsRow date={date} />
        <ProteinRow date={date} />
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
        {session?.status === 'completed' ? (
          <div className="mt-4 flex items-center justify-between">
            <Pill tone="accent">✓ Session complete</Pill>
            <Link to={`/session/${session.id}`} className="text-sm text-accent underline">
              View session
            </Link>
          </div>
        ) : (
          session && (
            <Link to={`/session/${session.id}`} className={`mt-4 w-full ${primaryButtonClass}`}>
              Start session
            </Link>
          )
        )}
      </Card>
      <MobilityRow date={date} />
      <StepsRow date={date} />
      <ProteinRow date={date} />
    </div>
  );
}

// UX addition (post-M12): a manual 0-10 min entry, same stepper pattern as
// Steps — replaces the old plain checkbox (owner: "I can add 0 to 10 mins,
// manual entry is fine"). Capped at 10 since that's the stated routine
// length; every adjust writes/upserts a row immediately, exactly like
// StepsRow below (no separate "clear" — 0 min is itself a valid logged
// value, not distinct from "not logged").
const MOBILITY_MAX_MINUTES = 10;

function MobilityRow({ date }: { date: string }) {
  const [minutes, setMinutes] = useState<number | undefined>(undefined); // undefined = loading

  useEffect(() => {
    let cancelled = false;
    getMobilityLog(date).then((log) => {
      if (!cancelled) setMinutes(log?.duration_min ?? 0);
    });
    return () => {
      cancelled = true;
    };
  }, [date]);

  async function adjust(delta: number) {
    const next = Math.max(0, Math.min(MOBILITY_MAX_MINUTES, (minutes ?? 0) + delta));
    setMinutes(next);
    await logMobility(date, next);
  }

  if (minutes === undefined) return null;

  return (
    <Card className="flex items-center justify-between">
      <span className="text-sm text-ink">Mobility</span>
      <div className="flex items-center gap-3">
        <button type="button" aria-label="Decrease mobility minutes" onClick={() => adjust(-1)} className="h-8 w-8 rounded-full bg-surface-alt">
          −
        </button>
        <span className="text-sm tabular-nums">{minutes} min</span>
        <button type="button" aria-label="Increase mobility minutes" onClick={() => adjust(1)} className="h-8 w-8 rounded-full bg-surface-alt">
          +
        </button>
      </div>
    </Card>
  );
}

// UX addition (post-M12): a manual grams entry, same stepper pattern as
// Steps — replaces the old Yes/No buttons (owner: "similarly add another
// manual entry for protein"). `hit` (grams >= 120) is still derived and
// synced under the hood so Week Plan's grading is untouched — see
// dailyLogs.ts#logProteinGrams. The old evening-only gate (isAfter6pm) was
// removed in the same follow-up, once the owner tried logging it earlier in
// the day and found nothing there — shown all day now, same as Steps/Mobility.
const PROTEIN_INCREMENT_GRAMS = 10;

function ProteinRow({ date }: { date: string }) {
  const [grams, setGrams] = useState<number | undefined>(undefined); // undefined = loading

  useEffect(() => {
    let cancelled = false;
    getProteinLog(date).then((log) => {
      if (!cancelled) setGrams(log?.grams ?? 0);
    });
    return () => {
      cancelled = true;
    };
  }, [date]);

  async function adjust(delta: number) {
    const next = Math.max(0, (grams ?? 0) + delta);
    setGrams(next);
    await logProteinGrams(date, next);
  }

  if (grams === undefined) return null;

  return (
    <Card className="flex items-center justify-between">
      <span className="text-sm text-ink">Protein</span>
      <div className="flex items-center gap-3">
        <button type="button" aria-label="Decrease protein grams" onClick={() => adjust(-PROTEIN_INCREMENT_GRAMS)} className="h-8 w-8 rounded-full bg-surface-alt">
          −
        </button>
        <span className="text-sm tabular-nums">{grams} g</span>
        <button type="button" aria-label="Increase protein grams" onClick={() => adjust(PROTEIN_INCREMENT_GRAMS)} className="h-8 w-8 rounded-full bg-surface-alt">
          +
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

// A3.6 — checkbox + duration stepper for the day's cardio modality, and a
// "Full mobility" checkbox with an expandable (unpersisted) checklist.
// "Done for today" is derived from those two checkboxes, not a separate
// tap or a separate saved flag — each checkbox already persists the
// instant it's tapped (logCardio/logMobility), same as every other
// checkbox/stepper in this app; there's nothing extra to "save". A
// previous version had a third, explicit "Done" button whose collapsed
// state lived only in local React state and was forgotten on reload —
// reported live as "how do I save a day, that button is missing" once a
// reopen showed the checkboxes again instead of the confirmation. Fixed by
// removing the separate flag entirely: minimal path is still 2 taps
// (cardio checkbox, mobility checkbox), and it now stays "done" correctly
// across any reload, reopen, or deploy, since it's reading the same
// already-saved data every time — no time-of-day logic involved anywhere.
function CardioMobilityDay({ date, weekday, name }: { date: string; weekday: number; name: string }) {
  const config = CARDIO_CONFIG[weekday];
  const [cardioDone, setCardioDone] = useState<boolean | undefined>(undefined);
  const [minutes, setMinutes] = useState(config?.defaultMinutes ?? 20);
  const [mobilityDone, setMobilityDone] = useState<boolean | undefined>(undefined);
  const [showChecklist, setShowChecklist] = useState(false);
  // Lets you get back to the checkboxes after they've collapsed — e.g. to
  // uncheck something you tapped by mistake. Resets to false on remount
  // (a fresh visit to Today always shows the collapsed "Done" view first
  // if both are already checked, exactly what was missing before).
  const [forceExpanded, setForceExpanded] = useState(false);

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

  const bothDone = (!config || cardioDone) && mobilityDone;
  if (bothDone && !forceExpanded) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">{name}</h1>
        <Card className="flex items-center justify-between">
          <Pill tone="accent">✓ Done for today</Pill>
          <button type="button" onClick={() => setForceExpanded(true)} className="text-sm text-accent underline">
            Edit
          </button>
        </Card>
      </div>
    );
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
