// The per-session overlay (swaps + ad-hoc additions) — see
// src/lib/types.ts#SessionOverlay for why this stays separate from the
// immutable todayCache snapshot.
import { db } from './db';
import type { AddedSlot, ExerciseRef, SessionOverlay, SwapOverride } from './types';

const EMPTY_OVERLAY = (sessionId: number): SessionOverlay => ({ sessionId, swaps: {}, added: [] });

export async function getOverlay(sessionId: number): Promise<SessionOverlay> {
  const existing = await db.sessionOverlay.get(sessionId);
  return existing ?? EMPTY_OVERLAY(sessionId);
}

// Tier-1 (`provenance: 'swap_in_list'`) or tier-2 (`'swap_off_list'`)
// selection on the Swap sheet (prd.md §A3.4). Keyed by the *original*
// slot's id — swapping again just replaces the same key.
export async function applySwap(
  sessionId: number,
  slotId: number,
  exercise: ExerciseRef,
  provenance: SwapOverride['provenance'],
): Promise<void> {
  const overlay = await getOverlay(sessionId);
  overlay.swaps[String(slotId)] = { exercise, provenance };
  await db.sessionOverlay.put(overlay);
}

// Add-exercise (prd.md §A3.5) — `afterKey` places it right after the
// exercise the user was on when they opened the add flow (a RunnerSlot
// key), so the session continues linearly rather than stranding the
// remaining prescribed exercises after it.
export async function addExercise(
  sessionId: number,
  exercise: ExerciseRef,
  addedBy: AddedSlot['added_by'],
  afterKey: string | null,
): Promise<AddedSlot> {
  const overlay = await getOverlay(sessionId);
  const slot: AddedSlot = {
    id: crypto.randomUUID(),
    exercise,
    sets: 3,
    reps: 10,
    load_kg: null,
    added_by: addedBy,
    after_key: afterKey,
  };
  overlay.added.push(slot);
  await db.sessionOverlay.put(overlay);
  return slot;
}
