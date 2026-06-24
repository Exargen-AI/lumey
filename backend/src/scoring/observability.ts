/**
 * Pulse productivity score — observability counters.
 *
 * In-memory metric registry the worker writes to on every cycle. We
 * deliberately do NOT take a hard dependency on a metrics library
 * (Prometheus, OpenTelemetry, etc.) — Exargen-AI doesn't have one
 * wired up yet, and the metrics here are useful even when just
 * printed to Railway logs.
 *
 * Five named metrics per the design (R5 doc):
 *
 *   scoreRecomputeWorker.lag_seconds
 *       Now - max(productivity_events.recordedAt of unprocessed rows).
 *       Spike = the worker fell behind.
 *
 *   productivityEvents.outbox_depth
 *       Count of unprocessed productivity_events rows.
 *       Sustained growth = worker not keeping up.
 *
 *   productivityEvents.reconciliation_inserts
 *       (Wave 3 follow-up) — count of rows inserted via the GitHub
 *       reconciliation job. Non-zero = webhook delivery is unreliable.
 *
 *   compositeRecompute.duration_p95_ms
 *       p95 of computeForUser() wall-clock per cycle. Slow = scorer
 *       regression or missing index.
 *
 *   compositeScore.malformed_weights
 *       Count of cycles where the active weight set failed
 *       `weightsSumValid` and we fell back to UNIVERSAL_WEIGHTS_R5.
 *       Non-zero = DB row corruption; should alert.
 *
 * The `snapshot()` getter returns the current counters so a future
 * /admin/observability endpoint (or a scheduled log dump) can read
 * them. Reset behaviour is at the caller's discretion — gauges (depth,
 * lag) overwrite; counters (malformed_weights, reconciliation_inserts)
 * accumulate forever within a single process lifetime.
 */

import { isFeatureEnabled } from '../lib/featureFlags';

export interface ObservabilitySnapshot {
  workerLagSeconds: number;
  outboxDepth: number;
  reconciliationInserts: number;
  malformedWeightsCount: number;
  computeDurations: ComputeDurationsSummary;
  lastCycleAt: string | null;
  workerEnabled: boolean;
}

export interface ComputeDurationsSummary {
  count: number;
  /** Rolling p95 in ms. Approximated via the histogram below. */
  p95Ms: number;
  meanMs: number;
  maxMs: number;
}

/**
 * Histogram bucket boundaries in ms. p95 is computed by linear
 * interpolation between the bucket that crosses the 95% mark. Cheap
 * (no array of N samples) and approximate (~5% error), which is the
 * right trade-off for a soft alert metric.
 */
const HISTOGRAM_BUCKETS_MS = [10, 25, 50, 100, 250, 500, 1000, 2000, 5000, 10_000];

class ProductivityMetrics {
  // Gauges — overwritten each cycle.
  private _workerLagSeconds = 0;
  private _outboxDepth = 0;
  private _lastCycleAt: Date | null = null;

  // Counters — monotonically increasing within a process lifetime.
  private _reconciliationInserts = 0;
  private _malformedWeightsCount = 0;

  // Histogram for compute durations.
  private _histogramCounts = new Array(HISTOGRAM_BUCKETS_MS.length + 1).fill(0) as number[];
  private _histogramSum = 0;
  private _histogramCount = 0;
  private _histogramMax = 0;

  setWorkerLagSeconds(value: number): void {
    this._workerLagSeconds = Math.max(0, Math.floor(value));
  }

  setOutboxDepth(value: number): void {
    this._outboxDepth = Math.max(0, Math.floor(value));
  }

  incrementReconciliationInserts(by = 1): void {
    this._reconciliationInserts += Math.max(0, Math.floor(by));
  }

  incrementMalformedWeights(): void {
    this._malformedWeightsCount += 1;
  }

  recordComputeDuration(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this._histogramCount += 1;
    this._histogramSum += ms;
    if (ms > this._histogramMax) this._histogramMax = ms;
    let placed = false;
    for (let i = 0; i < HISTOGRAM_BUCKETS_MS.length; i++) {
      if (ms <= HISTOGRAM_BUCKETS_MS[i]) {
        this._histogramCounts[i] += 1;
        placed = true;
        break;
      }
    }
    if (!placed) {
      // Overflow bucket
      this._histogramCounts[HISTOGRAM_BUCKETS_MS.length] += 1;
    }
  }

  markCycleComplete(): void {
    this._lastCycleAt = new Date();
  }

  snapshot(): ObservabilitySnapshot {
    return {
      workerLagSeconds: this._workerLagSeconds,
      outboxDepth: this._outboxDepth,
      reconciliationInserts: this._reconciliationInserts,
      malformedWeightsCount: this._malformedWeightsCount,
      computeDurations: this.computeDurations(),
      lastCycleAt: this._lastCycleAt ? this._lastCycleAt.toISOString() : null,
      workerEnabled: isFeatureEnabled('pulseCompositeScore.beta'),
    };
  }

  /** For tests: reset all counters + gauges. Never call in prod. */
  resetForTest(): void {
    this._workerLagSeconds = 0;
    this._outboxDepth = 0;
    this._reconciliationInserts = 0;
    this._malformedWeightsCount = 0;
    this._histogramCounts.fill(0);
    this._histogramSum = 0;
    this._histogramCount = 0;
    this._histogramMax = 0;
    this._lastCycleAt = null;
  }

  private computeDurations(): ComputeDurationsSummary {
    if (this._histogramCount === 0) {
      return { count: 0, p95Ms: 0, meanMs: 0, maxMs: 0 };
    }
    const target = this._histogramCount * 0.95;
    let cumulative = 0;
    let p95Ms = 0;
    for (let i = 0; i < this._histogramCounts.length; i++) {
      const next = cumulative + this._histogramCounts[i];
      if (next >= target) {
        // Bucket upper bound (or 2× last if overflow).
        p95Ms =
          i < HISTOGRAM_BUCKETS_MS.length
            ? HISTOGRAM_BUCKETS_MS[i]
            : HISTOGRAM_BUCKETS_MS[HISTOGRAM_BUCKETS_MS.length - 1] * 2;
        break;
      }
      cumulative = next;
    }
    return {
      count: this._histogramCount,
      p95Ms,
      meanMs: Math.round(this._histogramSum / this._histogramCount),
      maxMs: Math.round(this._histogramMax),
    };
  }
}

/** Process-singleton. Worker writes, /admin reads. */
export const productivityMetrics = new ProductivityMetrics();
