/**
 * productivityMetrics — unit tests.
 *
 * In-memory metric registry. Tests cover:
 *   - Gauges (workerLagSeconds, outboxDepth) overwrite on each set
 *   - Counters (reconciliationInserts, malformedWeightsCount) accumulate
 *   - Histogram count/mean/max
 *   - p95 approximation lands in the bucket containing the 95th percentile
 *   - markCycleComplete sets lastCycleAt
 *   - resetForTest zeroes everything
 *   - Non-finite / negative compute durations are rejected
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { productivityMetrics } from './observability';

describe('ProductivityMetrics', () => {
  beforeEach(() => {
    productivityMetrics.resetForTest();
  });

  describe('gauges', () => {
    it('workerLagSeconds overwrites on set', () => {
      productivityMetrics.setWorkerLagSeconds(120);
      productivityMetrics.setWorkerLagSeconds(45);
      expect(productivityMetrics.snapshot().workerLagSeconds).toBe(45);
    });

    it('outboxDepth overwrites on set', () => {
      productivityMetrics.setOutboxDepth(100);
      productivityMetrics.setOutboxDepth(7);
      expect(productivityMetrics.snapshot().outboxDepth).toBe(7);
    });

    it('floors fractional values and rejects negatives', () => {
      productivityMetrics.setWorkerLagSeconds(-50);
      expect(productivityMetrics.snapshot().workerLagSeconds).toBe(0);
      productivityMetrics.setWorkerLagSeconds(12.7);
      expect(productivityMetrics.snapshot().workerLagSeconds).toBe(12);
    });
  });

  describe('counters', () => {
    it('reconciliationInserts accumulates', () => {
      productivityMetrics.incrementReconciliationInserts(3);
      productivityMetrics.incrementReconciliationInserts(2);
      productivityMetrics.incrementReconciliationInserts();
      expect(productivityMetrics.snapshot().reconciliationInserts).toBe(6);
    });

    it('malformedWeightsCount accumulates one per call', () => {
      productivityMetrics.incrementMalformedWeights();
      productivityMetrics.incrementMalformedWeights();
      productivityMetrics.incrementMalformedWeights();
      expect(productivityMetrics.snapshot().malformedWeightsCount).toBe(3);
    });
  });

  describe('compute duration histogram', () => {
    it('count + mean + max track the recorded samples', () => {
      productivityMetrics.recordComputeDuration(10);
      productivityMetrics.recordComputeDuration(30);
      productivityMetrics.recordComputeDuration(80);
      const snap = productivityMetrics.snapshot().computeDurations;
      expect(snap.count).toBe(3);
      expect(snap.meanMs).toBe(40); // (10+30+80)/3 = 40
      expect(snap.maxMs).toBe(80);
    });

    it('returns zeros when no samples recorded', () => {
      const snap = productivityMetrics.snapshot().computeDurations;
      expect(snap.count).toBe(0);
      expect(snap.meanMs).toBe(0);
      expect(snap.maxMs).toBe(0);
      expect(snap.p95Ms).toBe(0);
    });

    it('p95 lands in the bucket containing the 95th percentile', () => {
      // Record 100 samples that all fall in the 10ms bucket.
      for (let i = 0; i < 100; i++) productivityMetrics.recordComputeDuration(5);
      expect(productivityMetrics.snapshot().computeDurations.p95Ms).toBe(10);
    });

    it('p95 jumps to a higher bucket when >5% samples are slow', () => {
      // 90 fast (<10ms) + 10 slow (5000ms) → cumulative hits 95% inside
      // the slow bucket, p95 should land at 5000.
      for (let i = 0; i < 90; i++) productivityMetrics.recordComputeDuration(5);
      for (let i = 0; i < 10; i++) productivityMetrics.recordComputeDuration(5000);
      const p95 = productivityMetrics.snapshot().computeDurations.p95Ms;
      expect(p95).toBe(5000);
    });

    it('overflow bucket fires for samples > largest bucket', () => {
      productivityMetrics.recordComputeDuration(15_000);
      const p95 = productivityMetrics.snapshot().computeDurations.p95Ms;
      expect(p95).toBeGreaterThanOrEqual(10_000);
    });

    it('rejects non-finite + negative samples silently', () => {
      productivityMetrics.recordComputeDuration(NaN);
      productivityMetrics.recordComputeDuration(Infinity);
      productivityMetrics.recordComputeDuration(-100);
      expect(productivityMetrics.snapshot().computeDurations.count).toBe(0);
    });
  });

  describe('lastCycleAt', () => {
    it('is null until markCycleComplete fires', () => {
      expect(productivityMetrics.snapshot().lastCycleAt).toBeNull();
    });

    it('updates to ISO string when markCycleComplete fires', () => {
      productivityMetrics.markCycleComplete();
      const at = productivityMetrics.snapshot().lastCycleAt;
      expect(at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('snapshot.workerEnabled', () => {
    it('reflects the feature-flag state', () => {
      const snap = productivityMetrics.snapshot();
      expect(typeof snap.workerEnabled).toBe('boolean');
    });
  });

  describe('resetForTest', () => {
    it('zeroes every counter, gauge, and histogram', () => {
      productivityMetrics.setWorkerLagSeconds(99);
      productivityMetrics.setOutboxDepth(42);
      productivityMetrics.incrementReconciliationInserts(5);
      productivityMetrics.incrementMalformedWeights();
      productivityMetrics.recordComputeDuration(123);
      productivityMetrics.markCycleComplete();

      productivityMetrics.resetForTest();

      const s = productivityMetrics.snapshot();
      expect(s.workerLagSeconds).toBe(0);
      expect(s.outboxDepth).toBe(0);
      expect(s.reconciliationInserts).toBe(0);
      expect(s.malformedWeightsCount).toBe(0);
      expect(s.computeDurations.count).toBe(0);
      expect(s.lastCycleAt).toBeNull();
    });
  });
});
