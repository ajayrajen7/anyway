// UX refactor: the session's exercise list (`/session/:id`) — replaces the
// old one-exercise-at-a-time SessionRunner as the landing screen. Start
// from any exercise, swap or delete any exercise, right from this list.
// Nested Add sheet (see App.tsx) keeps this screen mounted while it's open,
// same reasoning as the old SessionRunner's nested sheets (M5).
import { useEffect, useState } from 'react';
import { Link, Outlet, useNavigate, useParams } from 'react-router-dom';
import { getCachedToday } from '../lib/todayCache';
import { getOverlay, removeExercise } from '../lib/overlay';
import { loggedSetsForSession } from '../lib/outbox';
import { buildRunnerSlots, computeSlotStatus, type RunnerOutletContext, type RunnerSlot, type SlotStatus } from '../lib/session';
import type { CachedToday, LoggedSet, SessionOverlay } from '../lib/types';

export default function SessionOverview() {
  const { id } = useParams<{ id: string }>();
  const sessionId = Number(id);
  const navigate = useNavigate();

  const [cached, setCached] = useState<CachedToday | null | undefined>(undefined); // undefined = loading
  const [overlay, setOverlay] = useState<SessionOverlay | undefined>(undefined);
  const [loggedSets, setLoggedSets] = useState<LoggedSet[]>([]);

  useEffect(() => {
    let cancelled = false;
    getCachedToday(sessionId).then((c) => {
      if (!cancelled) setCached(c ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  function refresh() {
    getOverlay(sessionId).then(setOverlay);
    loggedSetsForSession(sessionId).then(setLoggedSets);
  }
  useEffect(refresh, [sessionId]);

  if (cached === undefined || overlay === undefined) {
    return (
      <main className="mx-auto max-w-md p-4">
        <p className="text-sm text-slate-400">Loading…</p>
      </main>
    );
  }
  if (cached === null) {
    return (
      <main className="mx-auto max-w-md p-4">
        <p className="text-sm text-slate-400">
          Session not available offline yet — open Today with a connection first.
        </p>
      </main>
    );
  }

  const slots = buildRunnerSlots(cached.data, overlay);

  async function onDelete(key: string) {
    await removeExercise(sessionId, key);
    refresh();
  }

  const firstIncomplete = slots.find((s) => status(s) !== 'done') ?? slots[0];

  function status(slot: RunnerSlot): SlotStatus {
    const setsForExercise = loggedSets.filter((s) => s.exercise_id === slot.exercise.id);
    return computeSlotStatus(setsForExercise, slot.sets);
  }

  return (
    <main className="mx-auto max-w-md p-4">
      <h1 className="text-lg font-medium">{cached.data.day_template.name}</h1>
      <p className="text-sm text-slate-400">{slots.length} exercises</p>

      {firstIncomplete && (
        <button
          type="button"
          onClick={() => navigate(`exercise/${firstIncomplete.key}`)}
          className="mt-4 w-full rounded-md bg-emerald-600 py-3 font-medium"
        >
          Start
        </button>
      )}

      <ul className="mt-4 flex flex-col gap-2">
        {slots.map((slot) => (
          <SlotRow
            key={slot.key}
            slot={slot}
            status={status(slot)}
            onOpen={() => navigate(`exercise/${slot.key}`)}
            onSwap={slot.slotId != null ? () => navigate(`exercise/${slot.key}/swap/${slot.slotId}`) : undefined}
            onDelete={() => onDelete(slot.key)}
          />
        ))}
      </ul>

      <div className="mt-4 flex gap-2">
        <Link to="add" className="flex-1 rounded-md bg-slate-800 py-3 text-center text-sm">
          + Add exercise
        </Link>
        <Link to={`/session/${sessionId}/done`} className="flex-1 rounded-md bg-slate-800 py-3 text-center text-sm">
          Finish session →
        </Link>
      </div>

      <Outlet context={{ sessionId, data: cached.data, currentSlot: undefined, onOverlayChange: refresh } satisfies RunnerOutletContext} />
    </main>
  );
}

const STATUS_LABEL: Record<SlotStatus, string> = { pending: '', in_progress: 'in progress', done: 'done' };

function SlotRow({
  slot,
  status,
  onOpen,
  onSwap,
  onDelete,
}: {
  slot: RunnerSlot;
  status: SlotStatus;
  onOpen: () => void;
  onSwap: (() => void) | undefined;
  onDelete: () => void;
}) {
  return (
    <li className={`flex items-center justify-between gap-2 rounded-md px-3 py-3 ${status === 'done' ? 'bg-slate-800/50' : 'bg-slate-800'}`}>
      <button type="button" onClick={onOpen} className="flex-1 text-left">
        <span className={status === 'done' ? 'text-slate-500 line-through' : ''}>{slot.exercise.name}</span>
        <span className="ml-2 text-xs text-slate-400">
          {slot.sets} × {slot.reps}
        </span>
        {STATUS_LABEL[status] && <span className="ml-2 text-xs text-emerald-500">{STATUS_LABEL[status]}</span>}
      </button>
      {onSwap && (
        <button type="button" aria-label={`Swap ${slot.exercise.name}`} onClick={onSwap} className="px-2 text-slate-500">
          ⇄
        </button>
      )}
      <button type="button" aria-label={`Delete ${slot.exercise.name}`} onClick={onDelete} className="px-2 text-slate-500">
        🗑
      </button>
    </li>
  );
}
