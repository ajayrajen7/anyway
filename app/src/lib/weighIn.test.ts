import { afterEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { hasWeighIn, logWeighIn } from './weighIn';

afterEach(async () => {
  await db.weighIns.clear();
  await db.outbox.clear();
});

describe('hasWeighIn', () => {
  it('is false for an unlogged date', async () => {
    expect(await hasWeighIn('2026-01-04')).toBe(false);
  });
});

describe('logWeighIn', () => {
  it('writes weighIns and an outbox entry together', async () => {
    await logWeighIn('2026-01-04', 82.5);

    expect(await hasWeighIn('2026-01-04')).toBe(true);
    expect(await db.weighIns.get('2026-01-04')).toEqual({ date: '2026-01-04', weight_kg: 82.5 });

    const outboxRows = await db.outbox.where({ entity: 'weigh_in', entity_id: '2026-01-04' }).toArray();
    expect(outboxRows).toHaveLength(1);
    expect(JSON.parse(outboxRows[0].payload)).toEqual({ date: '2026-01-04', weight_kg: 82.5 });
  });

  it('does not affect a different date', async () => {
    await logWeighIn('2026-01-04', 82.5);
    expect(await hasWeighIn('2026-01-11')).toBe(false);
  });
});
