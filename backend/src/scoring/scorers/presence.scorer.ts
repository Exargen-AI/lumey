/**
 * PRESENCE signal scorer — working-hour discipline.
 *
 * Measures: did the employee actually show up, and was the device
 * activity consistent with the clocked-in time?
 *
 * R5 weight: 0.18 (third-largest). PRESENCE is the "showing up
 * reliably" signal — not just clock hours, but the active-to-clocked
 * ratio (defense against ghost-clocks) and the consistency of login
 * start time (discipline bonus).
 *
 * Data sources, expressed as two distinct event types:
 *   - clock.session_closed  one per closed ClockSession; rawPayload
 *                            carries clockedInAt, clockedOutAt,
 *                            durationSeconds.
 *   - pulse.daily_presence  one per device-snapshot day-rollup;
 *                            rawPayload carries activeSeconds,
 *                            idleSeconds, lockedSeconds, hasTamper,
 *                            loginSessionStartHour.
 *
 * Score formula (R5):
 *   actual_avg = min(clock_hours_per_day, pulse_active_hours_per_day)
 *   target = baselines.PRESENCE.targetAvgHours (default 8)
 *   under_penalty = 10 * max(0, target - actual_avg)
 *   over_penalty  = 5  * max(0, actual_avg - 10)
 *   start_bonus   = +5 if login_start_consistency > 0.8
 *   ghost_penalty = -10 if any ghost-clock days detected
 *   score = clamp(0, 100, 100 - under_penalty - over_penalty + start_bonus + ghost_penalty)
 *
 * Gaming guards:
 *   - tamper detected → subtracts active hours BEFORE the score is
 *     computed (one notch of input punishment)
 *   - ghost_clock_day: clock-in day with <30 min of device activity →
 *     subtracts 10 from the score
 *
 * Pure function. Side-effect free.
 */

import type { SignalScore } from '@exargen/shared';
import type { Scorer, ScorerInput } from './types';

const DEFAULT_TARGET_HOURS = 8;
const OVERWORK_THRESHOLD_HOURS = 10;
const UNDER_PENALTY_PER_HOUR = 10;
const OVER_PENALTY_PER_HOUR = 5;
/** Consistency threshold for the start-time bonus (Jaccard-ish over hour-of-day). */
const START_CONSISTENCY_THRESHOLD = 0.8;
const START_BONUS = 5;
const GHOST_CLOCK_PENALTY = 10;
/** Minimum daily device-active minutes for a clocked-in day to count as non-ghost. */
const GHOST_CLOCK_MIN_ACTIVE_MINUTES = 30;

interface ClockSessionClosedPayload {
  clockedInAt: string;
  clockedOutAt: string;
  durationSeconds: number;
  /** "yyyy-mm-dd" in user-local timezone. */
  date: string;
}

interface PulseDailyPresencePayload {
  /** "yyyy-mm-dd". */
  date: string;
  activeSeconds: number;
  idleSeconds: number;
  lockedSeconds: number;
  hasTamper: boolean;
  /** Hour of day (0-23) when the OS reported the current session start. */
  loginSessionStartHour: number | null;
}

export const scorePresence: Scorer = (input: ScorerInput): SignalScore => {
  const { events, workingDays, baselines } = input;
  // 2026-06-01 — average over ELAPSED working days, not the full
  // period. Falls back to workingDays when elapsedWorkingDays is
  // undefined (older callers / direct unit tests). This keeps the
  // weekly/monthly "avg hours per day" honest mid-period instead of
  // dividing 3 days of clock time by a full 22-day month.
  const elapsedWorkingDays = input.elapsedWorkingDays ?? workingDays;
  const targetHours = baselines.PRESENCE?.targetAvgHours ?? DEFAULT_TARGET_HOURS;

  // Aggregate clock-derived hours per date.
  const clockedSecondsByDate = new Map<string, number>();
  const pulseByDate = new Map<string, PulseDailyPresencePayload>();
  let tamperMinutes = 0;
  let preFlaggedCount = 0;

  for (const ev of events) {
    if (ev.gamingFlag) {
      preFlaggedCount += 1;
      continue;
    }

    if (ev.eventType === 'clock.session_closed') {
      const payload = ev.rawPayload as unknown as ClockSessionClosedPayload;
      if (!payload?.date) continue;
      const seconds = Number(payload.durationSeconds);
      if (!Number.isFinite(seconds) || seconds <= 0) continue;
      clockedSecondsByDate.set(
        payload.date,
        (clockedSecondsByDate.get(payload.date) ?? 0) + seconds,
      );
    } else if (ev.eventType === 'pulse.daily_presence') {
      const payload = ev.rawPayload as unknown as PulseDailyPresencePayload;
      if (!payload?.date) continue;
      // Multiple snapshot rollups per day? Keep the LAST one (the worker
      // emits one per day rollup; defensive against duplicates).
      pulseByDate.set(payload.date, payload);
      if (payload.hasTamper) {
        tamperMinutes += 30; // each tamper-flagged day subtracts ~30 min of trust
      }
    }
  }

  // Per-day rollup: for each date in the union of clock + pulse, compute
  // the effective presence (min of clock vs pulse-active) and detect
  // ghost-clock days.
  const allDates = new Set<string>([
    ...clockedSecondsByDate.keys(),
    ...pulseByDate.keys(),
  ]);
  let totalEffectiveSeconds = 0;
  let daysCovered = 0;
  let ghostClockDays = 0;
  const startHours: number[] = [];

  for (const date of allDates) {
    const clockedSec = clockedSecondsByDate.get(date) ?? 0;
    const pulse = pulseByDate.get(date);
    const activeSec = Math.max(0, (pulse?.activeSeconds ?? 0) - tamperSubtractSec(pulse));

    // If we have BOTH clock + pulse data, effective = min of the two.
    // If only one, use it (lossy but honest).
    let effective: number;
    if (clockedSec > 0 && activeSec > 0) {
      effective = Math.min(clockedSec, activeSec);
    } else {
      effective = Math.max(clockedSec, activeSec);
    }

    // Ghost-clock detection: clocked but device idle.
    if (clockedSec > 60 * 60 && activeSec < GHOST_CLOCK_MIN_ACTIVE_MINUTES * 60) {
      ghostClockDays += 1;
    }

    if (effective > 0) {
      totalEffectiveSeconds += effective;
      daysCovered += 1;
    }
    if (pulse?.loginSessionStartHour != null) {
      startHours.push(pulse.loginSessionStartHour);
    }
  }

  // Average over the ELAPSED working-day denominator (PTO-adjusted by
  // the worker). Defensive: never divide by 0.
  const denominatorDays = Math.max(1, elapsedWorkingDays);
  const avgHoursPerDay = totalEffectiveSeconds / 3600 / denominatorDays;

  const underPenalty =
    UNDER_PENALTY_PER_HOUR * Math.max(0, targetHours - avgHoursPerDay);
  const overPenalty =
    OVER_PENALTY_PER_HOUR * Math.max(0, avgHoursPerDay - OVERWORK_THRESHOLD_HOURS);

  // Start-time consistency: % of days where the login hour fell within
  // ±1h of the modal hour. > threshold → bonus.
  const consistency = startTimeConsistency(startHours);
  const startBonus = consistency >= START_CONSISTENCY_THRESHOLD ? START_BONUS : 0;

  const ghostPenalty = ghostClockDays > 0 ? GHOST_CLOCK_PENALTY : 0;

  const rawScore = 100 - underPenalty - overPenalty + startBonus - ghostPenalty;
  const score = clamp01_100(rawScore);

  const gamingFlags: string[] = [];
  if (ghostClockDays > 0) {
    gamingFlags.push(`ghost_clock_days_count=${ghostClockDays}`);
  }
  if (tamperMinutes > 0) {
    gamingFlags.push(`tamper_minutes=${tamperMinutes}`);
  }
  if (preFlaggedCount > 0) {
    gamingFlags.push(`presence_write_time_flagged_count=${preFlaggedCount}`);
  }
  if (avgHoursPerDay > OVERWORK_THRESHOLD_HOURS) {
    gamingFlags.push(`burnout_warning_avg_hours=${round2(avgHoursPerDay)}`);
  }

  return {
    signal: 'PRESENCE',
    score,
    rawBreakdown: {
      avg_hours_per_day: round2(avgHoursPerDay),
      target_hours: targetHours,
      working_days: workingDays,
      elapsed_working_days: elapsedWorkingDays,
      days_covered: daysCovered,
      total_effective_seconds: totalEffectiveSeconds,
      clock_session_event_count: clockedSecondsByDate.size,
      pulse_rollup_event_count: pulseByDate.size,
      tamper_minutes: tamperMinutes,
      ghost_clock_days: ghostClockDays,
      start_time_consistency: round2(consistency),
      start_bonus_applied: startBonus,
      under_penalty: round2(underPenalty),
      over_penalty: round2(overPenalty),
    },
    gamingFlags,
  };
};

/**
 * Tamper subtraction: when a pulse day-rollup is flagged with
 * hasTamper, dock 30 minutes off the active total before computing
 * presence. This stops a mouse-jiggler from inflating active hours.
 */
function tamperSubtractSec(pulse: PulseDailyPresencePayload | undefined): number {
  if (!pulse?.hasTamper) return 0;
  return 30 * 60;
}

/**
 * Returns the fraction of login hours that landed within ±1h of the
 * modal hour. 1.0 = perfectly consistent; 0.0 = scattered. Returns 0
 * if there aren't at least 3 days of data (too small to be a signal).
 */
function startTimeConsistency(hours: number[]): number {
  if (hours.length < 3) return 0;
  // Find modal hour.
  const counts = new Map<number, number>();
  for (const h of hours) {
    counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  let modalHour = hours[0];
  let modalCount = 0;
  for (const [h, c] of counts) {
    if (c > modalCount) {
      modalCount = c;
      modalHour = h;
    }
  }
  // Count days within ±1h of modal.
  const within = hours.filter((h) => Math.abs(h - modalHour) <= 1).length;
  return within / hours.length;
}

function clamp01_100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n * 100) / 100;
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}
