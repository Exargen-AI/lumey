// Pulse Multi-Signal Productivity Score — shared wire types (R5).
//
// Shared between backend (computes the score) and frontend (renders
// the Reports tab and TodayPage self-view card). Dates serialize as
// ISO strings over the wire.
//
// Universal weights — every employee scored against the same formula
// (founder R3 correction: no role-based weighting). See
// docs/pulse/04-productivity-scoring.md for the full design.

/**
 * The 7 signals that contribute to the composite score (R5).
 * Mirror of the Prisma `ProductivitySignal` enum.
 */
export type ProductivitySignal =
  | 'STANDUP'        // daily standup discipline
  | 'EXECUTION'      // tasks closed
  | 'CODE'           // git contribution
  | 'COMMUNICATION'  // comments + mentions
  | 'PRESENCE'       // clock + Pulse active + login discipline
  | 'DEEP_WORK'      // sustained focus + productive-app ratio
  | 'DEVICE_HYGIENE'; // security posture + patches + uptime

export const PRODUCTIVITY_SIGNALS: ProductivitySignal[] = [
  'STANDUP',
  'EXECUTION',
  'CODE',
  'COMMUNICATION',
  'PRESENCE',
  'DEEP_WORK',
  'DEVICE_HYGIENE',
];

export type ProductivityCadence = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export type ScoreBand = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * R5 universal weight set seeded into the database on first migration.
 * Stays here as a constant so callers can reason about defaults
 * without hitting the DB. The "live" set comes from
 * `universal_weight_sets` (ordered by effectiveFrom DESC, take first).
 *
 * Weights must sum to 1.00 ± 0.01.
 */
export const UNIVERSAL_WEIGHTS_R5: Record<ProductivitySignal, number> = {
  STANDUP: 0.13,
  EXECUTION: 0.22,
  CODE: 0.10,
  COMMUNICATION: 0.10,
  PRESENCE: 0.18,
  DEEP_WORK: 0.22,
  DEVICE_HYGIENE: 0.05,
};

export const SCORE_THRESHOLD_HIGH_DEFAULT = 75;
export const SCORE_THRESHOLD_LOW_DEFAULT = 40;

/**
 * Per-signal baselines — the numerical anchors each scorer uses to
 * normalise raw counts into a 0-100 sub-score. Tunable across the
 * company from `universal_weight_sets.signalBaselines`.
 */
export interface SignalBaselines {
  EXECUTION?: { weeklyPoints: number };           // tasks: target story-points / week (default 8)
  PRESENCE?: { targetAvgHours: number };           // hours: target daily average (default 8)
  DEEP_WORK?: { minFocusBlockMinutes: number };    // focus: min sustained-app block to count (default 25)
  CODE?: { weeklyMergedPRs: number };              // code: target merged PRs / week (default 3)
  COMMUNICATION?: { weeklyThreads: number };       // comms: target thread participations / week (default 5)
}

export const SIGNAL_BASELINES_DEFAULT: SignalBaselines = {
  EXECUTION: { weeklyPoints: 8 },
  PRESENCE: { targetAvgHours: 8 },
  DEEP_WORK: { minFocusBlockMinutes: 25 },
  CODE: { weeklyMergedPRs: 3 },
  COMMUNICATION: { weeklyThreads: 5 },
};

/**
 * Verifies that a weight set sums to 1.00 (± 0.01 tolerance).
 * Used at write-time (admin PATCH on weights) AND at read-time before
 * applying weights to a recompute — defends against a corrupted JSONB
 * row producing a score outside [0, 100].
 */
export function weightsSumValid(weights: Record<ProductivitySignal, number>): boolean {
  const total = Object.values(weights).reduce((sum, w) => sum + (w || 0), 0);
  return Math.abs(total - 1.0) < 0.01;
}

/**
 * One signal's contribution to the composite. Carried back to the UI
 * for the breakdown drawer + audit trail.
 */
export interface SignalScore {
  signal: ProductivitySignal;
  /** 0-100. Computed by the per-signal scorer. */
  score: number;
  /**
   * Raw counts that fed the score (e.g. `{ standups_submitted: 18 }`).
   * Shape varies per signal; rendered as a key/value list in the UI.
   * Values can be primitives or nested objects (e.g. per-penalty
   * breakdown in DEVICE_HYGIENE).
   */
  rawBreakdown: Record<
    string,
    number | string | boolean | null | Record<string, number | string | boolean | null>
  >;
  /**
   * Names of gaming guards that fired in this window
   * (e.g. `['standup_too_short_count=3']`). Each entry corresponds to
   * a `productivity_events.gamingFlag` row.
   */
  gamingFlags: string[];
}

/**
 * Composite score for one (user, window, cadence) row. The shape on
 * the wire matches what the frontend renders directly.
 */
export interface CompositeScoreDTO {
  userId: string;
  /** Inclusive, user-local-timezone calendar day. */
  windowStart: string; // ISO YYYY-MM-DD
  windowEnd: string;
  cadence: ProductivityCadence;
  /** 0-100, two decimal places. */
  compositeScore: number;
  band: ScoreBand;
  signalScores: SignalScore[];
  /** Calibration metadata: PTO days, gaming flags, burnout warnings. */
  flags: {
    ptoDays?: number;
    partialDays?: number;
    gamingFlagsCount?: number;
    burnoutWarnings?: string[];
    /**
     * Signals not yet ingested (e.g. CODE while GitHub webhook is
     * being installed) so the score is computed over a renormalised
     * subset. UI shows a `5 of 7 signals active` chip when non-empty.
     */
    inactiveSignals?: ProductivitySignal[];
  };
  computedAt: string; // ISO datetime
  computedFromEventCount: number;
}

/**
 * Audit-trail-grade detail for "why is this score what it is" UI.
 * Returned by GET /admin/pulse/scores/:userId/breakdown?window=...
 * Includes every `productivity_events` row that fed the calculation.
 */
export interface ScoreBreakdownDTO extends CompositeScoreDTO {
  weightsApplied: Record<ProductivitySignal, number>;
  thresholdHigh: number;
  thresholdLow: number;
  events: Array<{
    id: string;
    signal: ProductivitySignal;
    eventType: string;
    occurredAt: string;
    source: string;
    sourceId: string;
    scoreDelta: number | null;
    gamingFlag: string | null;
    rawPayload: Record<string, unknown>;
  }>;
}

/**
 * Self-identified employee profile data (display only — never read by
 * the scorer per R3).
 */
export interface EmployeeProfileDTO {
  userId: string;
  selfRole:
    | 'ENGINEER'
    | 'PM'
    | 'DESIGNER'
    | 'OPS'
    | 'SALES'
    | 'FOUNDER'
    | 'OTHER'
    | null;
  bio: string | null;
  /**
   * If non-null, SUPER_ADMIN has overridden universal weights for this
   * individual (emergency escape hatch — new-hire ramp, role
   * transition). UI surfaces a "custom weights" badge when set.
   */
  hasCustomWeights: boolean;
  updatedAt: string;
}
