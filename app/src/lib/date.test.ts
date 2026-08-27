import { describe, expect, it } from 'vitest';
import { localDateKey } from './date';

describe('localDateKey', () => {
  it('formats a local date as YYYY-MM-DD', () => {
    expect(localDateKey(new Date(2026, 0, 5))).toBe('2026-01-05'); // Jan (month index 0)
  });

  it('pads single-digit month and day', () => {
    expect(localDateKey(new Date(2026, 8, 3))).toBe('2026-09-03'); // Sep (month index 8)
  });

  it('does not use UTC — a late-evening local time stays on the local day', () => {
    // 23:30 local time must still key to the same local calendar day, even
    // though in a timezone ahead of UTC this instant may already be the next
    // UTC day. toISOString() would get this wrong; localDateKey must not.
    const lateEvening = new Date(2026, 0, 5, 23, 30);
    expect(localDateKey(lateEvening)).toBe('2026-01-05');
  });
});
