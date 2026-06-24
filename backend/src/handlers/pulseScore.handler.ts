/**
 * Pulse productivity score — SUPER_ADMIN API handlers (Wave 5).
 *
 * Four endpoints, all gated by `requireProductivityScoreAccess`:
 *
 *   GET /admin/pulse/scores
 *       List current scores for every employee at one cadence.
 *
 *   GET /admin/pulse/scores/:userId
 *       Single employee. Returns the latest score row for every
 *       cadence (DAILY + WEEKLY + MONTHLY).
 *
 *   GET /admin/pulse/scores/:userId/breakdown?cadence=...&windowStart=...
 *       Audit-trail-grade detail: composite + 7 sub-scores + every
 *       productivity_events row that fed the calculation. Used by
 *       the future Reports tab's "why is this score what it is?"
 *       drawer.
 *
 *   GET /admin/pulse/weights
 *       Current active universal weight set + threshold + history.
 *
 *   GET /admin/pulse/observability
 *       Worker lag, outbox depth, compute durations, malformed
 *       weight count. Used by SUPER_ADMIN to spot if the worker is
 *       stuck.
 *
 *   POST /admin/pulse/scores/:userId/recompute
 *       Ad-hoc trigger: re-run scoring for one user RIGHT NOW
 *       (skips debounce). Useful for "I just edited their standup,
 *       refresh their score."
 *
 * No write endpoints for weights in this PR (PATCH /admin/pulse/weights
 * deferred). Weight tuning happens via DB seed for v1.
 */

import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import { NotFoundError, ValidationError } from '../utils/errors';
import { scoreRecomputeWorker } from '../scoring/recomputeWorker';
import { productivityMetrics } from '../scoring/observability';
import type {
  ProductivityCadence,
  ProductivitySignal,
  CompositeScoreDTO,
  ScoreBreakdownDTO,
} from '@exargen/shared';

function toDTO(row: {
  userId: string;
  windowStart: Date;
  windowEnd: Date;
  cadence: ProductivityCadence;
  compositeScore: unknown;
  band: 'HIGH' | 'MEDIUM' | 'LOW';
  signalScores: unknown;
  rawBreakdown: unknown;
  flags: unknown;
  computedAt: Date;
  computedFromEventCount: number;
}): CompositeScoreDTO {
  const signalScores = row.signalScores as Record<ProductivitySignal, number>;
  const rawBreakdown = row.rawBreakdown as Record<
    ProductivitySignal,
    Record<string, unknown>
  >;
  const flags = (row.flags ?? {}) as CompositeScoreDTO['flags'];
  return {
    userId: row.userId,
    windowStart: row.windowStart.toISOString().slice(0, 10),
    windowEnd: row.windowEnd.toISOString().slice(0, 10),
    cadence: row.cadence,
    compositeScore: Number(row.compositeScore),
    band: row.band,
    signalScores: (Object.keys(signalScores) as ProductivitySignal[]).map((sig) => ({
      signal: sig,
      score: Number(signalScores[sig] ?? 0),
      rawBreakdown:
        (rawBreakdown?.[sig] as Record<string, number | string | null>) ?? {},
      gamingFlags: [],
    })),
    flags,
    computedAt: row.computedAt.toISOString(),
    computedFromEventCount: row.computedFromEventCount,
  };
}

/**
 * GET /admin/pulse/scores
 * Query: cadence=DAILY|WEEKLY|MONTHLY (default WEEKLY)
 */
export async function listScoresHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const cadence = (req.query.cadence as ProductivityCadence) || 'WEEKLY';
    if (!['DAILY', 'WEEKLY', 'MONTHLY'].includes(cadence)) {
      throw new ValidationError('cadence must be DAILY, WEEKLY, or MONTHLY');
    }
    const rows = await prisma.employeeProductivityScore.findMany({
      where: { cadence },
      orderBy: [{ windowStart: 'desc' }, { compositeScore: 'desc' }],
      take: 200,
    });
    res.json({ success: true, data: rows.map(toDTO) });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /admin/pulse/scores/:userId
 * Returns the latest score row for each cadence for one user.
 */
export async function getScoresForUserHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.params.userId;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundError('User');

    const [daily, weekly, monthly] = await Promise.all(
      (['DAILY', 'WEEKLY', 'MONTHLY'] as ProductivityCadence[]).map((cad) =>
        prisma.employeeProductivityScore.findFirst({
          where: { userId, cadence: cad },
          orderBy: { windowStart: 'desc' },
        }),
      ),
    );
    res.json({
      success: true,
      data: {
        userId,
        daily: daily ? toDTO(daily) : null,
        weekly: weekly ? toDTO(weekly) : null,
        monthly: monthly ? toDTO(monthly) : null,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /admin/pulse/scores/:userId/breakdown?cadence=...&windowStart=YYYY-MM-DD
 * Full audit-trail drill-down for one (user, window, cadence) row.
 */
export async function getScoreBreakdownHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.params.userId;
    const cadence = (req.query.cadence as ProductivityCadence) || 'WEEKLY';
    if (!['DAILY', 'WEEKLY', 'MONTHLY'].includes(cadence)) {
      throw new ValidationError('cadence must be DAILY, WEEKLY, or MONTHLY');
    }
    const windowStartQuery = req.query.windowStart;
    let row;
    if (typeof windowStartQuery === 'string' && windowStartQuery) {
      const windowStart = new Date(`${windowStartQuery}T00:00:00Z`);
      if (Number.isNaN(windowStart.getTime())) {
        throw new ValidationError('windowStart must be YYYY-MM-DD');
      }
      row = await prisma.employeeProductivityScore.findFirst({
        where: { userId, cadence, windowStart },
      });
    } else {
      row = await prisma.employeeProductivityScore.findFirst({
        where: { userId, cadence },
        orderBy: { windowStart: 'desc' },
      });
    }
    if (!row) throw new NotFoundError('Score row');

    // Pull the events that fed this row. The score row spans
    // [windowStart, windowEnd]; we filter events to that range.
    const events = await prisma.productivityEvent.findMany({
      where: {
        userId,
        occurredAt: { gte: row.windowStart, lte: row.windowEnd },
      },
      orderBy: { occurredAt: 'desc' },
      take: 500,
    });

    const activeWeightSet = await prisma.universalWeightSet.findFirst({
      orderBy: { effectiveFrom: 'desc' },
    });

    const base = toDTO(row);
    const breakdown: ScoreBreakdownDTO = {
      ...base,
      weightsApplied:
        (activeWeightSet?.weights as Record<ProductivitySignal, number>) ??
        ({} as Record<ProductivitySignal, number>),
      thresholdHigh: activeWeightSet?.thresholdHigh ?? 75,
      thresholdLow: activeWeightSet?.thresholdLow ?? 40,
      events: events.map((ev) => ({
        id: ev.id,
        signal: ev.signal as ProductivitySignal,
        eventType: ev.eventType,
        occurredAt: ev.occurredAt.toISOString(),
        source: ev.source,
        sourceId: ev.sourceId,
        scoreDelta: ev.scoreDelta ? Number(ev.scoreDelta) : null,
        gamingFlag: ev.gamingFlag,
        rawPayload: ev.rawPayload as Record<string, unknown>,
      })),
    };

    res.json({ success: true, data: breakdown });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /admin/pulse/weights
 * Returns current active weights + audit history (last 20 rows).
 */
export async function getWeightsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const history = await prisma.universalWeightSet.findMany({
      orderBy: { effectiveFrom: 'desc' },
      take: 20,
      include: {
        updatedByUser: { select: { id: true, name: true, email: true } },
      },
    });
    const active = history[0] ?? null;
    res.json({
      success: true,
      data: {
        active: active
          ? {
              id: active.id,
              weights: active.weights,
              signalBaselines: active.signalBaselines,
              thresholdHigh: active.thresholdHigh,
              thresholdLow: active.thresholdLow,
              effectiveFrom: active.effectiveFrom.toISOString(),
              updatedBy: active.updatedByUser,
              changeNote: active.changeNote,
            }
          : null,
        history: history.map((h) => ({
          id: h.id,
          effectiveFrom: h.effectiveFrom.toISOString(),
          updatedBy: h.updatedByUser,
          changeNote: h.changeNote,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /admin/pulse/observability
 * Worker lag, outbox depth, compute durations.
 */
export async function getObservabilityHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, data: productivityMetrics.snapshot() });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /admin/pulse/scores/:userId/recompute
 * Triggers an immediate recompute for one user (skips debounce).
 */
export async function recomputeScoresForUserHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const userId = req.params.userId;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundError('User');

    // Run in the background; respond immediately. The recompute is
    // idempotent so repeated triggers don't double-write.
    void scoreRecomputeWorker.recomputeForUser(userId);
    res.json({ success: true, data: { userId, triggered: true } });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /admin/pulse/scores/recompute-all
 *
 * Kickstart endpoint — used after enabling the feature flag for the
 * first time, or after a weight change, to backfill scores for every
 * active employee right now (skips debounce per user).
 *
 * Returns immediately with the queued user count; the actual work
 * happens in the background. We deliberately do NOT wait on the
 * recomputes — for a 50-employee team the total wall-clock could be
 * minutes, and we don't want to hold the HTTP socket open.
 *
 * Safety:
 *   - Only kicks off recompute for `isActive: true` users so leavers
 *     don't get scored.
 *   - Bounded to 500 users in one call. Above that, the caller is
 *     misusing the endpoint — split the team or hit `/recompute` per
 *     user instead.
 *   - Each recompute is idempotent (UNIQUE upsert), so a SUPER_ADMIN
 *     hammering this button doesn't double-write.
 *   - **Wave 10**: module-side throttle — refuse to fire more often
 *     than once per `RECOMPUTE_ALL_COOLDOWN_MS`. Catches the case
 *     where a SUPER_ADMIN double-clicks the button or the FE retries
 *     on a flaky network. The retry returns 429 with the seconds
 *     remaining so the FE can render "wait 28s" instead of silently
 *     spawning another 500 recomputes.
 */
const RECOMPUTE_ALL_COOLDOWN_MS = 30_000;
let lastRecomputeAllAt = 0;

/** Resets the throttle. Used by tests. Never call from prod code. */
export function _resetRecomputeAllThrottleForTest(): void {
  lastRecomputeAllAt = 0;
}

export async function recomputeAllScoresHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const now = Date.now();
    const sinceLast = now - lastRecomputeAllAt;
    if (sinceLast < RECOMPUTE_ALL_COOLDOWN_MS) {
      const retryInSeconds = Math.ceil((RECOMPUTE_ALL_COOLDOWN_MS - sinceLast) / 1000);
      res.status(429).json({
        success: false,
        error: {
          code: 'RECOMPUTE_THROTTLED',
          message: `Recompute-all was triggered ${Math.floor(sinceLast / 1000)}s ago. Try again in ${retryInSeconds}s.`,
          retryInSeconds,
        },
      });
      return;
    }
    lastRecomputeAllAt = now;
    // Wave 14 SECURITY — recompute targets EMPLOYEE roles only. The
    // worker (`recomputeForUser`) also enforces this now as a second
    // layer, but filtering here avoids spinning up no-op transactions
    // for the CLIENT rows + makes the userCount in the response
    // reflect reality (employees actually being scored, not the full
    // active-user count).
    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        role: { in: ['SUPER_ADMIN', 'ADMIN', 'PRODUCT_MANAGER', 'ENGINEER'] },
      },
      select: { id: true },
      take: 500,
    });
    for (const u of users) {
      void scoreRecomputeWorker.recomputeForUser(u.id);
    }
    res.json({
      success: true,
      data: { triggered: true, userCount: users.length },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /admin/pulse/scores/summary?cadence=...
 *
 * Team-wide rollup for the Reports page hero. Returns aggregate
 * stats over the current cadence window so the FE doesn't have to
 * compute them client-side from 200+ row payloads:
 *
 *   - Total employees scored
 *   - Average composite score
 *   - Band distribution (HIGH / MEDIUM / LOW counts)
 *   - Gaming-flag count (sum across all employees this window)
 *   - Last-computed-at timestamp (most recent in the set)
 */
export async function getScoresSummaryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const cadence = (req.query.cadence as ProductivityCadence) || 'WEEKLY';
    if (!['DAILY', 'WEEKLY', 'MONTHLY'].includes(cadence)) {
      throw new ValidationError('cadence must be DAILY, WEEKLY, or MONTHLY');
    }

    const rows = await prisma.employeeProductivityScore.findMany({
      where: { cadence },
      select: {
        compositeScore: true,
        band: true,
        flags: true,
        computedAt: true,
      },
    });

    if (rows.length === 0) {
      res.json({
        success: true,
        data: {
          cadence,
          totalEmployees: 0,
          averageComposite: 0,
          bandDistribution: { HIGH: 0, MEDIUM: 0, LOW: 0 },
          gamingFlagsTotal: 0,
          lastComputedAt: null,
        },
      });
      return;
    }

    const distribution = { HIGH: 0, MEDIUM: 0, LOW: 0 } as Record<
      'HIGH' | 'MEDIUM' | 'LOW',
      number
    >;
    let compositeSum = 0;
    let gamingFlagsTotal = 0;
    let latestComputedAt = rows[0].computedAt;

    for (const r of rows) {
      distribution[r.band] += 1;
      compositeSum += Number(r.compositeScore);
      const flags = (r.flags ?? {}) as { gamingFlagsCount?: number };
      gamingFlagsTotal += flags.gamingFlagsCount ?? 0;
      if (r.computedAt > latestComputedAt) latestComputedAt = r.computedAt;
    }

    res.json({
      success: true,
      data: {
        cadence,
        totalEmployees: rows.length,
        averageComposite: Math.round((compositeSum / rows.length) * 10) / 10,
        bandDistribution: distribution,
        gamingFlagsTotal,
        lastComputedAt: latestComputedAt.toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
}
