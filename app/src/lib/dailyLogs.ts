// Protein / mobility / cardio / steps (prd.md §A3.2, §A3.6) — offline-first
// like everything else logged so far (§B2): each write goes to its Dexie
// table + an outbox entry together.
import { db } from './db';
import type { CardioLog } from './types';

async function appendOutbox(entity: string, entityId: string, payload: unknown): Promise<void> {
  await db.outbox.add({
    entity,
    entity_id: entityId,
    payload: JSON.stringify(payload),
    created_at: new Date().toISOString(),
    synced_at: null,
  });
}

// --- Protein — a manual grams entry (UX addition, post-M12), like Steps ---
// `hit` (grams >= 120, the programme's stated daily target) is derived here
// and stored alongside `grams` so Week Plan's existing day-completion
// grading (src/lib/week.ts#computeDayCompletion) needs no changes at all.
const PROTEIN_TARGET_GRAMS = 120;

export async function getProteinLog(date: string) {
  return db.proteinLogs.get(date);
}

export async function logProteinGrams(date: string, grams: number): Promise<void> {
  const hit = grams >= PROTEIN_TARGET_GRAMS;
  await db.transaction('rw', db.proteinLogs, db.outbox, async () => {
    await db.proteinLogs.put({ date, grams, hit });
    await appendOutbox('protein_log', date, { date, grams, hit });
  });
}

// --- Mobility — a manual 0-10 min entry (UX addition, post-M12), like Steps ---
// The Wed/Sat "Full mobility" checkbox (Today.tsx#CardioMobilityDay) still
// calls this same function — it just defaults to the standard 10-min
// routine's duration when no explicit value is given, rather than writing
// pure presence.
export async function logMobility(date: string, minutes = 10): Promise<void> {
  await db.transaction('rw', db.mobilityLogs, db.outbox, async () => {
    await db.mobilityLogs.put({ date, duration_min: minutes });
    await appendOutbox('mobility_log', date, { date, duration_min: minutes });
  });
}

export async function getMobilityLog(date: string) {
  return db.mobilityLogs.get(date);
}

export async function clearMobilityLog(date: string): Promise<void> {
  await db.mobilityLogs.delete(date);
  // No outbox entry for the delete itself — same reasoning as before this
  // change: still only used by CardioMobilityDay's checkbox toggle-off, and
  // the sync worker only ever needs "mobility done" (now with a duration)
  // as a positive fact.
}

// --- Cardio — one row per (date, modality) by convention, enforced here ---

export async function getCardioLog(date: string, modality: string): Promise<CardioLog | undefined> {
  return db.cardioLogs.where('[date+modality]').equals([date, modality]).first();
}

export async function logCardio(date: string, modality: string, durationMin: number): Promise<void> {
  await db.transaction('rw', db.cardioLogs, db.outbox, async () => {
    // Replace, don't accumulate — checking the box then adjusting the
    // stepper must update the same entry, not create a second one.
    await db.cardioLogs.where('[date+modality]').equals([date, modality]).delete();
    await db.cardioLogs.add({ date, modality, duration_min: durationMin });
    await appendOutbox('cardio_log', `${date}:${modality}`, { date, modality, duration_min: durationMin });
  });
}

export async function clearCardioLog(date: string, modality: string): Promise<void> {
  await db.cardioLogs.where('[date+modality]').equals([date, modality]).delete();
}

// --- Steps — a real daily count, like protein (not presence-only like mobility) ---

export async function getStepsLog(date: string) {
  return db.stepsLogs.get(date);
}

export async function logSteps(date: string, steps: number): Promise<void> {
  await db.transaction('rw', db.stepsLogs, db.outbox, async () => {
    await db.stepsLogs.put({ date, steps });
    await appendOutbox('steps_log', date, { date, steps });
  });
}

// --- Whole-day "Done for today" confirmation (Today.tsx) — local-only, no
// outbox entry: purely a record that the button was tapped for this date,
// not domain data any other screen or the server needs. See
// src/lib/types.ts#DayConfirmation for why this needs its own persisted row
// rather than a Today.tsx-local flag (the earlier "how do I save a day" bug
// traced to exactly that mistake).

export async function getDayConfirmation(date: string) {
  return db.dayConfirmations.get(date);
}

export async function confirmDayDone(date: string): Promise<void> {
  await db.dayConfirmations.put({ date });
}
