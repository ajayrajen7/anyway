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
  logProtein,
  logSteps,
} from './dailyLogs';

afterEach(async () => {
  await db.proteinLogs.clear();
  await db.mobilityLogs.clear();
  await db.cardioLogs.clear();
  await db.stepsLogs.clear();
  await db.outbox.clear();
});

describe('protein', () => {
  it('records a real yes or no, and queues an outbox entry', async () => {
    await logProtein('2026-01-05', true);
    expect(await getProteinLog('2026-01-05')).toEqual({ date: '2026-01-05', hit: true });

    const outboxRows = await db.outbox.where({ entity: 'protein_log', entity_id: '2026-01-05' }).toArray();
    expect(outboxRows).toHaveLength(1);
    expect(JSON.parse(outboxRows[0].payload)).toEqual({ date: '2026-01-05', hit: true });
  });

  it('a "no" is a real, distinct stored value, not absence', async () => {
    await logProtein('2026-01-05', false);
    expect(await getProteinLog('2026-01-05')).toEqual({ date: '2026-01-05', hit: false });
  });

  it('is undefined (absent) for an unanswered date', async () => {
    expect(await getProteinLog('2026-01-06')).toBeUndefined();
  });
});

describe('mobility', () => {
  it('presence means done — there is no logged false', async () => {
    await logMobility('2026-01-05');
    expect(await getMobilityLog('2026-01-05')).toEqual({ date: '2026-01-05' });

    const outboxRows = await db.outbox.where({ entity: 'mobility_log', entity_id: '2026-01-05' }).toArray();
    expect(outboxRows).toHaveLength(1);
  });

  it('clearing (unchecking) deletes the row rather than writing a negative value', async () => {
    await logMobility('2026-01-05');
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
