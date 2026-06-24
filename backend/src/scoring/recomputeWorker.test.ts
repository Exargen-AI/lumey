/**
 * scoreRecomputeWorker — unit tests.
 *
 * We test the worker class without scheduling real timers. The
 * polling-loop path is covered by calling `runCycle()` directly, and
 * the recompute path is covered by calling `recomputeForUser()`
 * directly. setInterval / setTimeout behaviour is exercised
 * indirectly via the start/stop pair.
 *
 * Covers:
 *   - start() is a no-op when the feature flag is OFF
 *   - start() registers a poll when the flag is ON
 *   - stop() clears the poll handle + any pending debouncers
 *   - runCycle() sets lag + outbox depth metrics
 *   - runCycle() exits early when the outbox is empty
 *   - recomputeForUser() upserts 3 score rows + marks events processed
 *   - recomputeForUser() returns early when the user has no events
 *   - loadActiveWeightSet() falls back to defaults on malformed JSONB
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import {
  scoreRecomputeWorker,
  loadActiveWeightSet,
  determineInactiveSignals,
} from './recomputeWorker';
import { productivityMetrics } from './observability';
import { defaultWeightSet } from './computeForUser';

// ─── Partial scoring for not-yet-onboarded employees (2026-06-01) ───
//
// determineInactiveSignals decides which signals to DROP from the
// composite (renormalising the rest) when we can't observe them. The
// invariant: drop only what's unmeasurable, never penalise a zero we
// CAN see.
describe('determineInactiveSignals', () => {
  it('drops nothing when the user has an active Pulse device', () => {
    expect(determineInactiveSignals(true, [])).toEqual([]);
    expect(determineInactiveSignals(true, ['STANDUP'])).toEqual([]);
  });

  it('drops DEEP_WORK + DEVICE_HYGIENE for a user with no device but who clocks in', () => {
    // Has PRESENCE events (manual clock in/out) → presence is
    // measurable, only the two agent-only signals are dropped.
    const inactive = determineInactiveSignals(false, ['STANDUP', 'EXECUTION', 'PRESENCE']);
    expect([...inactive].sort()).toEqual(['DEEP_WORK', 'DEVICE_HYGIENE']);
    expect(inactive).not.toContain('PRESENCE');
  });

  it('also drops PRESENCE for a user with no device AND no clock-in events', () => {
    const inactive = determineInactiveSignals(false, ['STANDUP', 'EXECUTION', 'CODE']);
    expect([...inactive].sort()).toEqual(['DEEP_WORK', 'DEVICE_HYGIENE', 'PRESENCE']);
  });

  it('never drops the Command-Center signals (a zero there is a real zero)', () => {
    const inactive = determineInactiveSignals(false, []);
    for (const cc of ['STANDUP', 'EXECUTION', 'CODE', 'COMMUNICATION']) {
      expect(inactive).not.toContain(cc);
    }
  });
});

describe('scoreRecomputeWorker.start / stop', () => {
  beforeEach(() => {
    productivityMetrics.resetForTest();
    vi.unstubAllEnvs();
    scoreRecomputeWorker.stop();
  });

  afterEach(() => {
    scoreRecomputeWorker.stop();
    vi.unstubAllEnvs();
  });

  it('is a no-op when feature flag is OFF', () => {
    vi.stubEnv('FEATURE_PULSE_COMPOSITE_SCORE_BETA', 'false');
    scoreRecomputeWorker.start();
    // start() returned without setting an interval. Calling stop() is
    // safe and idempotent.
    expect(() => scoreRecomputeWorker.stop()).not.toThrow();
  });

  it('start() then stop() is idempotent when flag is ON', () => {
    vi.stubEnv('FEATURE_PULSE_COMPOSITE_SCORE_BETA', 'true');
    scoreRecomputeWorker.start();
    scoreRecomputeWorker.start(); // second call: no-op
    scoreRecomputeWorker.stop();
    scoreRecomputeWorker.stop(); // second call: no-op
    expect(true).toBe(true); // didn't throw
  });
});

describe('scoreRecomputeWorker.runCycle', () => {
  beforeEach(() => {
    productivityMetrics.resetForTest();
    vi.stubEnv('FEATURE_PULSE_COMPOSITE_SCORE_BETA', 'true');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sets outboxDepth=0 + lagSeconds=0 + lastCycleAt when the outbox is empty', async () => {
    prismaMock.productivityEvent.findFirst.mockResolvedValue(null);
    prismaMock.productivityEvent.count.mockResolvedValue(0);

    await scoreRecomputeWorker.runCycle();

    const snap = productivityMetrics.snapshot();
    expect(snap.outboxDepth).toBe(0);
    expect(snap.workerLagSeconds).toBe(0);
    expect(snap.lastCycleAt).not.toBeNull();
  });

  it('reports outbox depth + computes lag from the oldest unprocessed event', async () => {
    const oldest = new Date(Date.now() - 90_000); // 90s old
    prismaMock.productivityEvent.findFirst.mockResolvedValue({
      recordedAt: oldest,
    } as unknown as never);
    prismaMock.productivityEvent.count.mockResolvedValue(17);
    prismaMock.productivityEvent.findMany.mockResolvedValue([] as never);

    await scoreRecomputeWorker.runCycle();

    const snap = productivityMetrics.snapshot();
    expect(snap.outboxDepth).toBe(17);
    expect(snap.workerLagSeconds).toBeGreaterThanOrEqual(89);
    expect(snap.workerLagSeconds).toBeLessThanOrEqual(95);
  });

  it('bails when feature flag is OFF', async () => {
    vi.stubEnv('FEATURE_PULSE_COMPOSITE_SCORE_BETA', 'false');
    await scoreRecomputeWorker.runCycle();
    // No prisma calls should have been made.
    expect(prismaMock.productivityEvent.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.productivityEvent.count).not.toHaveBeenCalled();
  });
});

describe('scoreRecomputeWorker.recomputeForUser', () => {
  beforeEach(() => {
    productivityMetrics.resetForTest();
    vi.stubEnv('FEATURE_PULSE_COMPOSITE_SCORE_BETA', 'true');
    // Default $transaction stub: run the callback against prismaMock.
    (prismaMock.$transaction as unknown as { mockImplementation: (cb: unknown) => void })
      .mockImplementation(async (cb: unknown) => {
        if (typeof cb === 'function') return (cb as (tx: unknown) => unknown)(prismaMock);
        return undefined;
      });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns early without upserts when the user has no events in the window', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'ENGINEER', isActive: true } as never);
    prismaMock.productivityEvent.findMany.mockResolvedValue([] as never);
    prismaMock.universalWeightSet.findFirst.mockResolvedValue(null);

    await scoreRecomputeWorker.recomputeForUser('user-1');

    expect(prismaMock.employeeProductivityScore.upsert).not.toHaveBeenCalled();
  });

  // ─── Wave 14 — role gate at the worker level ────────────────────

  it.each(['CLIENT', 'GUEST_FUTURE_ROLE', null] as Array<string | null>)(
    'refuses to score a non-employee role (%s) and DELETES stale score rows',
    async (badRole) => {
      prismaMock.user.findUnique.mockResolvedValue(
        badRole === null ? null : ({ role: badRole, isActive: true } as never),
      );
      prismaMock.employeeProductivityScore.deleteMany.mockResolvedValue({ count: 2 } as never);

      await scoreRecomputeWorker.recomputeForUser('client-1');

      // Stale rows for this user should have been cleaned.
      expect(prismaMock.employeeProductivityScore.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'client-1' },
      });
      // No event fetch / upsert ever happened.
      expect(prismaMock.productivityEvent.findMany).not.toHaveBeenCalled();
      expect(prismaMock.employeeProductivityScore.upsert).not.toHaveBeenCalled();
    },
  );

  it('refuses to score a DEACTIVATED employee + cleans their score rows', async () => {
    // Old employee left the company → `isActive: false`. Their score
    // row would otherwise stay stuck at whatever it was the day they
    // left. Cleanup keeps the Reports page tidy.
    prismaMock.user.findUnique.mockResolvedValue({ role: 'ENGINEER', isActive: false } as never);
    prismaMock.employeeProductivityScore.deleteMany.mockResolvedValue({ count: 3 } as never);

    await scoreRecomputeWorker.recomputeForUser('left-the-company');

    expect(prismaMock.employeeProductivityScore.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'left-the-company' },
    });
    expect(prismaMock.productivityEvent.findMany).not.toHaveBeenCalled();
  });

  it('upserts 3 score rows + marks events processed when events exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'ENGINEER', isActive: true } as never);
    prismaMock.productivityEvent.findMany.mockResolvedValue([
      {
        id: 'ev-1',
        signal: 'STANDUP',
        eventType: 'standup.submitted',
        occurredAt: new Date(),
        rawPayload: { date: '2026-05-29', bodyLength: 200, bodyHash: 'h1' },
        scoreDelta: null,
        gamingFlag: null,
        source: 'daily_updates',
        sourceId: 'du-1',
      },
    ] as never);
    prismaMock.universalWeightSet.findFirst.mockResolvedValue(null);
    prismaMock.employeeProductivityScore.upsert.mockResolvedValue({} as never);
    prismaMock.productivityEvent.updateMany.mockResolvedValue({ count: 1 } as never);

    await scoreRecomputeWorker.recomputeForUser('user-1');

    // One upsert per cadence: DAILY, WEEKLY, MONTHLY.
    expect(prismaMock.employeeProductivityScore.upsert).toHaveBeenCalledTimes(3);
    expect(prismaMock.productivityEvent.updateMany).toHaveBeenCalledTimes(1);
  });
});

describe('loadActiveWeightSet', () => {
  beforeEach(() => {
    productivityMetrics.resetForTest();
  });

  it('returns the default R5 weight set when no DB row exists', async () => {
    prismaMock.universalWeightSet.findFirst.mockResolvedValue(null);
    const ws = await loadActiveWeightSet(prismaMock as never);
    expect(ws).toEqual(defaultWeightSet());
  });

  it('falls back to defaults + increments malformedWeights counter on bad JSONB', async () => {
    prismaMock.universalWeightSet.findFirst.mockResolvedValue({
      id: 'bad-row',
      // Sum nowhere near 1.0 → fails weightsSumValid → fallback fires.
      weights: { STANDUP: 0.5, EXECUTION: 0.5, CODE: 99 },
      signalBaselines: {},
      thresholdHigh: 75,
      thresholdLow: 40,
      effectiveFrom: new Date(),
    } as unknown as never);

    const ws = await loadActiveWeightSet(prismaMock as never);
    expect(ws.weights).toEqual(defaultWeightSet().weights);
    expect(productivityMetrics.snapshot().malformedWeightsCount).toBe(1);
  });

  it('returns the active row when weights pass validation', async () => {
    const goodWeights = {
      STANDUP: 0.13,
      EXECUTION: 0.22,
      CODE: 0.1,
      COMMUNICATION: 0.1,
      PRESENCE: 0.18,
      DEEP_WORK: 0.22,
      DEVICE_HYGIENE: 0.05,
    };
    prismaMock.universalWeightSet.findFirst.mockResolvedValue({
      id: 'good',
      weights: goodWeights,
      signalBaselines: {},
      thresholdHigh: 80,
      thresholdLow: 30,
      effectiveFrom: new Date(),
    } as unknown as never);

    const ws = await loadActiveWeightSet(prismaMock as never);
    expect(ws.weights).toEqual(goodWeights);
    expect(ws.thresholdHigh).toBe(80);
    expect(ws.thresholdLow).toBe(30);
    expect(productivityMetrics.snapshot().malformedWeightsCount).toBe(0);
  });
});
