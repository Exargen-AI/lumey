/**
 * pulseScore API client — contract tests.
 *
 * Pin the (url, method, params) shape so the frontend can't silently
 * drift from `backend/src/routes/pulseScore.routes.ts`. Each test
 * mocks the underlying axios client and asserts the call signature.
 *
 * Why these tests matter: the routes are SUPER_ADMIN-only. If we ever
 * accidentally point a request at the wrong URL ("/admin/pulse/score"
 * vs "/admin/pulse/scores"), the user sees a generic 404, the page
 * silently empties, and there's nothing in the network tab obvious
 * enough to debug from. Pinning the URL string in a test makes a
 * silent drift a deliberate, loud code change.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./client', () => ({
  __esModule: true,
  default: { get: vi.fn(), post: vi.fn() },
}));

import api from './client';
import {
  getPulseObservability,
  getPulseScoreBreakdown,
  getPulseScoresForUser,
  getPulseScoresSummary,
  getPulseWeights,
  listPulseScores,
  recomputeAllScores,
  recomputeScoresForUser,
} from './pulseScore';

const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  mockApi.get.mockReset();
  mockApi.post.mockReset();
});

describe('listPulseScores', () => {
  it('GETs /admin/pulse/scores with cadence query', async () => {
    mockApi.get.mockResolvedValue({ data: { data: [] } });
    await listPulseScores('WEEKLY');
    expect(mockApi.get).toHaveBeenCalledWith('/admin/pulse/scores', {
      params: { cadence: 'WEEKLY' },
    });
  });

  it('defaults cadence to WEEKLY when omitted', async () => {
    mockApi.get.mockResolvedValue({ data: { data: [] } });
    await listPulseScores();
    expect(mockApi.get.mock.calls[0][1]).toEqual({
      params: { cadence: 'WEEKLY' },
    });
  });

  it('returns the unwrapped data array', async () => {
    const rows = [{ userId: 'u1' }, { userId: 'u2' }];
    mockApi.get.mockResolvedValue({ data: { data: rows } });
    const out = await listPulseScores('DAILY');
    expect(out).toEqual(rows);
  });
});

describe('getPulseScoresForUser', () => {
  it('GETs /admin/pulse/scores/:userId', async () => {
    mockApi.get.mockResolvedValue({
      data: { data: { userId: 'u1', daily: null, weekly: null, monthly: null } },
    });
    await getPulseScoresForUser('u1');
    expect(mockApi.get).toHaveBeenCalledWith('/admin/pulse/scores/u1');
  });
});

describe('getPulseScoreBreakdown', () => {
  it('GETs the breakdown URL with cadence + windowStart', async () => {
    mockApi.get.mockResolvedValue({ data: { data: {} } });
    await getPulseScoreBreakdown('u1', {
      cadence: 'MONTHLY',
      windowStart: '2026-05-01',
    });
    expect(mockApi.get).toHaveBeenCalledWith('/admin/pulse/scores/u1/breakdown', {
      params: { cadence: 'MONTHLY', windowStart: '2026-05-01' },
    });
  });

  it('omits windowStart when not provided', async () => {
    mockApi.get.mockResolvedValue({ data: { data: {} } });
    await getPulseScoreBreakdown('u1', { cadence: 'WEEKLY' });
    expect(mockApi.get.mock.calls[0][1]).toEqual({
      params: { cadence: 'WEEKLY' },
    });
  });
});

describe('getPulseWeights', () => {
  it('GETs /admin/pulse/weights', async () => {
    mockApi.get.mockResolvedValue({
      data: { data: { active: null, history: [] } },
    });
    const out = await getPulseWeights();
    expect(mockApi.get).toHaveBeenCalledWith('/admin/pulse/weights');
    expect(out).toEqual({ active: null, history: [] });
  });
});

describe('getPulseObservability', () => {
  it('GETs /admin/pulse/observability', async () => {
    mockApi.get.mockResolvedValue({
      data: {
        data: {
          workerLagSeconds: 0,
          outboxDepth: 0,
          reconciliationInserts: 0,
          malformedWeightsCount: 0,
          computeDurations: { count: 0, p95Ms: 0, meanMs: 0, maxMs: 0 },
          lastCycleAt: null,
          workerEnabled: false,
        },
      },
    });
    await getPulseObservability();
    expect(mockApi.get).toHaveBeenCalledWith('/admin/pulse/observability');
  });
});

describe('recomputeScoresForUser', () => {
  it('POSTs to /admin/pulse/scores/:userId/recompute', async () => {
    mockApi.post.mockResolvedValue({
      data: { data: { userId: 'u1', triggered: true } },
    });
    const out = await recomputeScoresForUser('u1');
    expect(mockApi.post).toHaveBeenCalledWith('/admin/pulse/scores/u1/recompute');
    expect(out).toEqual({ userId: 'u1', triggered: true });
  });
});

describe('recomputeAllScores', () => {
  it('POSTs to /admin/pulse/scores/recompute-all (literal path, not :userId)', async () => {
    mockApi.post.mockResolvedValue({
      data: { data: { triggered: true, userCount: 7 } },
    });
    const out = await recomputeAllScores();
    expect(mockApi.post).toHaveBeenCalledWith('/admin/pulse/scores/recompute-all');
    expect(out).toEqual({ triggered: true, userCount: 7 });
  });
});

describe('getPulseScoresSummary', () => {
  it('GETs /admin/pulse/scores/summary with cadence', async () => {
    mockApi.get.mockResolvedValue({
      data: {
        data: {
          cadence: 'WEEKLY',
          totalEmployees: 0,
          averageComposite: 0,
          bandDistribution: { HIGH: 0, MEDIUM: 0, LOW: 0 },
          gamingFlagsTotal: 0,
          lastComputedAt: null,
        },
      },
    });
    await getPulseScoresSummary('WEEKLY');
    expect(mockApi.get).toHaveBeenCalledWith('/admin/pulse/scores/summary', {
      params: { cadence: 'WEEKLY' },
    });
  });
});
