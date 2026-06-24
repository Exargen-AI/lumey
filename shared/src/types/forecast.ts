/**
 * Project delivery forecast — produced by `projectForecast.service.ts` on
 * the backend, consumed by the client project status page.
 *
 * The forecast answers "are we going to hit the project target date?" using
 * velocity computed from the project's own task-completion history. It's
 * deliberately conservative (mean − 1 stddev as the headline date) and
 * always surfaces its inputs so clients can see the math behind any number
 * they're shown.
 */

/** Coarse forecast outcome — determines what UI renders. */
export type ForecastStatus =
  /** Not enough completed work in the lookback window to project anything. */
  | 'BASELINING'
  /** Project has no `targetDate` set, so we show a date but no on-track badge. */
  | 'NO_TARGET'
  /** No client-visible work remains. Forecast is "done." */
  | 'COMPLETE'
  /** Normal — we have real numbers to show. */
  | 'FORECASTED';

/** Compared to the project's target date — only set when FORECASTED. */
export type DeliveryStatus = 'ON_TRACK' | 'AT_RISK' | 'BEHIND';

export interface ProjectForecast {
  status: ForecastStatus;

  /** A human-readable summary the UI can display verbatim. Always present. */
  message: string;

  /** When status is not FORECASTED, why. Surfaced in the tooltip. */
  reason?: string;

  // ── Scope ─────────────────────────────────────────────────────────────
  /** Sum of story points across all client-visible tasks. */
  totalPoints?: number;
  /** Story points completed (status === 'DONE'). */
  donePoints?: number;
  /** `totalPoints - donePoints`. */
  remainingPoints?: number;
  /** 0..100. Rounded to integer. */
  completionPct?: number;

  // ── Velocity ──────────────────────────────────────────────────────────
  /** Average story points completed per ISO week over the lookback window. */
  velocityPerWeek?: number;
  /** Standard deviation of the weekly-velocity series. Drives the date range. */
  velocityStdDev?: number;
  /**
   * Most recent N weekly velocities (oldest → newest). Provided for sparkline
   * rendering; UI may show only the last 4–6.
   */
  weeklyVelocityHistory?: number[];

  // ── Dates (ISO YYYY-MM-DD) ────────────────────────────────────────────
  /** Conservative date — mean − 1 stddev. Shown as the headline. */
  conservativeDate?: string;
  /** Expected date — mean of velocity history. */
  expectedDate?: string;
  /** Optimistic date — mean + 1 stddev. */
  optimisticDate?: string;
  /** Project's own target date, if set. */
  targetDate?: string;
  /** `conservativeDate - targetDate` in days. Negative = ahead of target. */
  daysFromTarget?: number;

  // ── Delivery status (only when FORECASTED + targetDate present) ───────
  deliveryStatus?: DeliveryStatus;
}
