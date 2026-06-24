import { TaskSubscriptionSource } from '@prisma/client';
import prisma from '../config/database';
import { NotFoundError } from '../utils/errors';

/**
 * Task subscriptions — users follow a task to receive notifications
 * on new comments + significant edits.
 *
 * Subscription sources:
 *
 *   AUTO_ASSIGNEE / AUTO_REVIEWER / AUTO_CREATOR — added by the
 *   service layer when a user takes on that role on a task. The
 *   ownership lifecycle implies "you should know what happens here."
 *
 *   AUTO_MENTIONED — added when a user is @-mentioned in a task
 *   comment. Mentions are an explicit "I want this person's
 *   attention" signal; auto-subscribing keeps the loop open without
 *   making the mentioner think about it.
 *
 *   MANUAL — user explicitly hit "subscribe" in the UI.
 *
 * Unsubscribe is intentional and respected: once a user removes
 * themselves, we DON'T re-auto-subscribe them on a subsequent role
 * change (e.g. they unsubscribed, then got assigned — we don't
 * silently put them back on the watch list). Implemented by the
 * fact that `autoSubscribe` uses `upsert` with create-only data;
 * if the row doesn't exist (because they unsubscribed), the upsert
 * RE-CREATES it. So actually the current shape WILL re-add them.
 *
 * Trade-off note: an "unsubscribed forever" model requires a
 * separate `unsubscribed_tasks` table or a tombstone column. For
 * v1 the simpler shape is "auto-subscribe is idempotent; if you
 * really want to stay off, mute notifications per-type globally
 * (future feature)." Documented so the FE can set the expectation.
 */

/**
 * Subscribe a user to a task. Idempotent — re-subscribing is a
 * no-op (the existing row's source isn't downgraded).
 *
 * For MANUAL subscriptions the user is acting on their own behalf.
 * For AUTO_* the service layer wires it in.
 */
export async function subscribeToTask(
  taskId: string,
  userId: string,
  source: TaskSubscriptionSource,
): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true },
  });
  if (!task) throw new NotFoundError('Task');

  // Upsert: create on first subscribe; on conflict, leave the
  // existing row alone (don't downgrade source from MANUAL → AUTO_*
  // when an auto-subscribe fires later).
  await prisma.taskSubscription.upsert({
    where: { taskId_userId: { taskId, userId } },
    create: { taskId, userId, source },
    update: {}, // no-op on conflict
  });
}

/**
 * Unsubscribe a user from a task. Idempotent — unsubscribing when
 * not subscribed is a no-op (returns { removed: 0 }). Both manual
 * and auto subscriptions are removable by the user.
 */
export async function unsubscribeFromTask(
  taskId: string,
  userId: string,
): Promise<{ removed: number }> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true },
  });
  if (!task) throw new NotFoundError('Task');

  const result = await prisma.taskSubscription.deleteMany({
    where: { taskId, userId },
  });
  return { removed: result.count };
}

/**
 * List every user subscribed to a task. Returns subscriber userIds
 * + source so the FE can show "Maya (assigned)", "Sarah (manual)",
 * etc. in the subscribers panel.
 *
 * Caller is responsible for checking the requester has access to
 * this task (taskAccess middleware on the route).
 */
export async function listTaskSubscribers(taskId: string) {
  return prisma.taskSubscription.findMany({
    where: { taskId },
    select: {
      userId: true,
      source: true,
      createdAt: true,
      user: { select: { id: true, name: true, role: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Return the list of subscriber userIds for fan-out notification.
 * Excludes a given actor (the user whose action triggered the
 * fan-out) so they don't get notified about their own work.
 *
 * Used by createComment and updateTask after they've fired any
 * field-specific notifications (mention, assignment, priority,
 * due-date) — passing the actor's userId + the set of users who
 * already got a more-specific ping in `excludeUserIds` so we
 * don't double-notify.
 */
export async function getSubscriberIdsForNotify(
  taskId: string,
  excludeUserIds: Set<string>,
): Promise<string[]> {
  // 2026-05-23 audit bug-fix: defence-in-depth filter on subscribers.
  // The primary cleanup happens at `removeProjectMember` time (which
  // deletes the subscription rows), but a deactivated user is NOT
  // removed from project members and would still appear here. Adding
  // the `user.isActive` filter ensures a deactivated user never gets
  // a fresh notification, regardless of how the stale subscription
  // came to exist.
  //
  // We do NOT filter by project-membership here because (a) SUPER_ADMIN
  // and ADMIN can legitimately subscribe to any task without being a
  // project member, and (b) the cleanup at removeProjectMember time
  // already drops the rows for users who are no longer members.
  const subs = await prisma.taskSubscription.findMany({
    where: {
      taskId,
      userId: { notIn: Array.from(excludeUserIds) },
      user: { isActive: true },
    },
    select: { userId: true },
  });
  return (subs ?? []).map((s) => s.userId);
}
