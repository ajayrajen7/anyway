import { afterEach, describe, expect, it } from 'vitest';
import { db } from './db';
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
} from './dailyLogs';

afterEach(async () => {
  await db.proteinLogs.clear();
  await db.mobilityLogs.clear();
  await db.cardioLogs.clear();
  await db.stepsLogs.clear();
  await db.outbox.clear();
});

// UX addition (post-M12): protein is now a manual grams entry (like Steps),
// not a Yes/No — `hit` (grams >= 120) is derived and stored alongside it so
// Week Plan's existing grading needs no changes.
describe('protein', () => {
  it('records a real gram count, derives hit, and queues an outbox entry', async () => {
    await logProteinGrams('2026-01-05', 140);
    expect(await getProteinLog('2026-01-05')).toEqual({ date: '2026-01-05', grams: 140, hit: true });

    const outboxRows = await db.outbox.where({ entity: 'protein_log', entity_id: '2026-01-05' }).toArray();
    expect(outboxRows).toHaveLength(1);
    expect(JSON.parse(outboxRows[0].payload)).toEqual({ date: '2026-01-05', grams: 140, hit: true });
  });

  it('below the 120g target derives hit: false, not absence', async () => {
    await logProteinGrams('2026-01-05', 60);
    expect(await getProteinLog('2026-01-05')).toEqual({ date: '2026-01-05', grams: 60, hit: false });
  });

  it('re-logging the same date replaces rather than accumulates', async () => {
    await logProteinGrams('2026-01-05', 60);
    await logProteinGrams('2026-01-05', 130);
    expect(await getProteinLog('2026-01-05')).toEqual({ date: '2026-01-05', grams: 130, hit: true });
  });

  it('is undefined (absent) for an unlogged date', async () => {
    expect(await getProteinLog('2026-01-06')).toBeUndefined();
  });
});

// UX addition (post-M12): mobility is now a manual 0-10 min entry (like
// Steps), not a plain checkbox — see Today.tsx#MobilityRow. The Wed/Sat
// "Full mobility" checkbox still uses logMobility/clearMobilityLog too,
// now defaulting to a 10-min duration when no explicit value is given.
describe('mobility', () => {
  it('records a real minute count, and queues an outbox entry', async () => {
    await logMobility('2026-01-05', 4);
    expect(await getMobilityLog('2026-01-05')).toEqual({ date: '2026-01-05', duration_min: 4 });

    const outboxRows = await db.outbox.where({ entity: 'mobility_log', entity_id: '2026-01-05' }).toArray();
    expect(outboxRows).toHaveLength(1);
    expect(JSON.parse(outboxRows[0].payload)).toEqual({ date: '2026-01-05', duration_min: 4 });
  });

  it('re-logging the same date replaces rather than accumulates', async () => {
    await logMobility('2026-01-05', 2);
    await logMobility('2026-01-05', 9);
    expect(await getMobilityLog('2026-01-05')).toEqual({ date: '2026-01-05', duration_min: 9 });
  });

  it('defaults to a 10-min duration when none is given (the Full-mobility checkbox flow)', async () => {
    await logMobility('2026-01-07');
    expect(await getMobilityLog('2026-01-07')).toEqual({ date: '2026-01-07', duration_min: 10 });
  });

  it('clearing (unchecking) deletes the row rather than writing a negative value', async () => {
    await logMobility('2026-01-05', 4);
    await clearMobilityLog('2026-01-05');
    expect(await getMobilityLog('2026-01-05')).toBeUndefined();
  });

  it('is undefined for an unlogged date', async () => {
    expect(await getMobilityLog('2026-01-06')).toBeUndefined();
  });
});

describe('cardio', () => {
  it('logs a modality+duration for a date, queuing an outbox entry', async () => {
    await logCardio('2026-01-07', 'cross-trainer', 20);
    expect(await getCardioLog('2026-01-07', 'cross-trainer')).toMatchObject({ date: '2026-01-07', modality: 'cross-trainer', duration_min: 20 });

    const outboxRows = await db.outbox.where({ entity: 'cardio_log', entity_id: '2026-01-07:cross-trainer' }).toArray();
    expect(outboxRows).toHaveLength(1);
  });

  it('re-logging the same date+modality replaces the entry rather than accumulating', async () => {
    await logCardio('2026-01-07', 'cross-trainer', 20);
    await logCardio('2026-01-07', 'cross-trainer', 25);

    const all = await db.cardioLogs.where({ date: '2026-01-07', modality: 'cross-trainer' }).toArray();
    expect(all).toHaveLength(1);
    expect(all[0].duration_min).toBe(25);
  });

  it('does not conflate two different modalities on the same date', async () => {
    await logCardio('2026-01-10', 'incline-walk', 15);
    expect(await getCardioLog('2026-01-10', 'cross-trainer')).toBeUndefined();
  });

  it('clearing (unchecking) deletes the entry', async () => {
    await logCardio('2026-01-07', 'cross-trainer', 20);
    await clearCardioLog('2026-01-07', 'cross-trainer');
    expect(await getCardioLog('2026-01-07', 'cross-trainer')).toBeUndefined();
  });
});

describe('steps', () => {
  it('records a real count, and queues an outbox entry', async () => {
    await logSteps('2026-01-05', 6500);
    expect(await getStepsLog('2026-01-05')).toEqual({ date: '2026-01-05', steps: 6500 });

    const outboxRows = await db.outbox.where({ entity: 'steps_log', entity_id: '2026-01-05' }).toArray();
    expect(outboxRows).toHaveLength(1);
    expect(JSON.parse(outboxRows[0].payload)).toEqual({ date: '2026-01-05', steps: 6500 });
  });

  it('re-logging the same date replaces rather than accumulates', async () => {
    await logSteps('2026-01-05', 1000);
    await logSteps('2026-01-05', 2000);
    expect(await getStepsLog('2026-01-05')).toEqual({ date: '2026-01-05', steps: 2000 });
  });

  it('is undefined for an unlogged date', async () => {
    expect(await getStepsLog('2026-01-06')).toBeUndefined();
  });
});
