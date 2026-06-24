/**
 * ACCESS POLICY (R5 lockdown, 2026-05-29)
 * =======================================
 * Productivity score data is **SUPER_ADMIN-only**. Any future API
 * endpoint or service method that returns composite scores, per-signal
 * sub-scores, raw productivity events, weight sets, or dispute records
 * MUST go through `requireProductivityScoreAccess` (Express) or
 * `assertProductivityScoreAccess` (service layer). See
 * `backend/src/middleware/requireProductivityScoreAccess.ts`.
 *
 * This overrides design Premise P6 which originally said employees
 * could see their own composite on TodayPage. Founder R5 directive:
 * "remember only super admin has access to all these metrics right?,
 * make sure only super admin is allowed".
 *
 * Pulse Multi-Signal Productivity Score — composite calculator.
 *
 * Combines per-signal sub-scores into a single 0-100 composite using
 * the active universal weight set. Universal weights (founder R3): one
 * set applied to every employee equally. No role bundles.
 *
 * Architecture:
 *   1. Worker fetches events for the window.
 *   2. Worker splits events by signal and runs each per-signal Scorer.
 *   3. Worker passes the SignalScore[] to `computeComposite()` below.
 *   4. computeComposite applies the renormalised universal weights.
 *   5. Result is upserted to `employee_productivity_scores`.
 *
 * Renormalisation: during the wave-1 rollout some signals are not yet
 * live (e.g. CODE before the GitHub webhook is installed). Their
 * weight is removed from the denominator so the composite is still
 * interpretable as 0-100, not capped at "the sum of live weights".
 *
 * Gaming-flag penalty: only CROSS-signal patterns (multiple signals
 * gamed in the same window) attract a composite-level penalty. Per-
 * signal gaming guards already zero out individual contributions
 * inside each scorer, so we don't double-count single-signal anomalies.
 */

import {
  PRODUCTIVITY_SIGNALS,
  SCORE_THRESHOLD_HIGH_DEFAULT,
  SCORE_THRESHOLD_LOW_DEFAULT,
  weightsSumValid,
  type ProductivitySignal,
  type ScoreBand,
  type SignalScore,
} from '@exargen/shared';

export interface CompositeInput {
  signalScores: SignalScore[];
  /**
   * Universal weight set as fetched from `universal_weight_sets`
   * (active row by effectiveFrom DESC). Must sum to ~1.0.
   */
  weights: Record<ProductivitySignal, number>;
  /** Score-band thresholds from the same weight-set row. */
  thresholdHigh?: number;
  thresholdLow?: number;
  /**
   * Signals not yet ingested in this window (e.g. CODE during wave-1).
   * Their contribution is excluded AND their weight is removed from the
   * denominator so the renormalised composite stays interpretable.
   */
  inactiveSignals?: ProductivitySignal[];
}

export interface CompositeResult {
  /** 0-100, two decimal places. */
  compositeScore: number;
  band: ScoreBand;
  /** Per-signal scores (echoed for the breakdown drawer). */
  signalScores: SignalScore[];
  /** Number of cross-signal gaming patterns detected. */
  crossSignalGamingFlags: number;
  /** Effective weights after renormalisation (sums to 1.0 over active signals). */
  appliedWeights: Record<ProductivitySignal, number>;
}

/**
 * Cross-signal gaming penalty: each pattern that fires across MULTIPLE
 * signals in the same window subtracts 5 from the composite. Per-
 * signal flags do NOT trigger this; they're already handled inside
 * each scorer. This term penalizes the rarer "everything gamed at
 * once" pattern.
 */
const CROSS_SIGNAL_PENALTY_PER_FLAG = 5;
/** Hard cap on the cross-signal penalty to prevent runaway negatives. */
const CROSS_SIGNAL_PENALTY_CAP = 30;

export function computeComposite(input: CompositeInput): CompositeResult {
  const {
    signalScores,
    weights,
    thresholdHigh = SCORE_THRESHOLD_HIGH_DEFAULT,
    thresholdLow = SCORE_THRESHOLD_LOW_DEFAULT,
    inactiveSignals = [],
  } = input;

  // Defensive: weights coming from the DB may have been corrupted. We
  // do NOT compute a score from a malformed weight set; the worker
  // should detect this and fall back to UNIVERSAL_WEIGHTS_R5.
  if (!weightsSumValid(weights)) {
    throw new Error(
      `Invalid weight set: weights must sum to 1.0 (±0.01); got ${Object.values(weights)
        .reduce((sum, w) => sum + (w || 0), 0)
        .toFixed(4)}`,
    );
  }

  const inactiveSet = new Set(inactiveSignals);
  const activeSignals = PRODUCTIVITY_SIGNALS.filter((s) => !inactiveSet.has(s));

  // Renormalise: weights of active signals sum to 1.0 in the applied set.
  const activeWeightSum = activeSignals.reduce((sum, s) => sum + (weights[s] || 0), 0);
  if (activeWeightSum === 0) {
    // Every signal is inactive — nothing to score. Return 0 (LOW).
    return zeroComposite(weights, thresholdHigh, thresholdLow);
  }

  const appliedWeights: Record<ProductivitySignal, number> = Object.fromEntries(
    PRODUCTIVITY_SIGNALS.map((s) => [
      s,
      inactiveSet.has(s) ? 0 : (weights[s] || 0) / activeWeightSum,
    ]),
  ) as Record<ProductivitySignal, number>;

  // Build a lookup by signal so the dot product handles missing entries
  // gracefully (signal with no events → SignalScore not in the array →
  // contributes 0).
  const scoreBySignal = new Map<ProductivitySignal, SignalScore>();
  for (const s of signalScores) {
    scoreBySignal.set(s.signal, s);
  }

  let weighted = 0;
  for (const sig of activeSignals) {
    const s = scoreBySignal.get(sig);
    const score = s?.score ?? 0;
    weighted += appliedWeights[sig] * score;
  }

  // Cross-signal gaming penalty: count distinct gaming-flag *types*
  // that fired across DIFFERENT signals in this window.
  const flagTypesPerSignal = new Map<ProductivitySignal, Set<string>>();
  for (const s of signalScores) {
    const flagTypes = new Set<string>();
    for (const f of s.gamingFlags) {
      // Strip count suffix: 'standup_too_short_count=3' → 'standup_too_short'
      const type = f.split(/_count=|=/)[0];
      flagTypes.add(type);
    }
    if (flagTypes.size > 0) flagTypesPerSignal.set(s.signal, flagTypes);
  }
  // Cross-signal = number of DIFFERENT signals that fired at least one
  // gaming guard. 1 signal flagged is normal; 3+ signals flagged at
  // once is a pattern.
  const signalsFlagged = flagTypesPerSignal.size;
  const crossSignalGamingFlags = Math.max(0, signalsFlagged - 1); // 1 flagged signal = no cross-signal penalty
  const crossSignalPenalty = Math.min(
    CROSS_SIGNAL_PENALTY_CAP,
    crossSignalGamingFlags * CROSS_SIGNAL_PENALTY_PER_FLAG,
  );

  const composite = clamp01_100(weighted - crossSignalPenalty);
  const band = bandFor(composite, thresholdHigh, thresholdLow);

  return {
    compositeScore: composite,
    band,
    signalScores,
    crossSignalGamingFlags,
    appliedWeights,
  };
}

function zeroComposite(
  weights: Record<ProductivitySignal, number>,
  thresholdHigh: number,
  thresholdLow: number,
): CompositeResult {
  return {
    compositeScore: 0,
    band: bandFor(0, thresholdHigh, thresholdLow),
    signalScores: [],
    crossSignalGamingFlags: 0,
    appliedWeights: Object.fromEntries(
      PRODUCTIVITY_SIGNALS.map((s) => [s, 0]),
    ) as Record<ProductivitySignal, number>,
  };
}

function bandFor(score: number, thresholdHigh: number, thresholdLow: number): ScoreBand {
  if (score >= thresholdHigh) return 'HIGH';
  if (score >= thresholdLow) return 'MEDIUM';
  return 'LOW';
}

function clamp01_100(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n * 100) / 100;
}
