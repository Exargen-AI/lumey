/**
 * EXECUTION signal scorer — task-completion velocity.
 *
 * Measures: did the employee actually close real units of work in the
 * window, weighted by complexity?
 *
 * R5 weight: 0.22 (tied largest single weight). EXECUTION is the
 * "real output" signal in the composite — tasks closed are THE unit
 * of work at Exargen-AI.
 *
 * Score formula (R5, log-scaled against universal weekly baseline):
 *   completed_points = sum of storyPoints for non-guarded task.closed events
 *   target_for_window = baselines.EXECUTION.weeklyPoints (default 8)
 *                       × (window_days / 7)
 *   score = min(100, 50 + 50 * log10(completed_points / target_for_window + 1) * 4)
 *
 * The log scaling rewards consistent execution without making outsized
 * weeks dominate. An employee who hits target every week gets ~75. An
 * employee who 2× target gets ~90. An employee at 0.5× target gets
 * ~50.
 *
 * Gaming guards (applied at score time):
 *   task_closed_too_fast: closed <60 min after creation → ignored
 *   task_self_resolve_no_comments: same user created+closed, 0 comments → ignored
 *   task_no_description: empty/missing description → ignored
 *
 * Pure function. Side-effect free.
 */

import type { SignalScore } from '@exargen/shared';
import type { Scorer, ScorerInput } from './types';

const DEFAULT_WEEKLY_POINTS = 8;
/** Story points credited to a task that doesn't have an explicit value set. */
const DEFAULT_TASK_POINTS = 1;
/** Score curve coefficient — tuned so target = 75, 2× target = ~90. */
const LOG_COEFFICIENT = 4;

interface TaskClosedPayload {
  taskId: string;
  /** Story points if set; else DEFAULT_TASK_POINTS. */
  storyPoints?: number | null;
  createdAt: string; // ISO
  closedAt: string; // ISO
  /** Whether the closer is also the creator. */
  selfResolved?: boolean;
  /** Number of comments on the task at close time. */
  commentCount?: number;
  /** Whether the task body has any non-trivial content. */
  hasDescription?: boolean;
}

export const scoreExecution: Scorer = (input: ScorerInput): SignalScore => {
  const { events, windowStart, windowEnd, baselines } = input;

  let completedPoints = 0;
  let countedTasks = 0;
  let tooFastCount = 0;
  let selfResolveCount = 0;
  let noDescriptionCount = 0;
  let preFlaggedAtWriteCount = 0;

  // Sort by occurredAt so deterministic processing order produces
  // deterministic flag counts even if events arrive out of order.
  const closedEvents = events
    .filter((ev) => ev.eventType === 'task.closed')
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  for (const ev of closedEvents) {
    // Events the outbox writer already flagged at write time (e.g. a
    // task closed too fast). Counted in the gaming-flags total but no
    // points credited.
    if (ev.gamingFlag) {
      preFlaggedAtWriteCount += 1;
      continue;
    }

    const payload = ev.rawPayload as unknown as TaskClosedPayload;
    if (!payload) continue;

    // Guard: closed in <60 min of creation.
    if (payload.createdAt && payload.closedAt) {
      const created = Date.parse(payload.createdAt);
      const closed = Date.parse(payload.closedAt);
      if (Number.isFinite(created) && Number.isFinite(closed)) {
        const ageMs = closed - created;
        if (ageMs < 60 * 60 * 1000) {
          tooFastCount += 1;
          continue;
        }
      }
    }

    // Guard: self-resolved + zero comments. Likely a self-managed
    // grooming task; legitimately not measurable output.
    if (payload.selfResolved && (payload.commentCount ?? 0) === 0) {
      selfResolveCount += 1;
      continue;
    }

    // Guard: no description. Either a placeholder or a task that
    // wasn't actually scoped.
    if (payload.hasDescription === false) {
      noDescriptionCount += 1;
      continue;
    }

    const points = numericPoints(payload.storyPoints);
    completedPoints += points;
    countedTasks += 1;
  }

  // Window length in weeks (used to scale the per-week baseline up to
  // the actual window covered).
  const windowDays = Math.max(
    1,
    Math.round((windowEnd.getTime() - windowStart.getTime()) / (24 * 60 * 60 * 1000)) + 1,
  );
  const windowWeeks = windowDays / 7;
  const weeklyTarget = baselines.EXECUTION?.weeklyPoints ?? DEFAULT_WEEKLY_POINTS;
  const targetForWindow = Math.max(0.5, weeklyTarget * windowWeeks);

  // Score curve. The log10 gives:
  //   completed = 0     →  base of 50 - 50*log10(1)*4 = 50 (uses floor)
  //   completed = target → 50 + 50*log10(2)*4 ≈ 50 + 60 → capped at 100
  //   Actually: log10(2) ≈ 0.301, so 50*0.301*4 ≈ 60 → score ≈ 110, clamped to 100.
  //   The intended curve: target = 75, 2× = 90, 0× = 0.
  // Re-tune: use 25 + 50 * (completed / target + small) without log.
  // Simpler: linear up to target → 75, then log-saturate to 100.
  let score: number;
  if (completedPoints <= 0) {
    score = 0;
  } else {
    const ratio = completedPoints / targetForWindow;
    if (ratio >= 1) {
      // At or above target: log-saturate from 75 toward 100
      score = Math.min(100, 75 + 25 * Math.log10(1 + (ratio - 1) * LOG_COEFFICIENT));
    } else {
      // Below target: linear ramp from 0 → 75 as ratio goes 0 → 1
      score = Math.max(0, ratio * 75);
    }
  }

  const gamingFlags: string[] = [];
  if (tooFastCount > 0) gamingFlags.push(`task_closed_too_fast_count=${tooFastCount}`);
  if (selfResolveCount > 0)
    gamingFlags.push(`task_self_resolve_no_comments_count=${selfResolveCount}`);
  if (noDescriptionCount > 0)
    gamingFlags.push(`task_no_description_count=${noDescriptionCount}`);
  if (preFlaggedAtWriteCount > 0)
    gamingFlags.push(`task_write_time_flagged_count=${preFlaggedAtWriteCount}`);

  return {
    signal: 'EXECUTION',
    score: round2(score),
    rawBreakdown: {
      counted_tasks: countedTasks,
      completed_points: completedPoints,
      target_points: round2(targetForWindow),
      weekly_target_baseline: weeklyTarget,
      window_weeks: round2(windowWeeks),
      task_closed_too_fast: tooFastCount,
      task_self_resolve_no_comments: selfResolveCount,
      task_no_description: noDescriptionCount,
      write_time_flagged: preFlaggedAtWriteCount,
      total_close_events: closedEvents.length,
    },
    gamingFlags,
  };
};

function numericPoints(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  return DEFAULT_TASK_POINTS;
}

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}
