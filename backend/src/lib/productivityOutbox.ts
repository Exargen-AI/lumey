/**
 * ACCESS POLICY (R5 lockdown, 2026-05-29)
 * =======================================
 * Productivity-score reads are SUPER_ADMIN-only. The outbox WRITE path
 * (this module) is intentionally NOT access-gated — every emitting
 * service (dailyUpdate, task, clockSession, deviceTelemetry) writes
 * events for the acting user as part of normal operation. The gate is
 * on the READ side. See `backend/src/middleware/requireProductivityScoreAccess.ts`.
 *
 * Pulse Multi-Signal Productivity Score — outbox writer.
 *
 * The outbox pattern guarantees event-log durability without
 * after-commit hooks: every emitting service writes its
 * `productivity_events` row INSIDE the same Prisma transaction as its
 * source mutation. If the transaction rolls back, the event row never
 * existed; if it commits, the event is durable.
 *
 * Callers MUST pass an in-transaction Prisma client (`tx`) — never the
 * global `prisma` — so that the event is part of the same atomic unit.
 * Misuse is caught at the type level: this function accepts the
 * Prisma transaction client type, not PrismaClient.
 *
 * Idempotency: each event has a unique (source, sourceId, eventType)
 * key. Replaying the same source mutation (e.g. a retry after a
 * network blip) silently no-ops on the second insert — we use
 * `createMany({ skipDuplicates })`. The transaction still commits
 * normally; downstream the worker just sees one event, not two.
 *
 * Feature flag: if `pulseCompositeScore.beta` is OFF, emit is a no-op.
 * That way services emit unconditionally and the feature gate lives
 * in one place (here), not sprinkled across every emitting service.
 */

import type { Prisma, ProductivitySignal } from '@prisma/client';
import { isFeatureEnabled } from './featureFlags';

/**
 * Transaction-scoped Prisma client. Match the signature Prisma's
 * `$transaction(async (tx) => { ... })` callback receives.
 */
type PrismaTx = Omit<
  Prisma.TransactionClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export interface EmitProductivityEventInput {
  /** The user the score applies to (work-author for standups/tasks/code etc.). */
  userId: string;
  signal: ProductivitySignal;
  /** Free-form event sub-type. Convention: `<source>.<verb>` (e.g. 'standup.submitted', 'task.closed'). */
  eventType: string;
  /** When the underlying action happened. */
  occurredAt: Date;
  /** Exact source data for audit / replay. Must be JSON-serialisable. */
  rawPayload: Record<string, unknown>;
  /** Source table / system. Lowercase snake_case. */
  source: string;
  /** Unique id within `source` for de-dupe. */
  sourceId: string;
  /**
   * Optional pre-computed contribution to the signal sub-score. Most
   * scorers compute this at recompute time and leave this null here.
   * Setting it is an optimisation for hot-path events where the
   * contribution is trivially known.
   */
  scoreDelta?: number;
  /**
   * If the gaming guard for this event type fired at write time, set
   * the flag here. Recompute will then skip this row's contribution.
   * Convention: snake_case (e.g. 'standup_too_short', 'task_closed_too_fast').
   */
  gamingFlag?: string;
}

/**
 * Write one productivity event inside an existing Prisma transaction.
 *
 * Returns the count of rows inserted (0 if duplicate or flag off, 1 if
 * inserted). The caller is the only thing that cares about this — most
 * just fire-and-forget.
 */
export async function emitProductivityEvent(
  tx: PrismaTx,
  input: EmitProductivityEventInput,
): Promise<number> {
  if (!isFeatureEnabled('pulseCompositeScore.beta')) {
    return 0;
  }

  const result = await tx.productivityEvent.createMany({
    data: [
      {
        userId: input.userId,
        signal: input.signal,
        eventType: input.eventType,
        occurredAt: input.occurredAt,
        rawPayload: input.rawPayload as Prisma.InputJsonValue,
        scoreDelta: input.scoreDelta ?? null,
        gamingFlag: input.gamingFlag ?? null,
        source: input.source,
        sourceId: input.sourceId,
      },
    ],
    skipDuplicates: true,
  });
  return result.count;
}

/**
 * Batch variant — useful when one source mutation produces N events
 * (e.g. a daily-update with multiple task transitions).
 */
export async function emitProductivityEvents(
  tx: PrismaTx,
  inputs: EmitProductivityEventInput[],
): Promise<number> {
  if (inputs.length === 0) return 0;
  if (!isFeatureEnabled('pulseCompositeScore.beta')) return 0;

  const result = await tx.productivityEvent.createMany({
    data: inputs.map((input) => ({
      userId: input.userId,
      signal: input.signal,
      eventType: input.eventType,
      occurredAt: input.occurredAt,
      rawPayload: input.rawPayload as Prisma.InputJsonValue,
      scoreDelta: input.scoreDelta ?? null,
      gamingFlag: input.gamingFlag ?? null,
      source: input.source,
      sourceId: input.sourceId,
    })),
    skipDuplicates: true,
  });
  return result.count;
}
