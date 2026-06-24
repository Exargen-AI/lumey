/**
 * STANDUP signal scorer — daily-update discipline.
 *
 * Measures: did the employee submit a substantive daily standup on
 * every working day in the window?
 *
 * Score formula (R5):
 *   substantive_standups = events where standup body >= 50 chars AND
 *                          NOT a duplicate of a recent body
 *   score = (substantive_standups / working_days) * 100
 *
 * Gaming guards applied at score time (events flagged by the outbox
 * writer with gamingFlag != null are already excluded by the worker
 * before we see them):
 *   - bodyTooShort: <50 chars total body → ignored
 *   - duplicateBody: same body posted on >= 3 prior days → ignored
 *
 * Pure function. Side-effect free. The same input always returns the
 * same output, which is the property that makes weight-change replay
 * cheap.
 */

import type { SignalScore } from '@exargen/shared';
import type { Scorer, ScorerInput, ScorerEvent } from './types';

/** Minimum substantive standup body. R5 calibration; tunable. */
const MIN_BODY_CHARS = 50;

/**
 * Same body posted on this many prior days within the window is
 * considered a copy-paste. The first copy still counts; the 2nd+ are
 * dropped.
 */
const DUPLICATE_THRESHOLD_DAYS = 3;

interface StandupRawPayload {
  /** ISO date the standup is FOR (not when it was submitted). */
  date: string;
  /** Concatenated summary + blockers + plans. */
  bodyLength: number;
  /** SHA-256 hex prefix of the normalised body. Used for dup detection. */
  bodyHash: string;
}

export const scoreStandup: Scorer = (input: ScorerInput): SignalScore => {
  const { events, workingDays } = input;
  // 2026-06-01 — score against ELAPSED working days so weekly/monthly
  // standup discipline reflects "submitted on N of the M days that
  // have happened" rather than "N of the full period's M days" (which
  // read low until the last day). Falls back to workingDays when the
  // elapsed count isn't supplied (older callers / direct unit tests).
  const elapsedWorkingDays = input.elapsedWorkingDays ?? workingDays;

  // Group events by date — at most one standup per (user, date), but if
  // the user edits/resubmits we may have multiple events for the same
  // date (different occurredAt timestamps). Treat the LATEST as
  // canonical; that one's bodyLength + bodyHash decide whether the day
  // counts.
  const latestByDate = new Map<string, ScorerEvent>();
  for (const ev of events) {
    if (ev.eventType !== 'standup.submitted') continue;
    const payload = ev.rawPayload as unknown as StandupRawPayload;
    if (!payload?.date) continue;
    const existing = latestByDate.get(payload.date);
    if (!existing || ev.occurredAt > existing.occurredAt) {
      latestByDate.set(payload.date, ev);
    }
  }

  // Sort dates chronologically so duplicate detection has a defined
  // "prior days" ordering.
  const dates = Array.from(latestByDate.keys()).sort();
  const recentHashes: string[] = [];
  let substantive = 0;
  let bodyTooShortCount = 0;
  let duplicateCount = 0;

  for (const date of dates) {
    const ev = latestByDate.get(date);
    if (!ev) continue;
    const payload = ev.rawPayload as unknown as StandupRawPayload;
    const bodyLen = payload.bodyLength ?? 0;
    const bodyHash = payload.bodyHash ?? '';

    if (bodyLen < MIN_BODY_CHARS) {
      bodyTooShortCount += 1;
      recentHashes.push(bodyHash);
      continue;
    }

    // Duplicate-body check: was the same hash posted in the trailing
    // DUPLICATE_THRESHOLD_DAYS days? If so, it doesn't count.
    const dupWindow = recentHashes.slice(-DUPLICATE_THRESHOLD_DAYS);
    const isDuplicate = bodyHash !== '' && dupWindow.includes(bodyHash);
    if (isDuplicate) {
      duplicateCount += 1;
      recentHashes.push(bodyHash);
      continue;
    }

    substantive += 1;
    recentHashes.push(bodyHash);
  }

  // Elapsed working days come from the worker (PTO-adjusted). Never 0
  // — floored at 1 to avoid divide-by-zero, which produces a small,
  // defensible score for windows entirely covered by PTO or for the
  // very first working day of a period.
  const safeWorkingDays = Math.max(1, elapsedWorkingDays);
  const rawScore = (substantive / safeWorkingDays) * 100;
  const score = clamp01_100(rawScore);

  const gamingFlags: string[] = [];
  if (bodyTooShortCount > 0) {
    gamingFlags.push(`standup_too_short_count=${bodyTooShortCount}`);
  }
  if (duplicateCount > 0) {
    gamingFlags.push(`standup_duplicate_count=${duplicateCount}`);
  }

  return {
    signal: 'STANDUP',
    score,
    rawBreakdown: {
      substantive_standups: substantive,
      working_days: workingDays,
      elapsed_working_days: elapsedWorkingDays,
      body_too_short_count: bodyTooShortCount,
      duplicate_count: duplicateCount,
      total_standup_events: events.length,
      unique_dates: dates.length,
    },
    gamingFlags,
  };
};

function clamp01_100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  // Two decimal places — matches the Decimal(5,2) DB column.
  return Math.round(n * 100) / 100;
}
