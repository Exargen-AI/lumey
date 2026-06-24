/**
 * Pulse score handlers — unit tests.
 *
 * Invoke each handler directly with mocked Express req/res/next. The
 * underlying Prisma calls are intercepted via the shared prismaMock.
 *
 * Covers the happy path + the key error paths for each endpoint. The
 * auth/role guards are tested separately in routes-level tripwire
 * tests (they live in `requireProductivityScoreAccess.test.ts` from
 * Wave 1).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import * as handler from './pulseScore.handler';
import { NotFoundError, ValidationError } from '../utils/errors';
import { productivityMetrics } from '../scoring/observability';

vi.mock('../scoring/recomputeWorker', async () => {
  const actual = await vi.importActual<typeof import('../scoring/recomputeWorker')>(
    '../scoring/recomputeWorker',
  );
  return {
    ...actual,
    scoreRecomputeWorker: {
      ...actual.scoreRecomputeWorker,
      recomputeForUser: vi.fn(async (_userId: string) => undefined),
    },
  };
});

function makeRes() {
  return {
    json: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
  } as unknown as { json: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn> };
}

function scoreRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    userId: 'user-1',
    windowStart: new Date('2026-05-25T00:00:00.000Z'),
    windowEnd: new Date('2026-05-31T23:59:59.999Z'),
    cadence: 'WEEKLY',
    compositeScore: 72,
    band: 'MEDIUM',
    signalScores: { STANDUP: 80, EXECUTION: 70, CODE: 60, COMMUNICATION: 60, PRESENCE: 75, DEEP_WORK: 75, DEVICE_HYGIENE: 90 },
    rawBreakdown: { STANDUP: { substantive_standups: 4 } },
    flags: {},
    computedAt: new Date('2026-05-29T08:00:00.000Z'),
    computedFromEventCount: 42,
    ...overrides,
  };
}

describe('listScoresHandler', () => {
  it('defaults to WEEKLY cadence and returns DTOs', async () => {
    prismaMock.employeeProductivityScore.findMany.mockResolvedValue([
      scoreRow(),
    ] as never);
    const req = { query: {} } as never;
    const res = makeRes();
    const next = vi.fn();

    await handler.listScoresHandler(req as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledTimes(1);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data[0].userId).toBe('user-1');
    expect(payload.data[0].cadence).toBe('WEEKLY');
    expect(payload.data[0].compositeScore).toBe(72);
  });

  it('rejects an invalid cadence with ValidationError', async () => {
    const req = { query: { cadence: 'YEARLY' } } as never;
    const res = makeRes();
    const next = vi.fn();

    await handler.listScoresHandler(req as never, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ValidationError);
  });
});

describe('getScoresForUserHandler', () => {
  it('returns null per cadence when no rows exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1' } as never);
    prismaMock.employeeProductivityScore.findFirst.mockResolvedValue(null);
    const req = { params: { userId: 'user-1' }, query: {} } as never;
    const res = makeRes();
    const next = vi.fn();

    await handler.getScoresForUserHandler(req as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.data).toEqual({
      userId: 'user-1',
      daily: null,
      weekly: null,
      monthly: null,
    });
  });

  it('returns NotFoundError when the user does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const req = { params: { userId: 'ghost' }, query: {} } as never;
    const res = makeRes();
    const next = vi.fn();

    await handler.getScoresForUserHandler(req as never, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(NotFoundError);
  });
});

describe('getScoreBreakdownHandler', () => {
  it('returns 404 when no score row matches', async () => {
    prismaMock.employeeProductivityScore.findFirst.mockResolvedValue(null);
    const req = {
      params: { userId: 'user-1' },
      query: { cadence: 'WEEKLY' },
    } as never;
    const res = makeRes();
    const next = vi.fn();

    await handler.getScoreBreakdownHandler(req as never, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(NotFoundError);
  });

  it('rejects an invalid windowStart with ValidationError', async () => {
    const req = {
      params: { userId: 'user-1' },
      query: { cadence: 'WEEKLY', windowStart: 'not-a-date' },
    } as never;
    const res = makeRes();
    const next = vi.fn();

    await handler.getScoreBreakdownHandler(req as never, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ValidationError);
  });

  it('returns composite + events + active weight set on the happy path', async () => {
    prismaMock.employeeProductivityScore.findFirst.mockResolvedValue(scoreRow() as never);
    prismaMock.productivityEvent.findMany.mockResolvedValue([
      {
        id: 'ev-1',
        signal: 'STANDUP',
        eventType: 'standup.submitted',
        occurredAt: new Date('2026-05-27T09:00:00Z'),
        source: 'daily_updates',
        sourceId: 'du-1',
        scoreDelta: 1.5,
        gamingFlag: null,
        rawPayload: { date: '2026-05-27' },
      },
    ] as never);
    prismaMock.universalWeightSet.findFirst.mockResolvedValue({
      weights: { STANDUP: 0.13 },
      thresholdHigh: 80,
      thresholdLow: 35,
    } as never);

    const req = {
      params: { userId: 'user-1' },
      query: { cadence: 'WEEKLY' },
    } as never;
    const res = makeRes();
    const next = vi.fn();

    await handler.getScoreBreakdownHandler(req as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data.events).toHaveLength(1);
    expect(payload.data.weightsApplied).toEqual({ STANDUP: 0.13 });
    expect(payload.data.thresholdHigh).toBe(80);
    expect(payload.data.thresholdLow).toBe(35);
  });
});

describe('getWeightsHandler', () => {
  it('returns null active when no weight rows exist', async () => {
    prismaMock.universalWeightSet.findMany.mockResolvedValue([] as never);
    const req = {} as never;
    const res = makeRes();
    const next = vi.fn();

    await handler.getWeightsHandler(req as never, res as never, next);

    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data.active).toBeNull();
    expect(payload.data.history).toEqual([]);
  });

  it('returns the most recent as active + history list', async () => {
    prismaMock.universalWeightSet.findMany.mockResolvedValue([
      {
        id: 'w2',
        weights: { STANDUP: 0.13 },
        signalBaselines: {},
        thresholdHigh: 75,
        thresholdLow: 40,
        effectiveFrom: new Date('2026-05-29'),
        updatedByUser: { id: 'admin-1', name: 'Pankaj', email: 'admin@exargen.in' },
        changeNote: 'R5 seed',
      },
      {
        id: 'w1',
        weights: { STANDUP: 0.1 },
        signalBaselines: {},
        thresholdHigh: 75,
        thresholdLow: 40,
        effectiveFrom: new Date('2026-05-01'),
        updatedByUser: { id: 'admin-1', name: 'Pankaj', email: 'admin@exargen.in' },
        changeNote: 'pre-R5',
      },
    ] as never);

    const req = {} as never;
    const res = makeRes();
    const next = vi.fn();

    await handler.getWeightsHandler(req as never, res as never, next);

    const payload = res.json.mock.calls[0][0];
    expect(payload.data.active.id).toBe('w2');
    expect(payload.data.history).toHaveLength(2);
  });
});

describe('getObservabilityHandler', () => {
  it('returns the productivityMetrics snapshot', async () => {
    productivityMetrics.resetForTest();
    productivityMetrics.setOutboxDepth(5);

    const req = {} as never;
    const res = makeRes();
    const next = vi.fn();

    await handler.getObservabilityHandler(req as never, res as never, next);

    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data.outboxDepth).toBe(5);
  });
});

describe('recomputeScoresForUserHandler', () => {
  it('returns 404 when the user does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const req = { params: { userId: 'ghost' } } as never;
    const res = makeRes();
    const next = vi.fn();

    await handler.recomputeScoresForUserHandler(req as never, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(NotFoundError);
  });

  it('fires the recompute and responds with {triggered: true}', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1' } as never);

    const req = { params: { userId: 'user-1' } } as never;
    const res = makeRes();
    const next = vi.fn();

    await handler.recomputeScoresForUserHandler(req as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload).toEqual({
      success: true,
      data: { userId: 'user-1', triggered: true },
    });
  });
});

describe('recomputeAllScoresHandler', () => {
  // Throttle is module-level — reset before every test in this block
  // so order independence is preserved.
  beforeEach(() => handler._resetRecomputeAllThrottleForTest());

  it('queues a recompute for every active user and returns the count', async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'u1' },
      { id: 'u2' },
      { id: 'u3' },
    ] as never);

    const req = {} as never;
    const res = makeRes();
    const next = vi.fn();

    await handler.recomputeAllScoresHandler(req as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    // We don't await the recomputes themselves (they fire-and-forget),
    // so the assertion is on the handler response shape.
    expect(res.json.mock.calls[0][0]).toEqual({
      success: true,
      data: { triggered: true, userCount: 3 },
    });
    // Wave 14 — recompute targets EMPLOYEE roles only (CLIENTs MUST
    // never be scored). Active + role-filtered.
    expect(prismaMock.user.findMany).toHaveBeenCalledWith({
      where: {
        isActive: true,
        role: { in: ['SUPER_ADMIN', 'ADMIN', 'PRODUCT_MANAGER', 'ENGINEER'] },
      },
      select: { id: true },
      take: 500,
    });
  });

  it('handles a zero-employee team gracefully', async () => {
    prismaMock.user.findMany.mockResolvedValue([] as never);

    const req = {} as never;
    const res = makeRes();
    const next = vi.fn();

    await handler.recomputeAllScoresHandler(req as never, res as never, next);

    expect(res.json.mock.calls[0][0].data.userCount).toBe(0);
  });

  // ─── Wave 10 — throttle guard ─────────────────────────────────────

  it('returns 429 with retryInSeconds when called twice inside the cooldown window', async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u1' }] as never);

    // First call should succeed.
    const res1 = makeRes();
    await handler.recomputeAllScoresHandler({} as never, res1 as never, vi.fn());
    expect(res1.json.mock.calls[0][0].success).toBe(true);

    // Immediate second call should 429.
    const res2 = makeRes();
    await handler.recomputeAllScoresHandler({} as never, res2 as never, vi.fn());
    expect(res2.status).toHaveBeenCalledWith(429);
    const body = res2.json.mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('RECOMPUTE_THROTTLED');
    expect(body.error.retryInSeconds).toBeGreaterThan(0);
    expect(body.error.retryInSeconds).toBeLessThanOrEqual(30);
  });

  it('does NOT call the worker on the throttled second call', async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u1' }] as never);

    await handler.recomputeAllScoresHandler({} as never, makeRes() as never, vi.fn());
    const callsAfterFirst = prismaMock.user.findMany.mock.calls.length;
    await handler.recomputeAllScoresHandler({} as never, makeRes() as never, vi.fn());
    // The throttled second call short-circuits before the findMany
    // query — so the call count is unchanged.
    expect(prismaMock.user.findMany.mock.calls.length).toBe(callsAfterFirst);
  });
});

describe('getScoresSummaryHandler', () => {
  it('rejects an invalid cadence', async () => {
    const req = { query: { cadence: 'YEARLY' } } as never;
    const res = makeRes();
    const next = vi.fn();

    await handler.getScoresSummaryHandler(req as never, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(ValidationError);
  });

  it('returns zeros when there are no score rows', async () => {
    prismaMock.employeeProductivityScore.findMany.mockResolvedValue([] as never);

    const req = { query: {} } as never;
    const res = makeRes();
    const next = vi.fn();

    await handler.getScoresSummaryHandler(req as never, res as never, next);

    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data).toEqual({
      cadence: 'WEEKLY',
      totalEmployees: 0,
      averageComposite: 0,
      bandDistribution: { HIGH: 0, MEDIUM: 0, LOW: 0 },
      gamingFlagsTotal: 0,
      lastComputedAt: null,
    });
  });

  it('computes distribution + average + gaming-flag total from the row set', async () => {
    prismaMock.employeeProductivityScore.findMany.mockResolvedValue([
      {
        compositeScore: 80,
        band: 'HIGH',
        flags: { gamingFlagsCount: 0 },
        computedAt: new Date('2026-05-29T10:00:00Z'),
      },
      {
        compositeScore: 60,
        band: 'MEDIUM',
        flags: { gamingFlagsCount: 2 },
        computedAt: new Date('2026-05-29T11:00:00Z'),
      },
      {
        compositeScore: 30,
        band: 'LOW',
        flags: { gamingFlagsCount: 1 },
        computedAt: new Date('2026-05-29T09:00:00Z'),
      },
    ] as never);

    const req = { query: { cadence: 'WEEKLY' } } as never;
    const res = makeRes();
    const next = vi.fn();

    await handler.getScoresSummaryHandler(req as never, res as never, next);

    const payload = res.json.mock.calls[0][0];
    expect(payload.data.totalEmployees).toBe(3);
    expect(payload.data.averageComposite).toBe(56.7); // (80+60+30)/3 = 56.666... → 56.7
    expect(payload.data.bandDistribution).toEqual({ HIGH: 1, MEDIUM: 1, LOW: 1 });
    expect(payload.data.gamingFlagsTotal).toBe(3);
    // Should pick the LATEST computedAt of the three.
    expect(payload.data.lastComputedAt).toBe('2026-05-29T11:00:00.000Z');
  });
});
