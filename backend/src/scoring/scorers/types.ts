/**
 * Pulse Multi-Signal Productivity Score — per-signal Scorer contract.
 *
 * Each of the 7 signals (STANDUP, EXECUTION, CODE, COMMUNICATION,
 * PRESENCE, DEEP_WORK, DEVICE_HYGIENE) ships an implementation of
 * `Scorer` that turns a window of raw events into a 0-100 sub-score
 * plus a breakdown + any gaming-guard flags that fired.
 *
 * Scorers are PURE FUNCTIONS over their inputs. They never read from
 * the database directly — the recompute worker hands them the events
 * for the window. Pureness is the property that makes recompute cheap
 * (change a weight, re-run the scorer over the existing event log,
 * done) and that makes unit testing trivial.
 *
 * Universal weights mean every employee runs through every scorer.
 * If a user has zero events for a signal (e.g. a PM who didn't push
 * code), the scorer returns `{ score: 0, rawBreakdown: { ... }, ... }`
 * — that 0 is a real signal, not a missing value.
 */

import type {
  ProductivitySignal,
  SignalBaselines,
  SignalScore,
} from '@exargen/shared';

/**
 * Raw input handed to a scorer for one (user, window) pair.
 *
 * The recompute worker fetches all `productivity_events` for the user
 * across the rolling 30-day window, then splits them by signal and
 * hands each subset to the matching scorer.
 *
 * `workingDays` is computed by the worker from the user's PTO entries
 * + the calendar — PTO days don't punish the score (premise P3). For
 * windows with no PTO entries, this is just the count of weekdays in
 * the window.
 */
export interface ScorerInput {
  userId: string;
  /** Inclusive, user-local-timezone. */
  windowStart: Date;
  windowEnd: Date;
  /**
   * Total Mon-Fri days across the ENTIRE window (~22 for a month).
   * Kept for context/display; rate-based scorers should prefer
   * `elapsedWorkingDays` as their denominator.
   */
  workingDays: number;
  /**
   * Mon-Fri days that have ELAPSED so far in the window
   * (start → min(now, end)). This is the correct denominator for
   * "per working day" rate scorers (PRESENCE, STANDUP) — dividing
   * partial-period activity by the full-period `workingDays` made
   * weekly/monthly scores read low for every day except the last of
   * the period. Never 0 in practice (scorers floor at 1). For DAILY
   * this equals `workingDays`.
   *
   * Optional so older callers/tests that only pass `workingDays`
   * still compile; scorers fall back to `workingDays` when it's
   * undefined.
   */
  elapsedWorkingDays?: number;
  /**
   * All `productivity_events` rows for this user + signal within the
   * window. Already filtered by signal; scorers don't need to filter
   * by event_type unless they care about sub-types.
   */
  events: ScorerEvent[];
  /** Per-signal numerical anchors from the active universal_weight_set row. */
  baselines: SignalBaselines;
}

/**
 * Shape of the event rows the scorer sees. Subset of the Prisma
 * `ProductivityEvent` model — only the fields a pure scorer needs.
 * Decoupled from the Prisma type so scorers don't drag in @prisma/client
 * at runtime (smaller bundle for the worker; easier to test).
 */
export interface ScorerEvent {
  id: string;
  signal: ProductivitySignal;
  eventType: string;
  occurredAt: Date;
  rawPayload: Record<string, unknown>;
  scoreDelta: number | null;
  gamingFlag: string | null;
  source: string;
  sourceId: string;
}

/**
 * Each scorer is a single named function in its module:
 *
 *   import { scoreStandup } from './scorers/standup.scorer';
 *   const result: SignalScore = scoreStandup(input);
 *
 * The composite scorer holds a Record<ProductivitySignal, Scorer> and
 * iterates it. Adding a new signal = adding a file + one entry to the
 * map; no other code changes.
 */
export type Scorer = (input: ScorerInput) => SignalScore;
