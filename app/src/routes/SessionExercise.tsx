// UX refactor: one exercise, full screen (`/session/:id/exercise/:key`) —
// reached from SessionOverview's list, not stepped through sequentially.
// "Next" still advances to the next exercise in list order for a quick
// consecutive flow, but there's always a way back to the list to jump
// anywhere else (browser/back nav) — this screen no longer owns "which
// exercise am I on", the URL does.
//
// HARD RULE (B6.1, amended M5): no <input type="number"> or any focusable
// text field anywhere in *this* screen. Steppers only — enforced by a test.
// The nested Swap sheet (rendered via <Outlet/>) is a documented exception
// with its own search input — see docs/architecture.md §B6.1's amendment.
//
// Offline-first (B2): reads exclusively from the Dexie cache written by
// Today.tsx (getCachedToday) plus the per-session overlay (M5) and
// already-logged sets — never calls the API.
import { useEffect, useState } from 'react';
import { Link, Outlet, useNavigate, useParams } from 'react-router-dom';
import { Card, Pill, ProgressBar, primaryButtonClass, secondaryButtonClass } from '../components/ui';
import { getCachedToday } from '../lib/todayCache';
import { getOverlay } from '../lib/overlay';
import { loggedSetsFor, logSet } from '../lib/outbox';
import { buildRunnerSlots, clampNonNegative, isSwipeLeft, prefillFor, type RunnerOutletContext, type RunnerSlot } from '../lib/session';
import type { CachedToday, LoggedSet, SessionOverlay } from '../lib/types';

type RowStatus = 'pending' | 'done' | 'skipped';
interface RowState {
  status: RowStatus;
  loadKg: number | null;
  reps: number;
  editing: 'weight' | 'reps' | null;
}

function rowFromExisting(existing: LoggedSet | undefined, slot: RunnerSlot): RowState {
  if (existing) {
    return { status: existing.status, loadKg: existing.load_kg, reps: existing.reps ?? 0, editing: null };
  }
  const prefill = prefillFor(slot);
  return { status: 'pending', loadKg: prefill.loadKg, reps: prefill.reps, editing: null };
}

export default function SessionExercise() {
  const { id, key } = useParams<{ id: string; key: string }>();
  const sessionId = Number(id);
  const navigate = useNavigate();

  const [cached, setCached] = useState<CachedToday | null | undefined>(undefined);
  const [overlay, setOverlay] = useState<SessionOverlay | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getCachedToday(sessionId).then((c) => {
      if (!cancelled) setCached(c ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  function refreshOverlay() {
    getOverlay(sessionId).then(setOverlay);
  }
  useEffect(refreshOverlay, [sessionId]);

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
  const index = slots.findIndex((s) => s.key === key);
  const slot = slots[index];

  if (!slot) {
    return (
      <main className="mx-auto max-w-md p-4">
        <p className="text-sm text-ink-muted">Exercise not found — it may have been deleted from this session.</p>
      </main>
    );
  }

  function goToList() {
    navigate(`/session/${sessionId}`);
  }

  function advance() {
    const next = slots[index + 1];
    if (next) {
      navigate(`/session/${sessionId}/exercise/${next.key}`);
    } else {
      goToList();
    }
  }

  return (
    <main className="mx-auto max-w-md p-4">
      <div className="flex items-center justify-between">
        <button type="button" onClick={goToList} className="text-sm text-ink-muted" aria-label="Back to exercise list">
          ← Exercises
        </button>
        <p className="text-sm text-ink-muted">
          {index + 1} of {slots.length}
        </p>
      </div>
      <div className="mt-2">
        <ProgressBar value={(index + 1) / slots.length} />
      </div>

      {/* Keyed by slot.key: switching exercises (or swapping the current
          one) mounts a fresh panel with its own rows/rest-timer state. */}
      <ExercisePanel key={slot.key} sessionId={sessionId} slot={slot} isLast={index >= slots.length - 1} onAdvance={advance} />

      <Outlet context={{ sessionId, data: cached.data, currentSlot: slot, onOverlayChange: refreshOverlay } satisfies RunnerOutletContext} />
    </main>
  );
}

function ExercisePanel({
  sessionId,
  slot,
  isLast,
  onAdvance,
}: {
  sessionId: number;
  slot: RunnerSlot;
  isLast: boolean;
  onAdvance: () => void;
}) {
  const [rows, setRows] = useState<RowState[]>([]);
  const [rowsReady, setRowsReady] = useState(false);
  const [restSince, setRestSince] = useState<string | null>(null);

  // Reconstruct this exercise's row state from Dexie on every visit — never
  // trust only in-memory state (B2: Dexie is the source of truth, not a
  // cache of it).
  useEffect(() => {
    let cancelled = false;
    loggedSetsFor(sessionId, slot.exercise.id).then((existingBySetIndex) => {
      if (cancelled) return;
      const nextRows: RowState[] = [];
      for (let i = 1; i <= slot.sets; i++) {
        nextRows.push(rowFromExisting(existingBySetIndex.get(i), slot));
      }
      setRows(nextRows);
      setRowsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, slot]);

  async function commitRow(rowIndex: number, status: 'done' | 'skipped') {
    const row = rows[rowIndex];
    const logged = status === 'done' ? { loadKg: row.loadKg, reps: row.reps } : { loadKg: null, reps: null };
    await logSet({
      sessionId,
      slotId: slot.slotId,
      exerciseId: slot.exercise.id,
      setIndex: rowIndex + 1,
      loadKg: logged.loadKg,
      reps: logged.reps,
      status,
      provenance: slot.provenance,
      addedBy: slot.addedBy,
    });
    setRows((prev) => prev.map((r, i) => (i === rowIndex ? { ...r, status, editing: null } : r)));
    if (status === 'done') setRestSince(new Date().toISOString());
  }

  async function skipExercise() {
    await Promise.all(rows.map((r, i) => (r.status === 'pending' ? commitRow(i, 'skipped') : Promise.resolve())));
    onAdvance();
  }

  function updateRow(rowIndex: number, patch: Partial<RowState>) {
    setRows((prev) => prev.map((r, i) => (i === rowIndex ? { ...r, ...patch } : r)));
  }

  return (
    <>
      <h1 className="mt-3 text-2xl font-semibold uppercase">{slot.exercise.name}</h1>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {slot.provenance === 'added' && <Pill tone="accent">Added — {slot.addedBy === 'trainer' ? "trainer's call" : 'my call'}</Pill>}
        {slot.note && <Pill>{slot.note}</Pill>}
      </div>

      <Card className="mt-3">
        <p className="text-sm text-ink-muted">
          Prescribed: {slot.sets} × {slot.reps} {slot.loadKg != null ? `@ ${slot.loadKg} kg` : ''}
        </p>
        {slot.lastActual && (
          <p className="mt-1 text-sm text-ink-muted">
            Last time: {slot.sets} × {slot.lastActual.reps} {slot.lastActual.load_kg != null ? `@ ${slot.lastActual.load_kg} kg` : ''}
          </p>
        )}
      </Card>

      {restSince && <RestTimer since={restSince} />}

      <div className="mt-4 flex flex-col gap-2">
        {rowsReady ? (
          rows.map((row, i) => (
            <SetRow
              key={i}
              index={i}
              row={row}
              incrementKg={slot.exercise.increment_kg}
              onUpdate={(patch) => updateRow(i, patch)}
              onCommit={() => commitRow(i, 'done')}
              onSwipeSkip={() => commitRow(i, 'skipped')}
            />
          ))
        ) : (
          <p className="text-sm text-ink-muted">Loading sets…</p>
        )}
      </div>

      <div className="mt-6 flex justify-between gap-2">
        {slot.slotId != null ? (
          <Link to={`swap/${slot.slotId}`} className={`flex-1 ${secondaryButtonClass}`}>
            Swap
          </Link>
        ) : (
          <span className="flex-1" /> // an added exercise has no slot to swap
        )}
        <button type="button" onClick={skipExercise} disabled={!rowsReady} className={`flex-1 ${secondaryButtonClass}`}>
          Skip
        </button>
        <button type="button" onClick={onAdvance} disabled={!rowsReady} className={`flex-1 ${primaryButtonClass}`}>
          {isLast ? '← List' : 'Next →'}
        </button>
      </div>
    </>
  );
}

function RestTimer({ since }: { since: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const intervalId = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(intervalId);
  }, []);
  const elapsedSec = Math.max(0, Math.floor((now - new Date(since).getTime()) / 1000));
  const mm = Math.floor(elapsedSec / 60);
  const ss = String(elapsedSec % 60).padStart(2, '0');
  return (
    <p aria-live="polite" className="mt-2 text-xs text-ink-muted">
      Rest: {mm}:{ss}
    </p>
  );
}

function SetRow({
  index,
  row,
  incrementKg,
  onUpdate,
  onCommit,
  onSwipeSkip,
}: {
  index: number;
  row: RowState;
  incrementKg: number;
  onUpdate: (patch: Partial<RowState>) => void;
  onCommit: () => void;
  onSwipeSkip: () => void;
}) {
  // Track both axes, not just X — see isSwipeLeft's own doc comment for the
  // real bug this fixes: an ordinary vertical scroll past a pending row
  // could carry >80px of horizontal thumb drift and silently skip it.
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);

  if (row.status !== 'pending') {
    return (
      <div
        data-testid={`set-row-${index}`}
        className="flex items-center justify-between rounded-2xl bg-surface/60 px-3 py-4 text-ink-muted line-through"
      >
        <span>Set {index + 1}</span>
        <span>
          {row.loadKg != null ? `${row.loadKg} kg` : 'BW'} × {row.reps}
        </span>
        <span className="text-xs no-underline">{row.status}</span>
      </div>
    );
  }

  return (
    <div
      data-testid={`set-row-${index}`}
      className="flex items-center justify-between rounded-2xl bg-surface px-3 py-4"
      onPointerDown={(e) => setDragStart({ x: e.clientX, y: e.clientY })}
      onPointerUp={(e) => {
        if (dragStart != null && isSwipeLeft(e.clientX - dragStart.x, e.clientY - dragStart.y)) {
          onSwipeSkip();
        }
        setDragStart(null);
      }}
      onPointerCancel={() => setDragStart(null)}
    >
      <span>Set {index + 1}</span>

      {row.editing === 'weight' ? (
        <span className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Decrease weight"
            className="h-12 w-12 rounded-full bg-surface-alt"
            onClick={() => onUpdate({ loadKg: clampNonNegative((row.loadKg ?? 0) - incrementKg) })}
          >
            −
          </button>
          <span>{row.loadKg ?? 0} kg</span>
          <button
            type="button"
            aria-label="Increase weight"
            className="h-12 w-12 rounded-full bg-surface-alt"
            onClick={() => onUpdate({ loadKg: clampNonNegative((row.loadKg ?? 0) + incrementKg) })}
          >
            +
          </button>
        </span>
      ) : (
        <button type="button" onClick={() => onUpdate({ editing: 'weight' })} className="px-2">
          {row.loadKg != null ? `${row.loadKg} kg` : 'BW'}
        </button>
      )}

      <span>×</span>

      {row.editing === 'reps' ? (
        <span className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Decrease reps"
            className="h-12 w-12 rounded-full bg-surface-alt"
            onClick={() => onUpdate({ reps: clampNonNegative(row.reps - 1) })}
          >
            −
          </button>
          <span>{row.reps}</span>
          <button
            type="button"
            aria-label="Increase reps"
            className="h-12 w-12 rounded-full bg-surface-alt"
            onClick={() => onUpdate({ reps: clampNonNegative(row.reps + 1) })}
          >
            +
          </button>
        </span>
      ) : (
        <button type="button" onClick={() => onUpdate({ editing: 'reps' })} className="px-2">
          {row.reps}
        </button>
      )}

      <button
        type="button"
        aria-label={`Log set ${index + 1}`}
        onClick={onCommit}
        className="ml-2 flex h-16 w-16 items-center justify-center rounded-full bg-accent text-xl text-white"
      >
        ✓
      </button>
    </div>
  );
}
