import { afterEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { getMorningCheck, logMorningCheck } from './morningCheck';

afterEach(async () => {
  await db.morningChecks.clear();
  await db.outbox.clear();
});

describe('getMorningCheck', () => {
  it('returns undefined for an unlogged day — absence, never a default', async () => {
    expect(await getMorningCheck('2026-01-05')).toBeUndefined();
  });
});

describe('logMorningCheck', () => {
  it('writes morningChecks and an outbox entry together', async () => {
    await logMorningCheck('2026-01-05', 'background');

    expect(await getMorningCheck('2026-01-05')).toEqual({ date: '2026-01-05', pain: 'background' });

    const outboxRows = await db.outbox.where({ entity: 'morning_check', entity_id: '2026-01-05' }).toArray();
    expect(outboxRows).toHaveLength(1);
    expect(JSON.parse(outboxRows[0].payload)).toEqual({ date: '2026-01-05', pain: 'background' });
  });

  it('does not affect a different date', async () => {
    await logMorningCheck('2026-01-05', 'limiting');
    expect(await getMorningCheck('2026-01-06')).toBeUndefined();
  });
});
