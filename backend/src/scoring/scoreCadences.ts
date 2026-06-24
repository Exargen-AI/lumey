/**
 * Pulse productivity score — cadence window helpers.
 *
 * Three publishing cadences per design (R5):
 *   DAILY   — single calendar day (00:00 → 23:59 user-local TZ)
 *   WEEKLY  — ISO week, Monday → Sunday
 *   MONTHLY — calendar month, first → last day
 *
 * v1 uses UTC throughout because `users.timezone` isn't wired up yet
 * (Wave 6 enhancement). Per-user-TZ rebucket lands when the column
 * exists. All callers should treat the window dates as
 * timezone-agnostic ISO date strings — the worker will re-bucket on
 * the TZ rollout without changing the API surface.
 *
 * Working-day count is also computed here (used by scorers as the
 * denominator for "% of working days a substantive thing happened").
 * v1 = weekday count in window. PTO subtraction is a follow-up when
 * the time_off_requests table lands.
 *
 * Pure functions only. Side-effect free. Trivially testable.
 */

import type { ProductivityCadence } from '@exargen/shared';

export interface Window {
  start: Date;
  end: Date;
  /** Mon-Fri days inclusive across the ENTIRE window (e.g. ~22 for a
   *  full month). Used for context / display. */
  workingDays: number;
  /**
   * Mon-Fri days from `start` through min(now, end), inclusive — i.e.
   * how many working days have ELAPSED in the period so far (2026-06-01).
   *
   * This is the denominator the rate-based scorers (PRESENCE, STANDUP)
   * divide by. Dividing partial-period activity by the FULL-period
   * `workingDays` made weekly/monthly scores read systematically low
   * for every day except the last of the period (on the 1st of a
   * month, everyone landed in the LOW band). Dividing by elapsed days
   * instead gives "per working day so far", which is stable and
   * accurate from day one.
   *
   * For DAILY this equals `workingDays` (the window is a single day).
   */
  elapsedWorkingDays: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Compute the current window for a cadence anchored on `now` (UTC).
 *
 *   DAILY   → [00:00 today, 23:59 today]
 *   WEEKLY  → [00:00 Mon-of-this-week, 23:59 Sun-of-this-week]
 *   MONTHLY → [00:00 1st of this month, 23:59 last day of this month]
 *
 * Returns Date objects in UTC. `workingDays` is the count of Mon-Fri
 * days inclusive within the full window; `elapsedWorkingDays` counts
 * only those that have already occurred (start → min(now, end)).
 */
export function currentWindowFor(cadence: ProductivityCadence, now: Date = new Date()): Window {
  const dayStart = startOfDayUTC(now);
  switch (cadence) {
    case 'DAILY': {
      const start = dayStart;
      const end = endOfDayUTC(now);
      const workingDays = isWeekendUTC(start) ? 0 : 1;
      // A single-day window has fully elapsed by definition.
      return { start, end, workingDays, elapsedWorkingDays: workingDays };
    }
    case 'WEEKLY': {
      const start = startOfWeekUTC(now);
      const end = endOfDayUTC(addDays(start, 6));
      return {
        start,
        end,
        workingDays: workingDaysInRange(start, end),
        elapsedWorkingDays: elapsedWorkingDaysInRange(start, end, now),
      };
    }
    case 'MONTHLY': {
      const start = startOfMonthUTC(now);
      const end = endOfDayUTC(lastDayOfMonthUTC(now));
      return {
        start,
        end,
        workingDays: workingDaysInRange(start, end),
        elapsedWorkingDays: elapsedWorkingDaysInRange(start, end, now),
      };
    }
  }
}

/**
 * Rolling 30-day window ending at `now`. Used by the recompute
 * worker to fetch the event slice once and then sub-window inside it
 * per cadence (faster than three separate DB queries).
 */
export function rolling30DayWindow(now: Date = new Date()): Window {
  const end = endOfDayUTC(now);
  const start = startOfDayUTC(new Date(end.getTime() - 29 * MS_PER_DAY));
  const workingDays = workingDaysInRange(start, end);
  // The rolling window always ends at `now`, so every working day in it
  // has elapsed — elapsed == total here.
  return { start, end, workingDays, elapsedWorkingDays: workingDays };
}

/** Filter `events` to those with occurredAt inside `window`. */
export function eventsInWindow<T extends { occurredAt: Date }>(
  events: T[],
  window: Window,
): T[] {
  return events.filter(
    (e) => e.occurredAt >= window.start && e.occurredAt <= window.end,
  );
}

// ────────────────────────────────────────────────────────────────────
// UTC helpers
// ────────────────────────────────────────────────────────────────────

function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

function endOfDayUTC(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999),
  );
}

function isWeekendUTC(d: Date): boolean {
  const dow = d.getUTCDay(); // 0 Sun, 6 Sat
  return dow === 0 || dow === 6;
}

/**
 * Monday-of-week. ISO week starts Monday; getUTCDay returns 0 for
 * Sunday, so we shift it to 7 to make subtraction work cleanly.
 */
function startOfWeekUTC(d: Date): Date {
  const day = d.getUTCDay() || 7;
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - (day - 1));
  return startOfDayUTC(monday);
}

function startOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

function lastDayOfMonthUTC(d: Date): Date {
  // Day 0 of next month = last day of this month.
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 0, 0, 0, 0));
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * MS_PER_DAY);
}

/**
 * Mon-Fri count inclusive. PTO subtraction is a future enhancement
 * when `time_off_requests` lands.
 */
function workingDaysInRange(start: Date, end: Date): number {
  let count = 0;
  let cursor = startOfDayUTC(start);
  const last = startOfDayUTC(end);
  while (cursor <= last) {
    if (!isWeekendUTC(cursor)) count += 1;
    cursor = addDays(cursor, 1);
  }
  return count;
}

/**
 * Working days from `start` through min(now, end), inclusive — the
 * count that have ELAPSED so far in the period. Clamps the effective
 * end to `now` so a partial week/month counts only the days that have
 * actually happened. If `now` is before `start` (shouldn't happen for
 * the current window) the range collapses and we return 0; callers
 * floor at 1 before dividing.
 */
function elapsedWorkingDaysInRange(start: Date, end: Date, now: Date): number {
  const effectiveEnd = now < end ? now : end;
  if (effectiveEnd < start) return 0;
  return workingDaysInRange(start, effectiveEnd);
}
