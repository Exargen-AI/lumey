/**
 * Notifications capability module (M1). Contributes the notification routes and
 * — the first cross-module reaction on the kernel bus — fans out a
 * task-subscriber notification when a comment lands on a task.
 *
 * This decouples the comment service from notification specifics: comments
 * announce `comment.created`; notifications decide who to tell. `enhances:
 * ['comments']` is a soft (informational) relation — notifications works fine
 * without comments enabled; it just receives no comment events.
 */
import prisma from '../../config/database';
import { notifyTaskSubscribersOfComment } from '../../services/notification.service';
import { getSubscriberIdsForNotify } from '../../services/taskSubscription.service';
import notificationRoutes from '../../routes/notification.routes';
import type { ModuleManifest } from '../../kernel';
import type { CommentCreatedEvent } from '../comments/events';

/**
 * Fan out a subscriber notification for a task comment. Excludes the author and
 * anyone already pinged by the inline mention notification. No-op for non-task
 * comments (milestone/project comments have no subscriber concept). Errors
 * propagate to the bus, which isolates and logs them — a notification failure
 * must never affect the comment that triggered it.
 */
export async function fanOutTaskComment(event: CommentCreatedEvent): Promise<void> {
  if (!event.taskId) return;

  const exclude = new Set<string>([event.authorId, ...event.mentionedUserIds]);
  const subscriberIds = await getSubscriberIdsForNotify(event.taskId, exclude);
  if (subscriberIds.length === 0) return;

  const task = await prisma.task.findUnique({
    where: { id: event.taskId },
    select: { title: true },
  });
  if (!task) return;

  await notifyTaskSubscribersOfComment({
    taskId: event.taskId,
    taskTitle: task.title,
    projectId: event.projectId,
    projectName: event.projectName,
    authorId: event.authorId,
    authorName: event.authorName,
    commentSnippet: event.contentSnippet,
    subscriberIds,
  });
}

export const notificationsModule: ModuleManifest = {
  id: 'notifications',
  version: '1.0.0',
  entitlement: 'notifications',
  enhances: ['comments'],
  routes: [{ path: '/api/v1', router: notificationRoutes }],
  init: (ctx) => {
    ctx.bus.subscribe<CommentCreatedEvent>('comment.created', fanOutTaskComment);
  },
};
