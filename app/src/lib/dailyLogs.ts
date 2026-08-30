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

// --- Protein — a real yes/no, both values meaningful (unlike mobility below) ---

export async function getProteinLog(date: string) {
  return db.proteinLogs.get(date);
}

export async function logProtein(date: string, hit: boolean): Promise<void> {
  await db.transaction('rw', db.proteinLogs, db.outbox, async () => {
    await db.proteinLogs.put({ date, hit });
    await appendOutbox('protein_log', date, { date, hit });
  });
}

// --- Mobility — presence-only. There is no "log false"; unchecking deletes. ---

export async function getMobilityLog(date: string) {
  return db.mobilityLogs.get(date);
}

export async function logMobility(date: string): Promise<void> {
  await db.transaction('rw', db.mobilityLogs, db.outbox, async () => {
    await db.mobilityLogs.put({ date });
    await appendOutbox('mobility_log', date, { date });
  });
}

export async function clearMobilityLog(date: string): Promise<void> {
  await db.mobilityLogs.delete(date);
  // No outbox entry for the delete itself — M9's sync worker only ever
  // needs to know "mobility done" as a positive fact; there's nothing to
  // retract server-side once nothing was ever sent for an un-checked day.
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
