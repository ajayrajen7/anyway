// A3.2 Today (`/`) — session card, mobility checkbox, protein row (evening
// only), steps row. A3.6 Cardio/Mobility day (Wed/Sat) is rendered inline
// here too — prd.md's route table has no separate URL for it, so "route to
// the light flow" means swapping what Today shows, not navigating away.
//
// UX refactor: the header shows the weekday name (Monday..Sunday), never
// the phase's own day-template name ("Lower A"/"Lower B") — the owner
// doesn't think in phase-day labels day to day, they think in weekdays.
//
// Whole-day "Done for today" (post-M12 follow-up): once every part of the
// day is filled in, an explicit "Done for today" button appears; tapping it
// collapses the screen to one confirmation instead of staying fully
// expanded forever. The "which fields count" question reuses Week Plan's
// own definition of "done" (src/lib/week.ts#computeDayCompletion) rather
// than inventing a second one, so the two screens never disagree about what
// counts. See memory.md's "how do I save a day" / whole-day-Done entries
// for the full history: an earlier cardio/mobility-only version used its
// own local, unpersisted "closed" flag (lost on reload); the version after
// that auto-collapsed the instant every field was filled in, with no tap at
// all; the owner asked specifically for a button back — "I want a done
// button that appears after all 3 fields for a day are filled" — so the tap
// itself is now the thing that's persisted (src/lib/types.ts#DayConfirmation),
// not just the underlying field data.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Pill, PrimaryButton, primaryButtonClass } from '../components/ui';
import { ApiError, getToday } from '../lib/api';
import {
  clearCardioLog,
  clearMobilityLog,
  clearSkipDay,
  confirmDayDone,
  getCardioLog,
  getDayConfirmation,
  getMobilityLog,
  getProteinLog,
  getSkipLog,
  getStepsLog,
  logCardio,
  logMobility,
  logProteinGrams,
  logSkipDay,
  logSteps,
} from '../lib/dailyLogs';
import { localDateKey } from '../lib/date';
import { CARDIO_CONFIG, SESSION_MINUTES, WEEKDAY_NAMES } from '../lib/dayInfo';
import { cacheExerciseLibrary } from '../lib/exerciseCache';
import { MOBILITY_ITEMS } from '../lib/mobilityItems';
import { cacheProgramme } from '../lib/programmeCache';
import { runSync } from '../lib/sync';
import { cacheToday } from '../lib/todayCache';
import { computeDayCompletion, type DayKind } from '../lib/week';
import type { TodayResponse } from '../lib/types';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: TodayResponse };

export default function Today() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    // Real bug, reported live: the sync worker (src/lib/sync.ts) only ever
    // fires on a hard page load or a browser 'online' event (see main.tsx)
    // — never on an in-app route change. Finish a session, get routed back
    // here by React Router (no reload), and this screen would ask the
    // server "is this done?" before anything had told the server about the
    // completion sitting in the local outbox — showing "Start session"
    // again for a session that was, from the device's own point of view,
    // already finished. Give the outbox a chance to drain (best-effort,
    // never throws) before asking the server anything, every time this
    // screen is opened, not just on first load.
    runSync()
      .catch(() => {})
      .then(() => getToday(localDateKey()))
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
  // A day swap (post-M12 UX addition) means the *content* shown today
  // belongs to a different weekday than the calendar one — configWeekday
  // drives weekday-indexed display info (session-length estimate, cardio
  // modality/duration) so it matches what's actually being shown, while
  // `weekday`/`weekdayName` (the real calendar day) still drives the
  // header. See server/internal/dayplan, src/lib/types.ts#TodayResponse.
  const configWeekday = data.effective_weekday ?? weekday;
  // Keyed by date: a fresh calendar day means fresh "done" state, not
  // whatever the previous day's collapse happened to be.
  return (
    <DayBody
      key={date}
      kind={dayTemplate.kind}
      date={date}
      configWeekday={configWeekday}
      weekdayName={weekdayName}
      session={session}
      slotCount={slots.length}
    />
  );
}

function DayBody({
  kind,
  date,
  configWeekday,
  weekdayName,
  session,
  slotCount,
}: {
  kind: DayKind;
  date: string;
  configWeekday: number;
  weekdayName: string;
  session: TodayResponse['session'];
  slotCount: number;
}) {
  const config = CARDIO_CONFIG[configWeekday];
  const [signals, setSignals] = useState<{ mainActivityDone: boolean; proteinLogged: boolean; stepsLogged: boolean } | undefined>(undefined);
  // Whether this date has been explicitly skipped (post-M12 UX addition) —
  // a distinct, persisted, synced fact, separate from `confirmed`
  // ("Done for today" was tapped) below. Mutually exclusive in what they
  // render, but stored independently — see src/lib/dailyLogs.ts#logSkipDay.
  const [skipped, setSkipped] = useState(false);
  // Whether the "Done for today" button has actually been tapped for this
  // date — a persisted fact of its own (src/lib/types.ts#DayConfirmation),
  // deliberately separate from `signals`/`dayDone` below. All 3 fields being
  // filled in makes the button *appear*; it doesn't collapse the screen by
  // itself, on purpose — the owner asked for the explicit tap back after an
  // earlier version auto-collapsed with no button at all.
  const [confirmed, setConfirmed] = useState(false);
  // Lets you get back to the full, editable layout after it's collapsed —
  // e.g. to adjust a number you mis-tapped. Resets to false on remount (a
  // fresh visit to Today always leads with the collapsed confirmation if
  // the day is already confirmed, which is the whole point of this).
  const [forceExpanded, setForceExpanded] = useState(false);

  // Re-derives both "done" and "confirmed" from whatever's actually saved in
  // Dexie right now — never a flag of its own to fall out of sync. Passed to
  // every row below as onChange, so checking the last box makes the Done
  // button appear immediately, not just on the next reload.
  const refresh = useCallback(() => {
    Promise.all([
      getProteinLog(date),
      getStepsLog(date),
      kind === 'cardio_mobility' && config ? getCardioLog(date, config.modality) : Promise.resolve(undefined),
      kind === 'cardio_mobility' ? getMobilityLog(date) : Promise.resolve(undefined),
      getDayConfirmation(date),
      getSkipLog(date),
    ]).then(([protein, steps, cardio, mobility, confirmation, skip]) => {
      const mainActivityDone =
        kind === 'lifting' ? session?.status === 'completed' : kind === 'cardio_mobility' ? (!config || !!cardio) && !!mobility : false;
      // Any logged gram value counts, not only once it reaches the 120g
      // target — owner-confirmed change; see week.ts's comment on
      // `proteinLogged` for the full reasoning.
      setSignals({ mainActivityDone, proteinLogged: !!protein, stepsLogged: !!steps });
      setConfirmed(!!confirmation);
      setSkipped(!!skip);
    });
  }, [date, kind, config, session]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!signals) {
    return <p className="text-sm text-ink-muted">Loading…</p>;
  }

  const completion = computeDayCompletion(date, kind, signals);
  const dayDone = completion.done >= completion.total;

  async function handleConfirm() {
    await confirmDayDone(date);
    if (skipped) await clearSkipDay(date); // "Done for today" supersedes an earlier skip
    setConfirmed(true);
    setSkipped(false);
    setForceExpanded(false); // collapse immediately on tap, not just next mount
  }

  async function handleSkip() {
    await logSkipDay(date);
    setSkipped(true);
    setForceExpanded(false);
  }

  async function handleUnskip() {
    await clearSkipDay(date);
    setSkipped(false);
  }

  // Checked before the "done" collapse below: skip and done are mutually
  // exclusive states (each clears the other — see handleConfirm/handleSkip),
  // so at most one of these two collapsed views is ever reachable at a time.
  if (skipped && !forceExpanded) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">{weekdayName}</h1>
        <Card className="flex items-center justify-between">
          <Pill>⏭ Skipped</Pill>
          <button type="button" onClick={() => setForceExpanded(true)} className="text-sm text-accent underline">
            Edit
          </button>
        </Card>
      </div>
    );
  }

  if (dayDone && confirmed && !forceExpanded) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">{weekdayName}</h1>
        <Card className="flex items-center justify-between">
          <Pill tone="accent">✓ Done for today</Pill>
          <button type="button" onClick={() => setForceExpanded(true)} className="text-sm text-accent underline">
            Edit
          </button>
        </Card>
      </div>
    );
  }

  // Shown at the bottom of the expanded layout once every field for the day
  // is filled in — whether that's the first time (not yet confirmed) or
  // after tapping Edit to review a day already confirmed (re-tapping just
  // re-collapses, same handler).
  const doneButton = dayDone && (
    <PrimaryButton onClick={handleConfirm} className="w-full">
      Done for today
    </PrimaryButton>
  );

  // A "Skip day" affordance, always available in the expanded layout
  // regardless of day kind (prd.md has no lifting-only framing for this —
  // owner: skip from Today "as well as" Week Plan, for any day). Reached
  // via Edit if the day was already skipped, so it doubles as "Unskip".
  const skipButton = skipped ? (
    <button type="button" onClick={handleUnskip} className="text-center text-sm text-ink-muted underline">
      Unskip this day
    </button>
  ) : (
    <button type="button" onClick={handleSkip} className="text-center text-sm text-ink-muted underline">
      Skip this day
    </button>
  );

  if (kind === 'rest') {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">{weekdayName}</h1>
        <p className="text-sm text-ink-muted">Flat walk only. Not training — just movement.</p>
        <StepsRow date={date} onChange={refresh} />
        <ProteinRow date={date} onChange={refresh} />
        {doneButton}
        {skipButton}
      </div>
    );
  }

  if (kind === 'cardio_mobility') {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">{weekdayName}</h1>
        <CardioMobilityRows date={date} weekday={configWeekday} onChange={refresh} />
        <StepsRow date={date} onChange={refresh} />
        <ProteinRow date={date} onChange={refresh} />
        {doneButton}
        {skipButton}
      </div>
    );
  }

  // lifting day
  const minutes = SESSION_MINUTES[configWeekday];
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold">{weekdayName}</h1>
      <Card>
        <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">Today's session</p>
        <p className="mt-2 text-sm text-ink-muted">
          {slotCount} exercises{minutes ? ` · ~${minutes} min` : ''}
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
      <StepsRow date={date} onChange={refresh} />
      <ProteinRow date={date} onChange={refresh} />
      {doneButton}
      {skipButton}
    </div>
  );
}

// UX addition (post-M12): a manual 0-10 min entry, same stepper pattern as
// Steps — replaces the old plain checkbox (owner: "I can add 0 to 10 mins,
// manual entry is fine"). Capped at 10 since that's the stated routine
// length; every adjust writes/upserts a row immediately, exactly like
// StepsRow below (no separate "clear" — 0 min is itself a valid logged
// value, not distinct from "not logged"). Not part of a lifting day's
// whole-day "done" grading (matches Week Plan's own definition — a lifting
// day's "3" is session/protein/steps, mobility isn't one of them), so it
// has no onChange into the day-level refresh.
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

function ProteinRow({ date, onChange }: { date: string; onChange: () => void }) {
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
    onChange();
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

function StepsRow({ date, onChange }: { date: string; onChange: () => void }) {
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
    onChange();
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
// "Full mobility" checkbox with an expandable (unpersisted) checklist. No
// collapse of its own anymore — DayBody owns the single whole-day "Done for
// today" state now, driven by this component's onChange the same as every
// other row.
function CardioMobilityRows({ date, weekday, onChange }: { date: string; weekday: number; onChange: () => void }) {
  const config = CARDIO_CONFIG[weekday];
  const [cardioDone, setCardioDone] = useState<boolean | undefined>(undefined);
  const [minutes, setMinutes] = useState(config?.defaultMinutes ?? 20);
  const [mobilityDone, setMobilityDone] = useState<boolean | undefined>(undefined);
  const [showChecklist, setShowChecklist] = useState(false);

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
    onChange();
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
    onChange();
  }

  if (cardioDone === undefined || mobilityDone === undefined) {
    return <p className="text-sm text-ink-muted">Loading…</p>;
  }

  return (
    <>
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
    </>
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
