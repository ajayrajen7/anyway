import { describe, expect, it } from 'vitest';
import { isAfter6pm, isSunday, localDateKey, parseDateKey } from './date';

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

describe('isAfter6pm', () => {
  it('is false before 18:00', () => {
    expect(isAfter6pm(new Date(2026, 0, 5, 17, 59))).toBe(false);
  });
  it('is true at and after 18:00', () => {
    expect(isAfter6pm(new Date(2026, 0, 5, 18, 0))).toBe(true);
    expect(isAfter6pm(new Date(2026, 0, 5, 23, 30))).toBe(true);
  });
});

describe('isSunday', () => {
  it('is true on a Sunday', () => {
    expect(isSunday(new Date(2026, 0, 4))).toBe(true); // Jan 4, 2026 is a Sunday
  });
  it('is false on any other day', () => {
    expect(isSunday(new Date(2026, 0, 5))).toBe(false); // Monday
    expect(isSunday(new Date(2026, 0, 10))).toBe(false); // Saturday
  });
});

describe('parseDateKey', () => {
  it('round-trips with localDateKey', () => {
    expect(localDateKey(parseDateKey('2026-01-05'))).toBe('2026-01-05');
  });

  it('parses via local components, not UTC', () => {
    // new Date('2026-01-05') would be UTC midnight, which is the previous
    // local day in any timezone ahead of UTC — parseDateKey must not do that.
    const d = parseDateKey('2026-01-05');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(5);
  });
});
