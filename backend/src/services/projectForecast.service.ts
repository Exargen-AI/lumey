import { TaskStatus, HealthStatus } from '@prisma/client';
import type {
  ProjectForecast,
  ForecastStatus,
  DeliveryStatus,
} from '@exargen/shared';
import prisma from '../config/database';
import { NotFoundError } from '../utils/errors';
import { logger } from '../lib/logger';

/**
 * Forecast a project's delivery date from its own task-completion history.
 *
 * Algorithm (kept deliberately simple — see docs/CLIENT_FORECAST.md for the
 * design rationale and edge-case handling):
 *
 *   1. Sum client-visible story points → total / done / remaining.
 *   2. Pull DONE-transitions from `task_status_history` over the last
 *      LOOKBACK_WEEKS, grouped by ISO week → weekly velocity series.
 *   3. velocity = mean(weekly series), sigma = stddev(weekly series).
 *   4. Conservative date = today + remaining / max(velocity - sigma, 1) weeks
 *      Expected date     = today + remaining / velocity weeks
 *      Optimistic date   = today + remaining / (velocity + sigma) weeks
 *   5. Compare conservative date to project.targetDate to set ON_TRACK / AT_RISK / BEHIND.
 *
 * Pure(-ish): all DB access lives in `gatherInputs`. The math functions
 * below take primitives in, return values out — easy to unit-test.
 */

// Configuration constants — tweak these without touching algorithm code.
const LOOKBACK_WEEKS = 6; // weeks of history considered (we use last 4 *complete* weeks)
const COMPLETE_WEEKS_USED = 4;
const MIN_DONE_POINTS_FOR_FORECAST = 5; // below this → BASELINING
const MIN_TOTAL_POINTS_FOR_FORECAST = 10; // below this → BASELINING
const ON_TRACK_DAYS_THRESHOLD = 3; // forecast ≤ target + 3 days → ON_TRACK
const AT_RISK_DAYS_THRESHOLD = 10; // ≤ target + 10 days → AT_RISK, otherwise BEHIND

interface ForecastInputs {
  /** All client-visible tasks on the project. */
  tasks: Array<{ storyPoints: number | null; status: TaskStatus }>;
  /** DONE-transition timestamps + the story-points value at that time. */
  doneTransitions: Array<{ changedAt: Date; storyPoints: number | null }>;
  /** Project's own target date, if set. */
  targetDate: Date | null;
  /** "Now" — broken out so tests can pin it. */
  now: Date;
}

export async function computeProjectForecast(projectId: string): Promise<ProjectForecast> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    // autoHealth + healthStatus pulled so we can sync the project's manual
    // health dot with the forecast verdict on projects that opted into
    // auto-derived health. See `syncAutoHealth` below.
    select: { id: true, targetDate: true, autoHealth: true, healthStatus: true },
  });
  if (!project) throw new NotFoundError('Project');

  const inputs = await gatherInputs(projectId, project.targetDate, new Date());
  const forecast = computeFromInputs(inputs);

  // Side effect: reconcile `project.healthStatus` with the forecast verdict
  // when autoHealth is on. This closes the long-standing gap where
  // `Project.autoHealth = true` was documented as "system computes health"
  // but no code actually computed it — so the health dot could read
  // "🟢 HEALTHY" right above a "🔴 Behind schedule" forecast strip.
  // Fire-and-forget: don't block the forecast response on the write.
  void syncAutoHealth(project, forecast.deliveryStatus);

  return forecast;
}

/**
 * If a project opted into `autoHealth` AND the forecast produced a delivery
 * verdict, persist the corresponding `healthStatus` so the health dot
 * matches the forecast.
 *
 * Skips when:
 *   - `autoHealth` is false (PM manages health manually)
 *   - No `deliveryStatus` from the forecast (BASELINING / NO_TARGET / COMPLETE
 *     — not enough signal to override a human-set health)
 *   - Derived health already matches the current value (no-op)
 *
 * Errors are logged but swallowed — a failed sync shouldn't break the
 * forecast response. The next forecast call will retry.
 */
async function syncAutoHealth(
  project: { id: string; autoHealth: boolean; healthStatus: HealthStatus },
  deliveryStatus: DeliveryStatus | undefined,
): Promise<void> {
  if (!project.autoHealth || !deliveryStatus) return;
  const derived = forecastToHealth(deliveryStatus);
  if (project.healthStatus === derived) return;
  try {
    await prisma.project.update({
      where: { id: project.id },
      data: { healthStatus: derived },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    logger.error({ err, projectId: project.id }, '[projectForecast] auto-health sync failed');
  }
}

/** Pure mapping from delivery verdict → health dot. Exported for tests. */
export function forecastToHealth(d: DeliveryStatus): HealthStatus {
  switch (d) {
    case 'ON_TRACK': return 'GREEN' as HealthStatus;
    case 'AT_RISK':  return 'YELLOW' as HealthStatus;
    case 'BEHIND':   return 'RED' as HealthStatus;
  }
}

async function gatherInputs(projectId: string, targetDate: Date | null, now: Date): Promise<ForecastInputs> {
  // One query for all client-visible tasks.
  const tasks = await prisma.task.findMany({
    where: { projectId, clientVisible: true },
    select: { storyPoints: true, status: true },
  });

  // Second query: every DONE-transition in the lookback window. We join
  // through task to filter to client-visible only — keeps velocity
  // comparable to the remaining-points denominator.
  const lookbackStart = new Date(now.getTime() - LOOKBACK_WEEKS * 7 * 24 * 60 * 60 * 1000);
  const transitions = await prisma.taskStatusHistory.findMany({
    where: {
      toStatus: 'DONE' as TaskStatus,
      changedAt: { gte: lookbackStart },
      task: { projectId, clientVisible: true },
    },
    select: {
      changedAt: true,
      task: { select: { storyPoints: true } },
    },
  });

  return {
    tasks,
    doneTransitions: transitions.map((t) => ({
      changedAt: t.changedAt,
      storyPoints: t.task.storyPoints,
    })),
    targetDate,
    now,
  };
}

/** Pure: given inputs, produce a forecast. Exported for unit tests. */
export function computeFromInputs(inputs: ForecastInputs): ProjectForecast {
  const { tasks, doneTransitions, targetDate, now } = inputs;

  // ── 1. Scope totals ──
  const totalPoints = tasks.reduce((n, t) => n + (t.storyPoints ?? 0), 0);
  const donePoints = tasks
    .filter((t) => t.status === ('DONE' as TaskStatus))
    .reduce((n, t) => n + (t.storyPoints ?? 0), 0);
  const remainingPoints = Math.max(0, totalPoints - donePoints);
  const completionPct = totalPoints > 0 ? Math.round((donePoints / totalPoints) * 100) : 0;

  const targetDateIso = targetDate ? toISODate(targetDate) : undefined;

  // ── 2. Early-exit states ──
  if (totalPoints === 0) {
    return {
      status: 'BASELINING' as ForecastStatus,
      message: 'Establishing baseline — no client-visible work yet.',
      reason: 'No client-visible tasks have story points yet.',
      totalPoints: 0,
      donePoints: 0,
      remainingPoints: 0,
      completionPct: 0,
      targetDate: targetDateIso,
    };
  }

  if (remainingPoints === 0) {
    return {
      status: 'COMPLETE' as ForecastStatus,
      message: 'All client-visible work complete ✓',
      totalPoints,
      donePoints,
      remainingPoints: 0,
      completionPct: 100,
      targetDate: targetDateIso,
    };
  }

  if (totalPoints < MIN_TOTAL_POINTS_FOR_FORECAST || donePoints < MIN_DONE_POINTS_FOR_FORECAST) {
    return {
      status: 'BASELINING' as ForecastStatus,
      message: 'Establishing baseline — forecast available after first sprint.',
      reason: `Need ≥ ${MIN_TOTAL_POINTS_FOR_FORECAST} total and ≥ ${MIN_DONE_POINTS_FOR_FORECAST} done story points. Today: ${totalPoints} / ${donePoints}.`,
      totalPoints,
      donePoints,
      remainingPoints,
      completionPct,
      targetDate: targetDateIso,
    };
  }

  // ── 3. Weekly velocity series ──
  const weeklyHistory = computeWeeklyVelocity(doneTransitions, now, LOOKBACK_WEEKS);
  const recent = weeklyHistory.slice(-COMPLETE_WEEKS_USED);
  const velocity = mean(recent);
  const sigma = stddev(recent);

  // If nothing has actually shipped in the window, we can't forecast.
  if (velocity === 0) {
    return {
      status: 'BASELINING' as ForecastStatus,
      message: 'Activity paused — forecast suspended until tasks resume completing.',
      reason: `No client-visible tasks completed in the last ${LOOKBACK_WEEKS} weeks.`,
      totalPoints,
      donePoints,
      remainingPoints,
      completionPct,
      weeklyVelocityHistory: weeklyHistory,
      targetDate: targetDateIso,
    };
  }

  // ── 4. Dates (using working days = 5 per week) ──
  const expectedWeeks = remainingPoints / velocity;
  const optimisticWeeks = remainingPoints / (velocity + sigma);
  // Conservative rate = mean − 1 stddev. The naive floor of 0.5 here was
  // a bug: when stddev > mean (which happens any time velocity history
  // is sparse — e.g. a young project shipping [0,0,0,23] over 4 weeks
  // has sigma ≈ 10 vs mean 5.8), `velocity - sigma` is negative and the
  // clamp drags the conservative rate to 0.5 pts/wk. That produced
  // dates a YEAR past the expected date, alarming clients unnecessarily.
  // Floor the conservative rate at 30% of the mean instead — never less
  // than the absolute 0.5 backstop for the truly-degenerate case.
  const CONSERVATIVE_RATE_FLOOR_PCT = 0.3;
  const conservativeRate = Math.max(velocity - sigma, velocity * CONSERVATIVE_RATE_FLOOR_PCT, 0.5);
  const conservativeWeeks = remainingPoints / conservativeRate;

  const expectedDate = addWorkingDays(now, expectedWeeks * 5);
  const optimisticDate = addWorkingDays(now, optimisticWeeks * 5);
  const conservativeDate = addWorkingDays(now, conservativeWeeks * 5);

  // ── 5. Compare to target ──
  let deliveryStatus: DeliveryStatus | undefined;
  let daysFromTarget: number | undefined;
  if (targetDate) {
    daysFromTarget = daysBetween(targetDate, conservativeDate);
    if (daysFromTarget <= ON_TRACK_DAYS_THRESHOLD) {
      deliveryStatus = 'ON_TRACK';
    } else if (daysFromTarget <= AT_RISK_DAYS_THRESHOLD) {
      deliveryStatus = 'AT_RISK';
    } else {
      deliveryStatus = 'BEHIND';
    }
  }

  // ── 6. The headline message — what the UI shows verbatim ──
  const headlineDate = formatHumanDate(conservativeDate);
  let message: string;
  let status: ForecastStatus = 'FORECASTED';

  if (!targetDate) {
    status = 'NO_TARGET';
    message = `Estimated delivery: ${headlineDate} · ${completionPct}% complete · ${formatPace(velocity)}`;
  } else if (deliveryStatus === 'ON_TRACK') {
    message = `On track · expected ${headlineDate} · ${completionPct}% complete · ${formatPace(velocity)}`;
  } else if (deliveryStatus === 'AT_RISK') {
    message = `At risk · expected ${headlineDate} (${daysFromTarget}d past target) · ${completionPct}% complete`;
  } else {
    message = `Behind schedule · expected ${headlineDate} (${daysFromTarget}d past target) · ${completionPct}% complete`;
  }

  return {
    status,
    message,
    totalPoints,
    donePoints,
    remainingPoints,
    completionPct,
    velocityPerWeek: round1(velocity),
    velocityStdDev: round1(sigma),
    weeklyVelocityHistory: weeklyHistory,
    conservativeDate: toISODate(conservativeDate),
    expectedDate: toISODate(expectedDate),
    optimisticDate: toISODate(optimisticDate),
    targetDate: targetDateIso,
    daysFromTarget,
    deliveryStatus,
  };
}

// ── Helpers — pure functions, exported for tests ──────────────────────────

/**
 * Bucket DONE-transitions into per-ISO-week story-point totals. Returns the
 * series oldest-first, with leading zero-weeks trimmed so callers can do
 * `slice(-N)` to get "the last N weeks (possibly including zero weeks)".
 */
export function computeWeeklyVelocity(
  transitions: Array<{ changedAt: Date; storyPoints: number | null }>,
  now: Date,
  lookbackWeeks: number,
): number[] {
  // Bucket by week-offset from `now`. Week 0 = the 7 days ending at `now`,
  // week 1 = the 7 days before that, etc.
  const buckets = new Array(lookbackWeeks).fill(0);
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  for (const t of transitions) {
    const ageMs = now.getTime() - t.changedAt.getTime();
    const weekOffset = Math.floor(ageMs / msPerWeek);
    if (weekOffset >= 0 && weekOffset < lookbackWeeks) {
      buckets[weekOffset] += t.storyPoints ?? 0;
    }
  }
  // Reverse so the array is oldest → newest.
  return buckets.reverse();
}

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Add `n` working days (Mon-Fri) to a date. Negative `n` walks backwards. */
export function addWorkingDays(base: Date, n: number): Date {
  // Step in 1-day increments, skipping Saturday (6) and Sunday (0).
  // For non-integer n, we walk floor(n) days then round up via a small
  // fractional-day add. Forecast precision is at the day level anyway.
  const direction = n >= 0 ? 1 : -1;
  let remaining = Math.ceil(Math.abs(n));
  const out = new Date(base);
  while (remaining > 0) {
    out.setUTCDate(out.getUTCDate() + direction);
    const dow = out.getUTCDay();
    if (dow !== 0 && dow !== 6) remaining -= 1;
  }
  return out;
}

/** Whole calendar days between two dates (b - a). */
export function daysBetween(a: Date, b: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((b.getTime() - a.getTime()) / msPerDay);
}

export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatHumanDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatPace(velocity: number): string {
  return `${round1(velocity)} pts/wk`;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
