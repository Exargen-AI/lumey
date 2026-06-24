/**
 * scoreCadences — unit tests.
 *
 * Pure helpers, UTC-based, no Prisma. Covers:
 *   - DAILY / WEEKLY / MONTHLY window boundaries
 *   - workingDays (Mon-Fri count)
 *   - DAILY on a weekend returns workingDays=0
 *   - rolling30DayWindow length
 *   - eventsInWindow inclusivity at both bounds
 *   - month-boundary correctness (28/29/30/31 day months)
 */

import { describe, it, expect } from 'vitest';
import { currentWindowFor, rolling30DayWindow, eventsInWindow } from './scoreCadences';

describe('currentWindowFor — DAILY', () => {
  it('returns the full UTC day for a weekday', () => {
    // 2026-05-29 is a Friday (UTC).
    const now = new Date('2026-05-29T14:30:00Z');
    const w = currentWindowFor('DAILY', now);
    expect(w.start.toISOString()).toBe('2026-05-29T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-05-29T23:59:59.999Z');
    expect(w.workingDays).toBe(1);
  });

  it('returns workingDays=0 when the day is a Saturday', () => {
    // 2026-05-30 is a Saturday (UTC).
    const now = new Date('2026-05-30T14:30:00Z');
    const w = currentWindowFor('DAILY', now);
    expect(w.workingDays).toBe(0);
  });

  it('returns workingDays=0 when the day is a Sunday', () => {
    // 2026-05-31 is a Sunday (UTC).
    const now = new Date('2026-05-31T14:30:00Z');
    const w = currentWindowFor('DAILY', now);
    expect(w.workingDays).toBe(0);
  });
});

describe('currentWindowFor — WEEKLY', () => {
  it('anchors to Monday-of-this-week through Sunday-of-this-week', () => {
    // 2026-05-29 is a Friday. Monday-of-this-week is 2026-05-25.
    const now = new Date('2026-05-29T14:30:00Z');
    const w = currentWindowFor('WEEKLY', now);
    expect(w.start.toISOString()).toBe('2026-05-25T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-05-31T23:59:59.999Z');
    // Mon-Fri = 5 working days
    expect(w.workingDays).toBe(5);
  });

  it('handles Sunday by snapping back to last Monday', () => {
    // 2026-05-31 is a Sunday. Monday-of-this-week is still 2026-05-25.
    const now = new Date('2026-05-31T01:00:00Z');
    const w = currentWindowFor('WEEKLY', now);
    expect(w.start.toISOString()).toBe('2026-05-25T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-05-31T23:59:59.999Z');
    expect(w.workingDays).toBe(5);
  });

  it('handles Monday correctly (week starts that day)', () => {
    // 2026-05-25 is a Monday.
    const now = new Date('2026-05-25T08:00:00Z');
    const w = currentWindowFor('WEEKLY', now);
    expect(w.start.toISOString()).toBe('2026-05-25T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-05-31T23:59:59.999Z');
    expect(w.workingDays).toBe(5);
  });
});

describe('currentWindowFor — MONTHLY', () => {
  it('returns 1st through last day of month for May (31 days)', () => {
    const now = new Date('2026-05-15T10:00:00Z');
    const w = currentWindowFor('MONTHLY', now);
    expect(w.start.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-05-31T23:59:59.999Z');
    // May 2026: 1=Fri, 4-8 Mon-Fri, 11-15 Mon-Fri, 18-22 Mon-Fri,
    //           25-29 Mon-Fri = 1 + 5*4 = 21 working days
    expect(w.workingDays).toBe(21);
  });

  it('returns 1st through 28th for February in a non-leap year (2026)', () => {
    const now = new Date('2026-02-10T10:00:00Z');
    const w = currentWindowFor('MONTHLY', now);
    expect(w.start.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(w.end.toISOString()).toBe('2026-02-28T23:59:59.999Z');
  });

  it('returns 1st through 29th for February in a leap year (2028)', () => {
    const now = new Date('2028-02-10T10:00:00Z');
    const w = currentWindowFor('MONTHLY', now);
    expect(w.end.toISOString()).toBe('2028-02-29T23:59:59.999Z');
  });

  it('returns 1st through 30th for April (30 days)', () => {
    const now = new Date('2026-04-10T10:00:00Z');
    const w = currentWindowFor('MONTHLY', now);
    expect(w.end.toISOString()).toBe('2026-04-30T23:59:59.999Z');
  });
});

// 2026-06-01 — elapsedWorkingDays: the denominator the rate scorers
// (PRESENCE, STANDUP) use so weekly/monthly scores reflect days that
// have actually happened, not the full period.
describe('currentWindowFor — elapsedWorkingDays', () => {
  it('DAILY: elapsed == total (1 on a weekday)', () => {
    // 2026-05-29 is a Friday.
    const w = currentWindowFor('DAILY', new Date('2026-05-29T14:00:00Z'));
    expect(w.workingDays).toBe(1);
    expect(w.elapsedWorkingDays).toBe(1);
  });

  it('DAILY: elapsed == total == 0 on a weekend', () => {
    // 2026-05-30 is a Saturday.
    const w = currentWindowFor('DAILY', new Date('2026-05-30T14:00:00Z'));
    expect(w.workingDays).toBe(0);
    expect(w.elapsedWorkingDays).toBe(0);
  });

  it('WEEKLY: only counts working days up to and including today', () => {
    // Wednesday 2026-05-27. Week is Mon 05-25 .. Sun 05-31 (5 working
    // days total). Elapsed Mon/Tue/Wed = 3.
    const w = currentWindowFor('WEEKLY', new Date('2026-05-27T12:00:00Z'));
    expect(w.workingDays).toBe(5);
    expect(w.elapsedWorkingDays).toBe(3);
  });

  it('WEEKLY: on Monday, only 1 working day has elapsed', () => {
    const w = currentWindowFor('WEEKLY', new Date('2026-05-25T08:00:00Z'));
    expect(w.workingDays).toBe(5);
    expect(w.elapsedWorkingDays).toBe(1);
  });

  it('WEEKLY: by Sunday all 5 weekdays have elapsed (elapsed == total)', () => {
    const w = currentWindowFor('WEEKLY', new Date('2026-05-31T20:00:00Z'));
    expect(w.workingDays).toBe(5);
    expect(w.elapsedWorkingDays).toBe(5);
  });

  it('MONTHLY: counts only working days from the 1st through today', () => {
    // 2026-05-15 is a Friday. May 1 is a Friday.
    // Working days 05-01..05-15: 1(Fri) + 4-8(Mon-Fri) + 11-15(Mon-Fri)
    //   = 1 + 5 + 5 = 11 elapsed; full month is 21.
    const w = currentWindowFor('MONTHLY', new Date('2026-05-15T10:00:00Z'));
    expect(w.workingDays).toBe(21);
    expect(w.elapsedWorkingDays).toBe(11);
  });

  it('MONTHLY: on the 1st, only that day (if a weekday) has elapsed', () => {
    // 2026-05-01 is a Friday.
    const w = currentWindowFor('MONTHLY', new Date('2026-05-01T10:00:00Z'));
    expect(w.workingDays).toBe(21);
    expect(w.elapsedWorkingDays).toBe(1);
  });
});

describe('rolling30DayWindow', () => {
  it('spans exactly 30 calendar days, anchored to end-of-today', () => {
    const now = new Date('2026-05-29T14:30:00Z');
    const w = rolling30DayWindow(now);
    expect(w.end.toISOString()).toBe('2026-05-29T23:59:59.999Z');
    // 30 days = 29 days back to make the window inclusive of today.
    expect(w.start.toISOString()).toBe('2026-04-30T00:00:00.000Z');
    // 30 calendar days inclusive of today.
    const days = Math.round((w.end.getTime() - w.start.getTime()) / (24 * 60 * 60 * 1000));
    // 29.999... rounded → 30
    expect(days).toBe(30);
  });
});

describe('eventsInWindow', () => {
  const window = {
    start: new Date('2026-05-25T00:00:00.000Z'),
    end: new Date('2026-05-31T23:59:59.999Z'),
    workingDays: 5,
    elapsedWorkingDays: 5,
  };

  it('includes events at the lower bound (inclusive)', () => {
    const events = [{ occurredAt: new Date('2026-05-25T00:00:00.000Z') }];
    expect(eventsInWindow(events, window)).toHaveLength(1);
  });

  it('includes events at the upper bound (inclusive)', () => {
    const events = [{ occurredAt: new Date('2026-05-31T23:59:59.999Z') }];
    expect(eventsInWindow(events, window)).toHaveLength(1);
  });

  it('excludes events one millisecond before the start', () => {
    const events = [{ occurredAt: new Date('2026-05-24T23:59:59.999Z') }];
    expect(eventsInWindow(events, window)).toHaveLength(0);
  });

  it('excludes events one millisecond after the end', () => {
    const events = [{ occurredAt: new Date('2026-06-01T00:00:00.000Z') }];
    expect(eventsInWindow(events, window)).toHaveLength(0);
  });

  it('returns empty array for an empty input', () => {
    expect(eventsInWindow([], window)).toEqual([]);
  });
});
