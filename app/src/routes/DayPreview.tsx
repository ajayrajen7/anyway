// Read-only preview of a day's prescribed exercises (`/day/:date`) —
// reached from Week Plan for any weekday that doesn't have a session yet
// (a day later this week, or an earlier day that was never opened as
// Today). Sourced entirely from the offline programme + exercise caches,
// same as Coverage/Week Plan — no session, no network, nothing writable.
//
// Deliberately doesn't try to solve for "what if the programme changes
// before this day arrives" (no versioning, no snapshotting) — it just
// shows the *current* cached programme's prescription for that weekday,
// same as Today.tsx would if you opened it that day. If the programme
// changes in the meantime, the preview changes too; that's the accepted
// tradeoff for keeping this simple (owner: "needn't be very complicated
// with solving for versioning etc").
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, Pill } from '../components/ui';
import { db } from '../lib/db';
import { isoWeekday } from '../lib/date';
import { CARDIO_CONFIG, SESSION_MINUTES, WEEKDAY_NAMES } from '../lib/dayInfo';
import { MOBILITY_ITEMS } from '../lib/mobilityItems';
import { getCachedProgramme } from '../lib/programmeCache';
import type { Exercise, ProgrammeDayTemplate } from '../lib/types';

type State =
  | { status: 'loading' }
  | { status: 'no-programme' }
  | { status: 'ready'; template: ProgrammeDayTemplate | undefined; exercisesById: Map<number, Exercise> };

export default function DayPreview() {
  const { date } = useParams<{ date: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const programme = await getCachedProgramme();
      if (!programme) {
        if (!cancelled) setState({ status: 'no-programme' });
        return;
      }
      const weekday = isoWeekday(date!);
      const template = programme.data.day_templates.find((t) => t.weekday === weekday);
      const exercisesArr = await db.exercises.toArray();
      if (!cancelled) {
        setState({ status: 'ready', template, exercisesById: new Map(exercisesArr.map((e) => [e.id, e])) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date]);

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

  const weekday = isoWeekday(date!);
  const weekdayName = WEEKDAY_NAMES[weekday] ?? date;
  const kind = state.template?.kind ?? 'rest';

  return (
    <main className="mx-auto max-w-md p-4">
      <button type="button" onClick={() => navigate(-1)} className="text-sm text-ink-muted" aria-label="Back">
        ← Week Plan
      </button>

      <div className="mt-2 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{weekdayName}</h1>
        <Pill>Preview</Pill>
      </div>

      {kind === 'lifting' && <LiftingPreview template={state.template} exercisesById={state.exercisesById} minutes={SESSION_MINUTES[weekday]} />}
      {kind === 'cardio_mobility' && <CardioMobilityPreview weekday={weekday} />}
      {kind === 'rest' && <p className="mt-4 text-sm text-ink-muted">Flat walk only. Not training — just movement.</p>}
    </main>
  );
}

function LiftingPreview({
  template,
  exercisesById,
  minutes,
}: {
  template: ProgrammeDayTemplate | undefined;
  exercisesById: Map<number, Exercise>;
  minutes: number | undefined;
}) {
  const slots = template?.slots ?? [];
  return (
    <>
      <p className="mt-1 text-sm text-ink-muted">
        {slots.length} exercises{minutes ? ` · ~${minutes} min` : ''}
      </p>
      <ul className="mt-4 flex flex-col gap-2">
        {slots.map((slot) => (
          <li key={slot.id}>
            <Card className="flex items-center justify-between">
              <span className="text-ink">{exercisesById.get(slot.exercise_id)?.name ?? `Exercise #${slot.exercise_id}`}</span>
              <span className="text-xs text-ink-muted">
                {slot.sets} × {slot.reps}
                {slot.load_kg != null ? ` @ ${slot.load_kg} kg` : ''}
              </span>
            </Card>
          </li>
        ))}
      </ul>
    </>
  );
}

function CardioMobilityPreview({ weekday }: { weekday: number }) {
  const config = CARDIO_CONFIG[weekday];
  return (
    <div className="mt-4 flex flex-col gap-2">
      {config && (
        <Card>
          <span className="text-ink">
            {config.label} · {config.defaultMinutes} min
          </span>
        </Card>
      )}
      <Card>
        <span className="text-ink">Full mobility ({MOBILITY_ITEMS.length} items)</span>
      </Card>
    </div>
  );
}
