/**
 * Pulse productivity score — scoreRecomputeWorker (R5).
 *
 * The engine that consumes the outbox and produces composite scores.
 * Runs as a setInterval inside the main Express process (one
 * worker, in-app — Exargen-AI is on a single Railway service, so a
 * separate worker container would be over-engineering for v1).
 *
 * Lifecycle:
 *   1. start(): registers the polling interval. No-op if the feature
 *      flag is off; safe to call unconditionally on boot.
 *   2. Every POLL_INTERVAL_MS, runCycle() runs:
 *        a. Fetch up to BATCH_SIZE unprocessed productivity_events,
 *           oldest first.
 *        b. Bucket events by userId.
 *        c. For each userId, schedule a debounced recompute
 *           (60s window — a write storm from one user collapses
 *           into one recompute call).
 *        d. After the debounce fires, fetch the user's full rolling
 *           30d events from the DB, compute scores for all 3
 *           cadences, upsert employee_productivity_scores, and mark
 *           the processed events.
 *   3. stop(): clears the polling interval and the per-user debouncers.
 *      Called on SIGTERM for graceful shutdown.
 *
 * Why polling vs. LISTEN/NOTIFY:
 *   - LISTEN/NOTIFY requires a dedicated DB connection held open and
 *     adds complexity. Polling at 5s with an outbox table indexed on
 *     processedAt is plenty fast for the team-size scale.
 *   - Polling is naturally idempotent + restart-safe — a missed
 *     NOTIFY would be a silent bug; a missed poll is a 5s lag.
 *
 * Concurrency story:
 *   - The worker is single-process. If Exargen-AI ever scales to 2+
 *     backend instances, two workers could both pick up the same
 *     event window. The processedAt UPDATE is conditional on
 *     (processedAt IS NULL), so the loser of the race makes its
 *     update a no-op. Score upsert is idempotent (UNIQUE on user +
 *     window + cadence). So duplicate work, but no duplicate writes.
 *     A proper leader-election layer (Postgres advisory locks) can
 *     land later if it ever matters.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import prisma from '../config/database';
import { isFeatureEnabled } from '../lib/featureFlags';
import {
  PRODUCTIVITY_SIGNALS,
  weightsSumValid,
  type ProductivityCadence,
  type ProductivitySignal,
} from '@exargen/shared';
import { computeForUser, defaultWeightSet, type ActiveWeightSet } from './computeForUser';
import { rolling30DayWindow } from './scoreCadences';
import { productivityMetrics } from './observability';

const POLL_INTERVAL_MS = 5_000;
const DEBOUNCE_MS = 60_000;
const BATCH_SIZE = 200;

/**
 * Decide which signals are UNOBSERVABLE for a user this cycle, so the
 * composite scorer drops them and renormalises the weights over the
 * rest (partial scoring for not-yet-onboarded employees, 2026-06-01).
 *
 * A signal is "inactive" ONLY when we have no way to measure it — never
 * because the user simply scored zero on something we CAN see:
 *
 *   DEEP_WORK / DEVICE_HYGIENE — produced only by the Pulse agent
 *     (foreground focus blocks + device health snapshots). Inactive
 *     when the user has no enrolled (ACTIVE) device.
 *   PRESENCE — observable via manual clock in/out OR the agent.
 *     Inactive only when the user has no device AND emitted zero
 *     PRESENCE events (never clocked in either) in the window —
 *     otherwise a no-clock day is a real low-presence signal.
 *   STANDUP / EXECUTION / CODE / COMMUNICATION — always observable
 *     from Command Center / GitHub for every employee, agent or not.
 *     Never auto-dropped; a zero is a real zero.
 *
 * Exported for direct unit testing.
 */
export function determineInactiveSignals(
  hasActiveDevice: boolean,
  signalsPresent: ProductivitySignal[],
): ProductivitySignal[] {
  if (hasActiveDevice) return [];
  const inactive: ProductivitySignal[] = ['DEEP_WORK', 'DEVICE_HYGIENE'];
  if (!signalsPresent.includes('PRESENCE')) inactive.push('PRESENCE');
  return inactive;
}

class RecomputeWorker {
  private pollHandle: NodeJS.Timeout | null = null;
  private pendingTimers = new Map<string, NodeJS.Timeout>();
  private cycleInFlight = false;

  /**
   * Spin up the worker. No-op if already running OR if the feature
   * flag is off. Safe to call on every process boot.
   */
  start(): void {
    if (this.pollHandle !== null) return;
    if (!isFeatureEnabled('pulseCompositeScore.beta')) return;
    this.pollHandle = setInterval(() => {
      void this.runCycle();
    }, POLL_INTERVAL_MS);
    // Allow process exit while the timer is pending (tests, SIGINT).
    if (typeof this.pollHandle.unref === 'function') {
      this.pollHandle.unref();
    }
  }

  /** Graceful shutdown — called from SIGTERM handler. */
  stop(): void {
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    for (const t of this.pendingTimers.values()) clearTimeout(t);
    this.pendingTimers.clear();
  }

  /**
   * One poll cycle. Public so the API endpoint
   * `POST /admin/pulse/scores/recompute` (Wave 5+) can trigger it
   * inline for a SUPER_ADMIN-requested rebuild.
   */
  async runCycle(): Promise<void> {
    if (this.cycleInFlight) return;
    if (!isFeatureEnabled('pulseCompositeScore.beta')) return;
    this.cycleInFlight = true;
    try {
      // ── 1. Lag + depth metrics ─────────────────────────────────
      const [oldestUnprocessed, depth] = await Promise.all([
        prisma.productivityEvent.findFirst({
          where: { processedAt: null },
          orderBy: { recordedAt: 'asc' },
          select: { recordedAt: true },
        }),
        prisma.productivityEvent.count({ where: { processedAt: null } }),
      ]);
      const now = new Date();
      const lagSeconds = oldestUnprocessed
        ? Math.floor((now.getTime() - oldestUnprocessed.recordedAt.getTime()) / 1000)
        : 0;
      productivityMetrics.setWorkerLagSeconds(lagSeconds);
      productivityMetrics.setOutboxDepth(depth);
      productivityMetrics.markCycleComplete();

      if (depth === 0) return;

      // ── 2. Fetch the next batch of unprocessed events ─────────
      const batch = await prisma.productivityEvent.findMany({
        where: { processedAt: null },
        orderBy: { recordedAt: 'asc' },
        take: BATCH_SIZE,
        select: { id: true, userId: true },
      });

      // ── 3. Bucket by userId → debounced recompute ─────────────
      const userIds = new Set(batch.map((e) => e.userId));
      for (const userId of userIds) {
        this.scheduleDebouncedRecompute(userId);
      }
    } catch (err) {
      console.error('[scoreRecomputeWorker] cycle error:', err);
    } finally {
      this.cycleInFlight = false;
    }
  }

  private scheduleDebouncedRecompute(userId: string): void {
    const existing = this.pendingTimers.get(userId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.pendingTimers.delete(userId);
      void this.recomputeForUser(userId);
    }, DEBOUNCE_MS);
    if (typeof timer.unref === 'function') timer.unref();
    this.pendingTimers.set(userId, timer);
  }

  /**
   * Public for tests + ad-hoc admin triggers: recompute one user
   * NOW (skip the debounce). Idempotent — multiple concurrent calls
   * for the same user produce the same upsert.
   */
  async recomputeForUser(userId: string): Promise<void> {
    const started = Date.now();
    try {
      // Wave 14 SECURITY — refuse to score non-employees + CLIENT
      // users. The R5 lockdown was originally an access policy
      // (SUPER_ADMIN-only READS); the worker side also needs a
      // policy: CLIENTs (and any future external role) MUST NOT
      // appear in `employee_productivity_scores`. Pre-Wave-14, even
      // after we patched the routes (Wave 13) the existing stale
      // CLIENT score rows stayed orphaned because `recomputeForUser`
      // returns early when events.length === 0 — the rows weren't
      // overwritten. Now we delete + bail before scoring, so a
      // re-classified employee → CLIENT also drops their score.
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, isActive: true },
      });
      const EMPLOYEE_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'PRODUCT_MANAGER', 'ENGINEER']);
      if (!user || !user.isActive || !EMPLOYEE_ROLES.has(user.role)) {
        // Drop any orphan score rows for this user. Cheap idempotent
        // delete by userId.
        await prisma.employeeProductivityScore.deleteMany({ where: { userId } });
        return;
      }

      const window = rolling30DayWindow();

      // Fetch events + weight set + device count in parallel.
      const [events, weightSet, activeDeviceCount] = await Promise.all([
        prisma.productivityEvent.findMany({
          where: {
            userId,
            occurredAt: { gte: window.start, lte: window.end },
          },
          orderBy: { occurredAt: 'asc' },
        }),
        loadActiveWeightSet(prisma),
        // Does this user have a Pulse agent installed + enrolled? Drives
        // the partial-scoring path below.
        prisma.device.count({
          where: { ownerUserId: userId, status: 'ACTIVE' },
        }),
      ]);

      if (events.length === 0) return;

      // ── Partial scoring for not-yet-onboarded employees ──────
      //
      // 2026-06-01. Two of the seven signals can ONLY be produced by
      // the Pulse agent (DEEP_WORK = foreground focus blocks,
      // DEVICE_HYGIENE = device health snapshots). PRESENCE has a
      // non-agent source too (manual clock in/out) but is unobservable
      // if the user neither clocked in nor runs an agent.
      //
      // Before this change the worker passed `inactiveSignals: []`, so
      // a productive employee who hadn't installed the agent scored 0
      // on DEEP_WORK (22%) + DEVICE_HYGIENE (5%) — a ~27% drag for
      // something physically impossible for them to produce. That made
      // the whole report look broken during a gradual rollout.
      //
      // Now we mark the signals we genuinely CANNOT observe for this
      // user as inactive; the composite scorer renormalises the weights
      // over the remaining signals (the plumbing already existed). A
      // non-onboarded employee is scored fairly on standups + tasks +
      // code + comments (+ presence if they clock in). Signals we CAN
      // observe but that came back empty (e.g. didn't submit standups)
      // still score 0 — those are real, not measurement gaps.
      const inactiveSignals = determineInactiveSignals(
        activeDeviceCount > 0,
        events.map((e) => e.signal as ProductivitySignal),
      );

      // ── Run the scorers ──────────────────────────────────────
      const result = computeForUser({
        userId,
        events: events.map((e) => ({
          id: e.id,
          signal: e.signal as ProductivitySignal,
          eventType: e.eventType,
          occurredAt: e.occurredAt,
          rawPayload: e.rawPayload as Record<string, unknown>,
          scoreDelta: e.scoreDelta ? Number(e.scoreDelta) : null,
          gamingFlag: e.gamingFlag,
          source: e.source,
          sourceId: e.sourceId,
        })),
        weightSet,
        inactiveSignals,
      });

      // ── Upsert per-cadence score rows, mark events processed ─
      await prisma.$transaction(async (tx) => {
        for (const cadence of ['DAILY', 'WEEKLY', 'MONTHLY'] as ProductivityCadence[]) {
          const cad =
            cadence === 'DAILY'
              ? result.daily
              : cadence === 'WEEKLY'
                ? result.weekly
                : result.monthly;
          await tx.employeeProductivityScore.upsert({
            where: {
              employee_productivity_scores_window_key: {
                userId,
                windowStart: cad.windowStart,
                windowEnd: cad.windowEnd,
                cadence,
              },
            },
            create: {
              userId,
              windowStart: cad.windowStart,
              windowEnd: cad.windowEnd,
              cadence,
              compositeScore: cad.compositeScore,
              band: cad.band,
              signalScores: signalScoresJson(cad.signalScores),
              rawBreakdown: cad.rawBreakdown as unknown as Prisma.InputJsonValue,
              flags: cad.flags as unknown as Prisma.InputJsonValue,
              computedFromEventCount: cad.computedFromEventCount,
            },
            update: {
              compositeScore: cad.compositeScore,
              band: cad.band,
              signalScores: signalScoresJson(cad.signalScores),
              rawBreakdown: cad.rawBreakdown as unknown as Prisma.InputJsonValue,
              flags: cad.flags as unknown as Prisma.InputJsonValue,
              computedAt: new Date(),
              computedFromEventCount: cad.computedFromEventCount,
            },
          });
        }

        // Mark all of this user's currently-unprocessed events as
        // processed. We use occurredAt-bounded filter (not the event
        // ids from the original batch) so events that arrived BETWEEN
        // the cycle's poll and our recompute window also get marked.
        await tx.productivityEvent.updateMany({
          where: {
            userId,
            processedAt: null,
            occurredAt: { gte: window.start, lte: window.end },
          },
          data: { processedAt: new Date() },
        });
      });
    } catch (err) {
      console.error(`[scoreRecomputeWorker] recompute for user ${userId} failed:`, err);
    } finally {
      productivityMetrics.recordComputeDuration(Date.now() - started);
    }
  }
}

/**
 * Project sub-scores into a JSON shape for the DB column. Stripping
 * the function-typed `signal` reference keeps the JSON small +
 * stable.
 */
function signalScoresJson(
  scores: Record<ProductivitySignal, { score: number }>,
): Prisma.InputJsonValue {
  const out: Record<string, number> = {};
  for (const sig of PRODUCTIVITY_SIGNALS) {
    out[sig] = scores[sig]?.score ?? 0;
  }
  return out as Prisma.InputJsonValue;
}

/**
 * Read the active universal_weight_sets row, defending against
 * corrupted JSONB (returns the default if weights fail validation).
 *
 * Exported for tests + the ad-hoc admin recompute trigger.
 */
export async function loadActiveWeightSet(client: PrismaClient): Promise<ActiveWeightSet> {
  const active = await client.universalWeightSet.findFirst({
    orderBy: { effectiveFrom: 'desc' },
  });
  if (!active) return defaultWeightSet();

  const weights = active.weights as unknown as Record<ProductivitySignal, number>;
  const baselines = active.signalBaselines as unknown as Record<string, unknown>;

  if (!weightsSumValid(weights)) {
    productivityMetrics.incrementMalformedWeights();
    console.error(
      '[scoreRecomputeWorker] active weight set is malformed; falling back to R5 defaults',
      { weights },
    );
    return defaultWeightSet();
  }

  return {
    weights,
    signalBaselines: baselines as ActiveWeightSet['signalBaselines'],
    thresholdHigh: active.thresholdHigh,
    thresholdLow: active.thresholdLow,
  };
}

/** Singleton worker — booted by index.ts. */
export const scoreRecomputeWorker = new RecomputeWorker();
