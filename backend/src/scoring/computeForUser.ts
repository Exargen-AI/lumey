/**
 * Pulse productivity score — per-user recompute orchestrator.
 *
 * Given one user's events across a rolling 30-day window plus the
 * active universal weight set, compute their composite score for all
 * three cadences (DAILY / WEEKLY / MONTHLY) and return a payload the
 * worker can upsert.
 *
 * Pure function from the perspective of the caller — no DB I/O. The
 * worker fetches events + weights once per cycle and hands them in.
 *
 * Why this lives in its own file: the worker (`recomputeWorker.ts`)
 * is concerned with polling, debouncing, and DB writes; this module
 * is concerned only with "given these inputs, what scores come out?".
 * Separating them makes both trivially testable.
 */

import {
  PRODUCTIVITY_SIGNALS,
  SIGNAL_BASELINES_DEFAULT,
  UNIVERSAL_WEIGHTS_R5,
  type ProductivityCadence,
  type ProductivitySignal,
  type SignalBaselines,
  type SignalScore,
} from '@exargen/shared';
import { computeComposite } from './compositeScorer';
import {
  currentWindowFor,
  eventsInWindow,
  rolling30DayWindow,
  type Window,
} from './scoreCadences';
import { scoreStandup } from './scorers/standup.scorer';
import { scoreExecution } from './scorers/execution.scorer';
import { scoreCode } from './scorers/code.scorer';
import { scoreCommunication } from './scorers/communication.scorer';
import { scorePresence } from './scorers/presence.scorer';
import { scoreDeepWork } from './scorers/deepWork.scorer';
import { scoreDeviceHygiene } from './scorers/deviceHygiene.scorer';
import type { Scorer, ScorerEvent } from './scorers/types';

/** Map signal → its scorer. Adding a new signal = new file + new entry. */
const SCORERS: Record<ProductivitySignal, Scorer> = {
  STANDUP: scoreStandup,
  EXECUTION: scoreExecution,
  CODE: scoreCode,
  COMMUNICATION: scoreCommunication,
  PRESENCE: scorePresence,
  DEEP_WORK: scoreDeepWork,
  DEVICE_HYGIENE: scoreDeviceHygiene,
};

export interface ActiveWeightSet {
  weights: Record<ProductivitySignal, number>;
  signalBaselines: SignalBaselines;
  thresholdHigh: number;
  thresholdLow: number;
}

export interface ComputeForUserInput {
  userId: string;
  /** All productivity events for this user across the rolling 30d window. */
  events: ScorerEvent[];
  /** Active universal_weight_sets row (or default seeded values). */
  weightSet: ActiveWeightSet;
  /** Override for `now`. Tests pass a fixed timestamp. */
  now?: Date;
  /**
   * Signals not yet ingested in this window. The composite excludes
   * them from the denominator so the score stays interpretable as
   * 0-100 during wave rollouts. Defaults to empty (all 7 active).
   */
  inactiveSignals?: ProductivitySignal[];
}

export interface ComputedScoreForCadence {
  cadence: ProductivityCadence;
  windowStart: Date;
  windowEnd: Date;
  workingDays: number;
  compositeScore: number;
  band: 'HIGH' | 'MEDIUM' | 'LOW';
  signalScores: Record<ProductivitySignal, SignalScore>;
  /** Aggregate of all signal sub-score breakdowns, keyed by signal. */
  rawBreakdown: Record<ProductivitySignal, SignalScore['rawBreakdown']>;
  flags: {
    gamingFlagsCount: number;
    inactiveSignals: ProductivitySignal[];
  };
  computedFromEventCount: number;
}

export interface ComputeForUserResult {
  userId: string;
  daily: ComputedScoreForCadence;
  weekly: ComputedScoreForCadence;
  monthly: ComputedScoreForCadence;
  rollingWindow: Window;
}

/**
 * Default weight set used when the DB has no row yet (boot, fresh DB
 * before seedUniversalWeights runs). Worker calls this so the score
 * pipeline doesn't break on a cold start.
 */
export function defaultWeightSet(): ActiveWeightSet {
  return {
    weights: { ...UNIVERSAL_WEIGHTS_R5 },
    signalBaselines: { ...SIGNAL_BASELINES_DEFAULT },
    thresholdHigh: 75,
    thresholdLow: 40,
  };
}

/**
 * Run all 7 scorers + composite for each cadence.
 *
 * Implementation strategy: fetch events once (the rolling 30d window
 * covers everything monthly needs), then sub-filter per cadence
 * window inside this function. ~3× cheaper than three separate
 * fetches; correctness is identical.
 */
export function computeForUser(input: ComputeForUserInput): ComputeForUserResult {
  const now = input.now ?? new Date();
  const rolling = rolling30DayWindow(now);
  const inactive = input.inactiveSignals ?? [];

  const daily = computeForCadence('DAILY', input, now);
  const weekly = computeForCadence('WEEKLY', input, now);
  const monthly = computeForCadence('MONTHLY', input, now);

  void inactive; // already consumed inside computeForCadence
  return {
    userId: input.userId,
    daily,
    weekly,
    monthly,
    rollingWindow: rolling,
  };
}

function computeForCadence(
  cadence: ProductivityCadence,
  input: ComputeForUserInput,
  now: Date,
): ComputedScoreForCadence {
  const window = currentWindowFor(cadence, now);
  const windowEvents = eventsInWindow(input.events, window);
  const inactive = input.inactiveSignals ?? [];

  // Run each signal scorer over its slice of the window's events.
  const signalScoresMap = {} as Record<ProductivitySignal, SignalScore>;
  for (const signal of PRODUCTIVITY_SIGNALS) {
    if (inactive.includes(signal)) {
      // Not yet ingested — produce a stub score=0 so the breakdown
      // still has an entry but composite renormalisation drops it.
      signalScoresMap[signal] = {
        signal,
        score: 0,
        rawBreakdown: { inactive: 1 },
        gamingFlags: [],
      };
      continue;
    }
    const slice = windowEvents.filter((e) => e.signal === signal);
    signalScoresMap[signal] = SCORERS[signal]({
      userId: input.userId,
      windowStart: window.start,
      windowEnd: window.end,
      workingDays: window.workingDays,
      // 2026-06-01 — rate-based scorers (PRESENCE, STANDUP) divide by
      // elapsed working days so weekly/monthly scores reflect "per
      // working day so far" rather than reading low until the period
      // ends. See scoreCadences.Window.elapsedWorkingDays.
      elapsedWorkingDays: window.elapsedWorkingDays,
      events: slice,
      baselines: input.weightSet.signalBaselines,
    });
  }

  const composite = computeComposite({
    signalScores: Object.values(signalScoresMap),
    weights: input.weightSet.weights,
    thresholdHigh: input.weightSet.thresholdHigh,
    thresholdLow: input.weightSet.thresholdLow,
    inactiveSignals: inactive,
  });

  const rawBreakdown = {} as Record<ProductivitySignal, SignalScore['rawBreakdown']>;
  let gamingFlagsCount = 0;
  for (const signal of PRODUCTIVITY_SIGNALS) {
    rawBreakdown[signal] = signalScoresMap[signal].rawBreakdown;
    gamingFlagsCount += signalScoresMap[signal].gamingFlags.length;
  }

  return {
    cadence,
    windowStart: window.start,
    windowEnd: window.end,
    workingDays: window.workingDays,
    compositeScore: composite.compositeScore,
    band: composite.band,
    signalScores: signalScoresMap,
    rawBreakdown,
    flags: {
      gamingFlagsCount,
      inactiveSignals: inactive,
    },
    computedFromEventCount: windowEvents.length,
  };
}
