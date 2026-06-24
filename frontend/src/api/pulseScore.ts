/**
 * Pulse productivity score — SUPER_ADMIN-only API client (Wave 6).
 *
 * Mirrors the surface in `backend/src/routes/pulseScore.routes.ts`. All
 * shared DTO types come from `@exargen/shared` so request/response
 * shapes can't drift between FE + BE.
 *
 * Access policy (R5 lockdown — 2026-05-29):
 *
 *   > "remember only super admin has access to all these metrics
 *      right?, make sure only super admin is allowed"
 *
 * Backend triple-gates each route (`authenticate` + `requireRoles`
 * + `requireProductivityScoreAccess`) so a UI bypass still hits a 403
 * with code `PRODUCTIVITY_SCORE_FORBIDDEN`. The page itself is also
 * route-gated in App.tsx to `roles={['SUPER_ADMIN']}` — belt + braces.
 */

import api from './client';
import type {
  CompositeScoreDTO,
  ProductivityCadence,
  ProductivitySignal,
  ScoreBreakdownDTO,
} from '@exargen/shared';

/** GET /admin/pulse/scores?cadence=... — all employees at one cadence. */
export async function listPulseScores(
  cadence: ProductivityCadence = 'WEEKLY',
): Promise<CompositeScoreDTO[]> {
  const { data } = await api.get('/admin/pulse/scores', { params: { cadence } });
  return data.data;
}

export interface PulseScoresForUser {
  userId: string;
  daily: CompositeScoreDTO | null;
  weekly: CompositeScoreDTO | null;
  monthly: CompositeScoreDTO | null;
}

/** GET /admin/pulse/scores/:userId — latest row per cadence. */
export async function getPulseScoresForUser(userId: string): Promise<PulseScoresForUser> {
  const { data } = await api.get(`/admin/pulse/scores/${userId}`);
  return data.data;
}

/**
 * GET /admin/pulse/scores/:userId/breakdown?cadence=...&windowStart=...
 * Returns the composite + 7 sub-scores + every contributing event for
 * audit-trail UI ("why is this score what it is?").
 */
export async function getPulseScoreBreakdown(
  userId: string,
  opts: { cadence?: ProductivityCadence; windowStart?: string } = {},
): Promise<ScoreBreakdownDTO> {
  const { data } = await api.get(`/admin/pulse/scores/${userId}/breakdown`, {
    params: opts,
  });
  return data.data;
}

export interface PulseWeightsResponse {
  active: {
    id: string;
    weights: Record<ProductivitySignal, number>;
    signalBaselines: Record<string, unknown>;
    thresholdHigh: number;
    thresholdLow: number;
    effectiveFrom: string;
    updatedBy: { id: string; name: string; email: string } | null;
    changeNote: string | null;
  } | null;
  history: Array<{
    id: string;
    effectiveFrom: string;
    updatedBy: { id: string; name: string; email: string } | null;
    changeNote: string | null;
  }>;
}

/** GET /admin/pulse/weights — active + 20-row audit history. */
export async function getPulseWeights(): Promise<PulseWeightsResponse> {
  const { data } = await api.get('/admin/pulse/weights');
  return data.data;
}

export interface PulseObservabilitySnapshot {
  workerLagSeconds: number;
  outboxDepth: number;
  reconciliationInserts: number;
  malformedWeightsCount: number;
  computeDurations: {
    count: number;
    p95Ms: number;
    meanMs: number;
    maxMs: number;
  };
  lastCycleAt: string | null;
  workerEnabled: boolean;
}

/** GET /admin/pulse/observability — worker health snapshot. */
export async function getPulseObservability(): Promise<PulseObservabilitySnapshot> {
  const { data } = await api.get('/admin/pulse/observability');
  return data.data;
}

/** POST /admin/pulse/scores/:userId/recompute — skip debounce, fire now. */
export async function recomputeScoresForUser(
  userId: string,
): Promise<{ userId: string; triggered: boolean }> {
  const { data } = await api.post(`/admin/pulse/scores/${userId}/recompute`);
  return data.data;
}

/**
 * POST /admin/pulse/scores/recompute-all — kickstart the team.
 *
 * Used after first enabling the feature flag, or after a weight tweak,
 * to force a fresh score for every active employee right now (skips
 * the 60s per-user debounce). Returns the queued user count; the
 * actual recomputes happen in the background and surface in the list
 * as they complete.
 */
export async function recomputeAllScores(): Promise<{
  triggered: boolean;
  userCount: number;
}> {
  const { data } = await api.post('/admin/pulse/scores/recompute-all');
  return data.data;
}

export interface PulseScoresSummary {
  cadence: ProductivityCadence;
  totalEmployees: number;
  averageComposite: number;
  bandDistribution: { HIGH: number; MEDIUM: number; LOW: number };
  gamingFlagsTotal: number;
  lastComputedAt: string | null;
}

/** GET /admin/pulse/scores/summary?cadence=... — team rollup for the hero. */
export async function getPulseScoresSummary(
  cadence: ProductivityCadence = 'WEEKLY',
): Promise<PulseScoresSummary> {
  const { data } = await api.get('/admin/pulse/scores/summary', {
    params: { cadence },
  });
  return data.data;
}
