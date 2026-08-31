// UX refactor: the session's exercise list (`/session/:id`) — replaces the
// old one-exercise-at-a-time SessionRunner as the landing screen. Start
// from any exercise, swap or delete any exercise, right from this list.
// Nested Add sheet (see App.tsx) keeps this screen mounted while it's open,
// same reasoning as the old SessionRunner's nested sheets (M5).
import { useEffect, useState } from 'react';
import { Link, Outlet, useNavigate, useParams } from 'react-router-dom';
import { primaryButtonClass, secondaryButtonClass } from '../components/ui';
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
        <p className="text-sm text-ink-muted">Loading…</p>
      </main>
    );
  }
  if (cached === null) {
    return (
      <main className="mx-auto max-w-md p-4">
        <p className="text-sm text-ink-muted">
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
      <h1 className="text-2xl font-semibold">{cached.data.day_template.name}</h1>
      <p className="mt-1 text-sm text-ink-muted">{slots.length} exercises</p>

      {firstIncomplete && (
        <button
          type="button"
          onClick={() => navigate(`exercise/${firstIncomplete.key}`)}
          className={`mt-4 w-full ${primaryButtonClass}`}
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
        <Link to="add" className={`flex-1 text-sm ${secondaryButtonClass}`}>
          + Add exercise
        </Link>
        <Link to={`/session/${sessionId}/done`} className={`flex-1 text-sm ${secondaryButtonClass}`}>
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
    <li className={`flex items-center justify-between gap-2 rounded-2xl px-3 py-3 ${status === 'done' ? 'bg-surface/60' : 'bg-surface'}`}>
      <button type="button" onClick={onOpen} className="flex-1 text-left">
        <span className={status === 'done' ? 'text-ink-muted line-through' : 'text-ink'}>{slot.exercise.name}</span>
        <span className="ml-2 text-xs text-ink-muted">
          {slot.sets} × {slot.reps}
        </span>
        {STATUS_LABEL[status] && <span className="ml-2 text-xs text-accent">{STATUS_LABEL[status]}</span>}
      </button>
      {onSwap && (
        <button type="button" aria-label={`Swap ${slot.exercise.name}`} onClick={onSwap} className="px-2 text-ink-muted">
          ⇄
        </button>
      )}
      <button type="button" aria-label={`Delete ${slot.exercise.name}`} onClick={onDelete} className="px-2 text-ink-muted">
        🗑
      </button>
    </li>
  );
}
