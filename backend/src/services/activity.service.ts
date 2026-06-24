import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { logger } from '../lib/logger';

interface LogActivityParams {
  userId: string;
  projectId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
}

/**
 * Type compatible with both `prisma` and the transaction client passed to
 * `prisma.$transaction(async (tx) => ...)`. Lets callers wrap the activity
 * write in the same transaction as the operation it describes — so we never
 * end up with "task deleted but no audit log" on partial failure.
 */
type ActivityClient = Pick<typeof prisma, 'activity'>;

/**
 * Append an audit-trail entry. Pass a transaction client (`tx`) to write the
 * activity inside the same transaction as the operation it describes. Without
 * tx, the write is fire-and-forget — failures are logged to stderr but never
 * thrown, so activity-log issues can't take down the main request.
 *
 * Examples:
 *   // Fire-and-forget (read-only ops, login events):
 *   await logActivity({ userId, action: 'logged_in' });
 *
 *   // Transactional (mutation + audit must succeed atomically):
 *   await prisma.$transaction(async (tx) => {
 *     await tx.task.delete({ where: { id } });
 *     await logActivity({ userId, action: 'deleted_task', ... }, tx);
 *   });
 */
export async function logActivity(params: LogActivityParams, tx?: ActivityClient): Promise<void> {
  const client = tx ?? prisma;
  const data = {
    userId: params.userId,
    projectId: params.projectId,
    action: params.action,
    targetType: params.targetType,
    targetId: params.targetId,
    details: params.details ? (params.details as Prisma.InputJsonValue) : undefined,
  };

  if (tx) {
    // Inside a transaction — let errors propagate so the whole tx rolls back.
    await client.activity.create({ data });
    return;
  }

  // Fire-and-forget — log so ops can investigate, but never throw.
  try {
    await client.activity.create({ data });
  } catch (err) {
    logger.error({ err: err }, '[activity] log write failed (continuing anyway):');
  }
}
