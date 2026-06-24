/**
 * DEEP_WORK signal scorer — sustained focus quality.
 *
 * Measures: when the employee is at the keyboard, are they
 * flow-stating in real tools or bouncing across distractions?
 *
 * R5 weight: 0.22 (tied largest with EXECUTION). "Quality of time"
 * sits at the top of the score because builder-shop philosophy says
 * sustained focused execution wins.
 *
 * Data source: pulse.daily_focus events emitted by the
 * deviceTelemetry snapshot ingestion. Each event payload carries:
 *   productiveSeconds, activeSeconds  — productive-app categories
 *   focusBlocks                       — count of ≥25-min same-app blocks
 *   contextSwitches                   — total app-switches in the day
 *   distractionBurstMinutes           — runs of >15 min in ENTERTAINMENT
 *   tamperMinutes                     — total TAMPER-flagged minutes
 *
 * Score formula (R5):
 *   productive_ratio = productive_seconds / max(1, active_seconds)
 *   focus_quality    = min(50, focusBlocks * 5)   // capped contribution
 *   context_penalty  = -2 * max(0, switches_per_active_hour - 30)
 *   distraction_penalty = -1 per distraction-burst minute (capped at -15)
 *   tamper_penalty   = -tamperMinutes
 *   score = clamp(0, 100,
 *                 60 * productive_ratio + focus_quality + context_penalty
 *                 + distraction_penalty + tamper_penalty)
 *
 * Pure function. Side-effect free.
 */

import type { SignalScore } from '@exargen/shared';
import type { Scorer, ScorerInput } from './types';

const PRODUCTIVE_RATIO_WEIGHT = 60;
const FOCUS_BLOCK_POINTS = 5;
const FOCUS_BLOCK_CAP = 50;
const CONTEXT_SWITCH_THRESHOLD_PER_HR = 30;
const CONTEXT_PENALTY_PER_SWITCH = 2;
const DISTRACTION_PENALTY_PER_MINUTE = 1;
const DISTRACTION_PENALTY_CAP = 15;
/**
 * Wave 8 — tamper-penalty cap. The legacy model subtracted one point
 * per tamper-minute (so a single 6-hour mouse-jiggler day dropped
 * DEEP_WORK to 0 single-handedly). The new model uses `tamperRatio`
 * (share of active time flagged as tamper, 0..1, agent-emitted) and
 * caps the per-event penalty at 30. That way:
 *
 *   - 100% tamper in a window → -30 (still severe)
 *   - 10% tamper (e.g. one bathroom-break keep-awake spike) → -3
 *
 * Falls back to the old tamperMinutes math when the payload doesn't
 * carry `tamperRatio` (pre-Wave-8 events still in the rolling window).
 */
const TAMPER_RATIO_PENALTY_CAP = 30;

interface FocusPayload {
  /** "yyyy-mm-dd" in user-local timezone. */
  date: string;
  productiveSeconds: number;
  activeSeconds: number;
  focusBlocks: number;
  contextSwitches: number;
  distractionBurstMinutes: number;
  tamperMinutes: number;
  /** Wave 8 — share of active time spent on TAMPER-classified apps (0..1). */
  tamperRatio?: number;
  /** Wave 8 — share of active time spent on productive apps (0..1). */
  productiveRatio?: number;
}

export const scoreDeepWork: Scorer = (input: ScorerInput): SignalScore => {
  // baselines.DEEP_WORK?.minFocusBlockMinutes is a future tuning hook;
  // v1 uses the FOCUS_BLOCK_POINTS curve below, not a configurable
  // threshold. Plumbing is in place for v2 calibration.
  const { events } = input;

  // Aggregate across all daily-focus events in the window.
  let productiveSec = 0;
  let activeSec = 0;
  let focusBlocks = 0;
  let contextSwitches = 0;
  let distractionMin = 0;
  let tamperMin = 0;
  // Wave 8 — accumulate a weighted-by-activeSec average tamperRatio
  // across the window. Falls back to 0 (no penalty) when older events
  // without the field are the only thing we have.
  let tamperRatioWeightedSum = 0;
  let tamperRatioWeightTotal = 0;
  let daysCovered = 0;
  let preFlaggedCount = 0;

  for (const ev of events) {
    if (ev.gamingFlag) {
      preFlaggedCount += 1;
      continue;
    }
    if (ev.eventType !== 'pulse.daily_focus') continue;
    const payload = ev.rawPayload as unknown as FocusPayload;
    if (!payload) continue;

    const evActive = safeNumber(payload.activeSeconds);
    productiveSec += safeNumber(payload.productiveSeconds);
    activeSec += evActive;
    focusBlocks += safeNumber(payload.focusBlocks);
    contextSwitches += safeNumber(payload.contextSwitches);
    distractionMin += safeNumber(payload.distractionBurstMinutes);
    tamperMin += safeNumber(payload.tamperMinutes);
    if (typeof payload.tamperRatio === 'number' && Number.isFinite(payload.tamperRatio)) {
      tamperRatioWeightedSum += Math.max(0, Math.min(1, payload.tamperRatio)) * evActive;
      tamperRatioWeightTotal += evActive;
    }
    daysCovered += 1;
  }

  const productiveRatio = activeSec > 0 ? productiveSec / activeSec : 0;
  const productiveContribution = PRODUCTIVE_RATIO_WEIGHT * productiveRatio;

  const focusQuality = Math.min(FOCUS_BLOCK_CAP, focusBlocks * FOCUS_BLOCK_POINTS);

  // Context-switch penalty: switches per active hour above 30 hurt.
  // Quiet days (no active time) can't be context-thrashed.
  const activeHours = activeSec / 3600;
  const switchesPerHour = activeHours > 0 ? contextSwitches / activeHours : 0;
  const contextPenalty =
    CONTEXT_PENALTY_PER_SWITCH * Math.max(0, switchesPerHour - CONTEXT_SWITCH_THRESHOLD_PER_HR);

  const distractionPenalty = Math.min(
    DISTRACTION_PENALTY_CAP,
    DISTRACTION_PENALTY_PER_MINUTE * distractionMin,
  );

  // Wave 8 — proportional tamper penalty. Use the activeSec-weighted
  // average tamperRatio when at least one event carried it (post-Wave-8
  // events). Otherwise fall back to the legacy per-minute model so
  // events emitted before the upgrade still produce a sane number.
  const avgTamperRatio =
    tamperRatioWeightTotal > 0 ? tamperRatioWeightedSum / tamperRatioWeightTotal : null;
  const tamperPenalty =
    avgTamperRatio != null
      ? TAMPER_RATIO_PENALTY_CAP * avgTamperRatio
      : tamperMin;

  const rawScore =
    productiveContribution + focusQuality - contextPenalty - distractionPenalty - tamperPenalty;
  const score = clamp01_100(rawScore);

  const gamingFlags: string[] = [];
  if (tamperMin > 0) gamingFlags.push(`deep_work_tamper_minutes=${tamperMin}`);
  if (preFlaggedCount > 0) {
    gamingFlags.push(`deep_work_write_time_flagged_count=${preFlaggedCount}`);
  }
  if (switchesPerHour > CONTEXT_SWITCH_THRESHOLD_PER_HR) {
    gamingFlags.push(`high_context_switching_per_hour=${round2(switchesPerHour)}`);
  }

  return {
    signal: 'DEEP_WORK',
    score,
    rawBreakdown: {
      productive_seconds: productiveSec,
      active_seconds: activeSec,
      productive_ratio: round2(productiveRatio),
      focus_blocks: focusBlocks,
      focus_quality_pts: round2(focusQuality),
      context_switches: contextSwitches,
      switches_per_hour: round2(switchesPerHour),
      distraction_minutes: distractionMin,
      tamper_minutes: tamperMin,
      tamper_ratio_avg: avgTamperRatio != null ? round2(avgTamperRatio) : 0,
      tamper_penalty_model: avgTamperRatio != null ? 'ratio' : 'legacy_minutes',
      days_covered: daysCovered,
      productive_contribution: round2(productiveContribution),
      context_penalty: round2(contextPenalty),
      distraction_penalty: round2(distractionPenalty),
      tamper_penalty: round2(tamperPenalty),
    },
    gamingFlags,
  };
};

function safeNumber(n: unknown): number {
  if (typeof n === 'number' && Number.isFinite(n) && n >= 0) return n;
  return 0;
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
