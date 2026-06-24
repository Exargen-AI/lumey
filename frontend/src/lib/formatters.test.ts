/**
 * 2026-05-23 — covering the date + relative-time helpers used in 100+
 * places (kanban card aging dot, "Completed N hours ago" labels, due-date
 * overdue chips, every list view). A drift in any of these functions
 * silently shifts the meaning of every date displayed in the app.
 *
 * Pinned invariants:
 *   - formatDate falls back to '—' for null/undefined/invalid
 *   - formatDate strips the trailing T00:00:00Z when parsing date-only strings
 *     (so calendar dates don't shift across timezones on display)
 *   - formatRelative renders "X ago" / "in X" suffix
 *   - isOverdue compares to start-of-today (not now() — a task due today
 *     at 18:00 should not be "overdue" at 09:00)
 *   - toDateInputValue extracts YYYY-MM-DD from various input shapes
 *   - pluralize uses the singular only on exactly 1; everything else
 *     (including 0) gets the plural form
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatRelative,
  isOverdue,
  toLocalDateString,
  toDateInputValue,
  pluralize,
} from './formatters';

beforeEach(() => {
  // Pin "now" so formatRelative + isOverdue are deterministic across runs.
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-05-23T14:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('formatDate', () => {
  it('returns "—" for null / undefined / empty', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('')).toBe('—');
  });

  it('returns "—" for invalid date strings', () => {
    expect(formatDate('not-a-date')).toBe('—');
    expect(formatDate('2026-13-99')).toBe('—');
  });

  it('formats a Date as "MMM d, yyyy"', () => {
    expect(formatDate(new Date('2026-05-23T10:00:00Z'))).toMatch(/May 23, 2026/);
  });

  it('strips trailing T00:00:00Z from date-only strings so calendar dates do not shift across timezones', () => {
    // The bug this protects against: a due-date stored as "2026-05-23" was
    // parsed as midnight UTC and rendered as "May 22" in IST (5.5h behind).
    expect(formatDate('2026-05-23')).toBe('May 23, 2026');
    expect(formatDate('2026-05-23T00:00:00Z')).toBe('May 23, 2026');
    expect(formatDate('2026-05-23T00:00:00.000Z')).toBe('May 23, 2026');
  });
});

describe('formatDateTime', () => {
  it('renders the time component too', () => {
    expect(formatDateTime(new Date('2026-05-23T10:30:00Z'))).toMatch(
      /May 23, 2026.*(AM|PM)/,
    );
  });

  it('returns "—" for null / invalid', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime('not-a-date')).toBe('—');
  });
});

describe('formatRelative', () => {
  it('produces "X ago" for past dates', () => {
    expect(formatRelative('2026-05-23T13:00:00Z')).toMatch(/ago/);
  });

  it('produces "in X" for future dates', () => {
    expect(formatRelative('2026-05-25T13:00:00Z')).toMatch(/^in /);
  });

  it('returns "—" for null / invalid', () => {
    expect(formatRelative(null)).toBe('—');
    expect(formatRelative('not-a-date')).toBe('—');
  });
});

describe('isOverdue', () => {
  it('false when no due date is supplied', () => {
    expect(isOverdue(null)).toBe(false);
    expect(isOverdue(undefined)).toBe(false);
  });

  it('false when the due date is today (start-of-day comparison, not now())', () => {
    // Without start-of-day, a task due "today" at 18:00 would show as
    // overdue at any time before 18:00 — wrong intent.
    expect(isOverdue('2026-05-23')).toBe(false);
  });

  it('false when due date is in the future', () => {
    expect(isOverdue('2026-05-25')).toBe(false);
  });

  it('true when due date is strictly before today', () => {
    expect(isOverdue('2026-05-22')).toBe(true);
    expect(isOverdue('2025-01-01')).toBe(true);
  });

  it('false for invalid date string (defensive — never flag as "overdue" what we can\'t parse)', () => {
    expect(isOverdue('not-a-date')).toBe(false);
  });
});

describe('toLocalDateString', () => {
  it('formats as YYYY-MM-DD using LOCAL time (not UTC)', () => {
    // The bug this protects against: toISOString().slice(0,10) gives UTC
    // date which is off-by-one for IST users at night. This helper uses
    // getFullYear / getMonth / getDate which are local-zone safe.
    const local = new Date(2026, 4, 23); // May is month index 4
    expect(toLocalDateString(local)).toBe('2026-05-23');
  });

  it('pads single-digit month/day', () => {
    expect(toLocalDateString(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('defaults to "now" when no arg supplied', () => {
    // With faked time at 2026-05-23T14:00:00Z, IST (UTC+5:30) = same day.
    // We don't assert the exact value because it depends on the runner's
    // tz; we just check the shape.
    expect(toLocalDateString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('toDateInputValue', () => {
  it('returns "" for null / undefined', () => {
    expect(toDateInputValue(null)).toBe('');
    expect(toDateInputValue(undefined)).toBe('');
  });

  it('extracts YYYY-MM-DD directly from a midnight-UTC string (no timezone shift)', () => {
    expect(toDateInputValue('2026-05-23')).toBe('2026-05-23');
    expect(toDateInputValue('2026-05-23T00:00:00Z')).toBe('2026-05-23');
  });

  it('returns "" for an unparseable string', () => {
    expect(toDateInputValue('not-a-date')).toBe('');
  });

  it('handles a Date instance by formatting in local time', () => {
    const d = new Date(2026, 4, 23);
    expect(toDateInputValue(d)).toBe('2026-05-23');
  });
});

describe('pluralize', () => {
  it('uses singular ONLY on exactly 1', () => {
    expect(pluralize(1, 'task')).toBe('1 task');
  });

  it('uses plural for 0 (the most common drift bug — "0 task" looks broken)', () => {
    expect(pluralize(0, 'task')).toBe('0 tasks');
  });

  it('uses plural for 2+', () => {
    expect(pluralize(2, 'task')).toBe('2 tasks');
    expect(pluralize(99, 'task')).toBe('99 tasks');
  });

  it('accepts an explicit plural form for irregular nouns', () => {
    expect(pluralize(1, 'story', 'stories')).toBe('1 story');
    expect(pluralize(3, 'story', 'stories')).toBe('3 stories');
  });
});
