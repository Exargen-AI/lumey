import prisma from '../config/database';
import { getMutedTypes, getMutedTypesForUsers } from './notificationPreference.service';

interface CreateNotificationInput {
  userId: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
  /**
   * Escape hatch for admin-driven / operationally-critical
   * notifications that MUST fire regardless of user preference
   * (e.g. an admin manually pinging a stalled onboarding).
   * Default `false`: respect the user's mute settings.
   *
   * Keep this rare. Every `bypassMute: true` call site is a place
   * we've decided the system's need to inform overrides the user's
   * stated preference. Document why at each call site.
   */
  bypassMute?: boolean;
}

/**
 * Bottom-of-the-funnel write. Every fan-out helper in this file
 * ultimately lands here. We honor the user's mute preferences as the
 * last step before the INSERT — a muted (userId, type) silently
 * drops. This is the cheapest place to enforce the policy: the call
 * site doesn't have to know which user wants what.
 *
 * "Silently drops" is the right behavior:
 *   - The recipient asked for silence; sending anyway breaks the
 *     contract.
 *   - The trigger path (e.g. notifyTaskNudge) shouldn't have to
 *     learn whether the recipient has muted nudges. Less coupling.
 *   - We don't insert with a `muted: true` flag and skip the bell
 *     count — that would leak the existence of a notification the
 *     user explicitly didn't want. Sparse storage keeps the
 *     `notifications` table small + makes the bell query simpler.
 *
 * If you need to bypass mute for a truly critical notification
 * (e.g. a security event), bypass this helper and call
 * `prisma.notification.create` directly. As of this writing no such
 * call exists — every notification respects the user's preference.
 */
// Overloads keep the caller's type narrow when they explicitly bypass
// mute — the non-bypass call signature can return null (mute drop)
// but `bypassMute: true` guarantees a real Notification row, so the
// caller doesn't need a non-null assertion. Without overloads, TS
// would force every bypass call site to handle a null that can't happen.
export async function createNotification(
  input: CreateNotificationInput & { bypassMute: true },
): Promise<Awaited<ReturnType<typeof prisma.notification.create>>>;
export async function createNotification(
  input: CreateNotificationInput,
): Promise<Awaited<ReturnType<typeof prisma.notification.create>> | null>;
export async function createNotification(input: CreateNotificationInput) {
  const { bypassMute = false, ...row } = input;
  if (!bypassMute) {
    const muted = await getMutedTypes(input.userId);
    if (muted.has(input.type)) return null;
  }
  return prisma.notification.create({ data: row });
}

/**
 * Same contract as createNotification but for N recipients in one
 * write. We batch-fetch every recipient's mute list in one query
 * (vs N queries inside a loop), filter the inputs, and createMany
 * the survivors. If everyone muted the type, the createMany is a
 * no-op and returns count=0.
 */
export async function createBulkNotifications(inputs: CreateNotificationInput[]) {
  if (!inputs.length) return;
  const userIds = [...new Set(inputs.map((i) => i.userId))];
  const mutedByUser = await getMutedTypesForUsers(userIds);
  const filtered = inputs.filter((i) => !mutedByUser.get(i.userId)?.has(i.type));
  if (!filtered.length) return;
  return prisma.notification.createMany({ data: filtered });
}

export async function getUserNotifications(userId: string, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.notification.count({ where: { userId } }),
    prisma.notification.count({ where: { userId, read: false } }),
  ]);
  return { notifications, total, unreadCount, page, limit };
}

export async function getUnreadCount(userId: string) {
  return prisma.notification.count({ where: { userId, read: false } });
}

/**
 * Flip a single notification's `read` flag to true. Scoped to the
 * caller's user via `where: { id, userId }` — a request for someone
 * else's notification id matches 0 rows and is a silent no-op at
 * the DB level. The handler turns the `count === 0` case into a
 * 404 so the FE doesn't optimistically show "marked read" for an
 * id that doesn't actually exist (stale tab, race with delete, or
 * cross-user attempt).
 *
 * Surfaced by the 2026-05-15 notification-subsystem audit — the
 * old handler returned `{ success: true }` regardless of whether
 * anything was updated.
 */
export async function markAsRead(notificationId: string, userId: string) {
  const result = await prisma.notification.updateMany({
    where: { id: notificationId, userId },
    data: { read: true },
  });
  return { updated: result.count };
}

/**
 * Flip every unread notification's `read` flag to true. Returns
 * the count so the FE can reconcile its local unread-badge state
 * without a follow-up `getUnreadCount` call (the old "no count"
 * shape forced the FE to refetch).
 */
export async function markAllAsRead(userId: string) {
  const result = await prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true },
  });
  return { updated: result.count };
}

/**
 * Delete a single notification. Scoped to the caller's user via
 * `deleteMany` so a stranger-id attempt is a silent no-op at the
 * DB layer (same defensive pattern as `markAsRead`). The handler
 * lifts a count-0 result into a 404.
 *
 * 2026-05-15 audit gap: pre-fix there was NO way to delete a
 * notification — users could only mark-as-read, so the list grew
 * forever as a graveyard. Common user complaint in the PM-tool
 * UX literature; closing it here.
 */
export async function deleteNotification(notificationId: string, userId: string) {
  const result = await prisma.notification.deleteMany({
    where: { id: notificationId, userId },
  });
  return { deleted: result.count };
}

// ─── Notification Triggers ───

export async function notifyTaskAssigned(
  taskId: string,
  assigneeId: string,
  taskTitle: string,
  projectName: string,
  assignedBy: string,
  projectId?: string,
) {
  if (assigneeId === assignedBy) return; // don't notify self

  // Route the recipient to a page they can actually open. A CLIENT lands in
  // their portal's task view; everyone else goes to their task list. Before
  // this, EVERY assignee got `/eng/my-tasks` — a route a client can't access —
  // so a ticket assigned to a client (e.g. "we need your decision") produced
  // a notification they could never act on.
  const assignee = await prisma.user.findUnique({
    where: { id: assigneeId },
    select: { role: true },
  });
  const isClient = assignee?.role === 'CLIENT';
  const link = isClient && projectId
    ? `/client/projects/${projectId}/tasks/${taskId}`
    : '/eng/my-tasks';

  await createNotification({
    userId: assigneeId,
    type: 'task_assigned',
    title: isClient ? 'A task needs your input' : 'New task assigned to you',
    body: `"${taskTitle}" in ${projectName}`,
    link,
  });
}

export async function notifyTaskBlocked(taskId: string, projectId: string, taskTitle: string, projectName: string) {
  // Notify project managers and admins
  const managers = await prisma.projectMember.findMany({
    where: { projectId, role: { in: ['ADMIN', 'PRODUCT_MANAGER'] } },
    select: { userId: true },
  });
  // Also notify admins not in project
  const admins = await prisma.user.findMany({
    where: { role: { in: ['SUPER_ADMIN', 'ADMIN'] }, isActive: true },
    select: { id: true },
  });
  const userIds = new Set([...managers.map((m) => m.userId), ...admins.map((a) => a.id)]);
  const inputs = Array.from(userIds).map((userId) => ({
    userId,
    type: 'blocker_alert',
    title: 'Task blocked',
    body: `"${taskTitle}" in ${projectName} is now blocked`,
    link: `/projects/${projectId}`,
  }));
  await createBulkNotifications(inputs);
}

/**
 * Fire when a task is handed off via the explicit "Request review"
 * action. Target audience is the reviewer (the person whose ball it
 * now is). We don't notify the requester — they just submitted the
 * request, they know.
 *
 * Link targets the task detail in whichever portal the reviewer
 * primarily inhabits. Clients land on /client/projects/:id/tasks/:taskId;
 * everyone else lands on /projects/:id/tasks/:taskId. The shape of
 * the link is the deciding factor — see notify caller for the
 * portal-aware path.
 */
export async function notifyReviewRequested(args: {
  taskId: string;
  projectId: string;
  taskTitle: string;
  projectName: string;
  reviewerId: string;
  requesterName: string;
  reviewerIsClient: boolean;
}) {
  await createNotification({
    userId: args.reviewerId,
    type: 'review_requested',
    title: `${args.requesterName} asked for your review`,
    body: `"${args.taskTitle}" in ${args.projectName}`,
    link: args.reviewerIsClient
      ? `/client/projects/${args.projectId}/tasks/${args.taskId}`
      : `/projects/${args.projectId}/tasks/${args.taskId}`,
  });
}

/**
 * Fire when a review is decided. Notify the assignee (the original
 * worker) — that's who owns the next move (either celebrate the
 * approval or pick up the changes). If there's no assignee we skip
 * silently; the comment + activity log are enough trail.
 */
export async function notifyReviewDecided(args: {
  taskId: string;
  projectId: string;
  taskTitle: string;
  projectName: string;
  assigneeId: string | null;
  reviewerName: string;
  decision: 'APPROVE' | 'REQUEST_CHANGES';
}) {
  if (!args.assigneeId) return;
  const approved = args.decision === 'APPROVE';
  await createNotification({
    userId: args.assigneeId,
    type: approved ? 'review_approved' : 'review_changes_requested',
    title: approved
      ? `${args.reviewerName} approved your work`
      : `${args.reviewerName} requested changes`,
    body: `"${args.taskTitle}" in ${args.projectName}`,
    // Always the internal link — assignees here are project team
    // members, not clients. The route is shared so this works for
    // engineer/PM/admin without per-role branching.
    link: `/projects/${args.projectId}/tasks/${args.taskId}`,
  });
}

/**
 * Fire when a task is deleted. Notify everyone with skin in the
 * game so they don't keep working on a task that no longer exists:
 *   - the assignee (working on it now)
 *   - the reviewer (waiting to approve it)
 *   - the creator (filed it)
 * The deleter is excluded — they obviously know they deleted it.
 *
 * Activity log alone is insufficient for this — most users don't
 * watch the per-project activity stream proactively, so deletion
 * was effectively a silent destructive op for the affected
 * humans. Surfaced by the 2026-05-15 task-lifecycle audit.
 */
export async function notifyTaskDeleted(args: {
  taskId: string;
  projectId: string;
  taskTitle: string;
  projectName: string;
  deletedBy: string;
  assigneeId: string | null;
  reviewerId: string | null;
  creatorId: string;
}) {
  // Dedupe across the three roles (assignee/reviewer/creator can be
  // the same person on small teams) AND exclude the deleter.
  const recipients = new Set<string>();
  if (args.assigneeId) recipients.add(args.assigneeId);
  if (args.reviewerId) recipients.add(args.reviewerId);
  recipients.add(args.creatorId);
  recipients.delete(args.deletedBy);
  if (recipients.size === 0) return;

  const inputs = Array.from(recipients).map((userId) => ({
    userId,
    type: 'task_deleted',
    title: 'A task you were on was deleted',
    body: `"${args.taskTitle}" in ${args.projectName} has been removed`,
    // Link to the project board; the task itself is gone so we
    // can't deep-link to it. The user lands somewhere useful
    // rather than a 404.
    link: `/projects/${args.projectId}`,
  }));
  await createBulkNotifications(inputs);
}

/**
 * Fire when the priority of a task with a current assignee
 * changes. Both directions notify (P0 → P3 and P3 → P0): an
 * assignee deserves to know their work was de-prioritized just as
 * much as escalated. The editor isn't notified about their own
 * edits.
 *
 * Surfaced by the 2026-05-15 task-lifecycle audit — title /
 * description / status edits remain silent (low-signal); priority
 * + due-date are time-sensitive enough that radio silence is the
 * wrong default.
 */
export async function notifyTaskPriorityChanged(args: {
  taskId: string;
  projectId: string;
  taskTitle: string;
  projectName: string;
  assigneeId: string;
  editorId: string;
  fromPriority: string;
  toPriority: string;
}) {
  if (args.assigneeId === args.editorId) return;
  await createNotification({
    userId: args.assigneeId,
    type: 'task_priority_changed',
    title: `Priority changed: ${args.fromPriority} → ${args.toPriority}`,
    body: `"${args.taskTitle}" in ${args.projectName}`,
    link: `/projects/${args.projectId}/tasks/${args.taskId}`,
  });
}

/**
 * Fire when the due date of a task with a current assignee
 * changes — including being set for the first time or cleared.
 * The editor isn't notified.
 *
 * Surfaced by the 2026-05-15 task-lifecycle audit. The
 * notification body shows the new date so a recipient can
 * decide whether to surface in their stream or dismiss without
 * opening the task.
 */
export async function notifyTaskDueDateChanged(args: {
  taskId: string;
  projectId: string;
  taskTitle: string;
  projectName: string;
  assigneeId: string;
  editorId: string;
  /** ISO date YYYY-MM-DD or null when cleared. */
  newDueDate: string | null;
}) {
  if (args.assigneeId === args.editorId) return;
  const bodyTail = args.newDueDate ? ` is now due ${args.newDueDate}` : ` no longer has a due date`;
  await createNotification({
    userId: args.assigneeId,
    type: 'task_due_date_changed',
    title: 'Task deadline updated',
    body: `"${args.taskTitle}" in ${args.projectName}${bodyTail}`,
    link: `/projects/${args.projectId}/tasks/${args.taskId}`,
  });
}

/**
 * Fire when a user is added to a project as a member.
 *
 * Pre-2026-05-15 the user only discovered the addition by refreshing
 * their dashboard — silent surface change. Notify them so they
 * understand WHY new tasks/projects suddenly appeared.
 */
export async function notifyAddedToProject(args: {
  userId: string;
  projectId: string;
  projectName: string;
  addedByName: string;
  memberRole: string;
}) {
  await createNotification({
    userId: args.userId,
    type: 'project_member_added',
    title: `${args.addedByName} added you to ${args.projectName}`,
    body: `Your role on this project: ${args.memberRole}`,
    link: `/projects/${args.projectId}`,
  });
}

/**
 * Fire when a user is removed from a project.
 *
 * Pre-2026-05-15 the user discovered this via a 403 the next time
 * they tried to open the project. Hostile UX — notify so they
 * understand the change rather than thinking the platform broke.
 *
 * Note: the project board link works for removed users until the
 * read endpoint actually rejects them; that's intentional. If
 * they tap the link they get a "no longer a member" error rather
 * than 404, which is the correct affordance.
 */
export async function notifyRemovedFromProject(args: {
  userId: string;
  projectId: string;
  projectName: string;
  removedByName: string;
}) {
  await createNotification({
    userId: args.userId,
    type: 'project_member_removed',
    title: `You were removed from ${args.projectName}`,
    body: `${args.removedByName} removed you from this project`,
    // The notification list itself, not the project — they can't
    // get back into the project, so deep-linking would just 403.
    link: '/notifications',
  });
}

/**
 * Fire when tasks are orphaned by a member leaving (assigneeId
 * and/or reviewerId nulled). Notifies the project's PMs + project-
 * level ADMINs so somebody picks up the re-assignment before the
 * tasks rot. Counts both sides separately because the recovery
 * action differs:
 *
 *   • unassignedCount → PM needs to pick a new owner
 *   • unreviewerCount → PM needs to pick a new reviewer (or the
 *     original assignee re-requests review from someone else)
 *
 * Skipped silently when both counts are zero. Skipped silently
 * when the project has no PM/ADMIN members (no audience). Doesn't
 * fan out to SUPER_ADMINs globally — that's the same noise-volume
 * concern as `notifyTaskBlocked` and the project's own staff
 * are the right audience here.
 */
export async function notifyProjectPMsOfOrphanedTasks(args: {
  projectId: string;
  projectName: string;
  leavingUserName: string;
  unassignedCount: number;
  unreviewerCount: number;
}) {
  if (args.unassignedCount === 0 && args.unreviewerCount === 0) return;

  const pms = await prisma.projectMember.findMany({
    where: {
      projectId: args.projectId,
      role: { in: ['ADMIN', 'PRODUCT_MANAGER'] },
    },
    select: { userId: true },
  });
  if (pms.length === 0) return;

  // Build a body that surfaces both orphan flavors when both apply.
  // Grammar: singular subject takes "needs", plural takes "need" —
  // "1 task needs a new assignee" vs "3 tasks need a new assignee".
  const parts: string[] = [];
  if (args.unassignedCount > 0) {
    const noun = args.unassignedCount === 1 ? 'task needs' : 'tasks need';
    parts.push(`${args.unassignedCount} ${noun} a new assignee`);
  }
  if (args.unreviewerCount > 0) {
    const noun = args.unreviewerCount === 1 ? 'task needs' : 'tasks need';
    parts.push(`${args.unreviewerCount} ${noun} a new reviewer`);
  }
  const body = `${args.leavingUserName} left ${args.projectName}: ${parts.join(' · ')}`;

  await createBulkNotifications(
    pms.map((m) => ({
      userId: m.userId,
      type: 'tasks_orphaned',
      title: 'Tasks need re-assignment',
      body,
      link: `/projects/${args.projectId}`,
    })),
  );
}

/**
 * Fire when a user's per-project role changes (e.g. ENGINEER → PM
 * within Project A). The base user.role on the User row controls
 * what permissions they have globally; the per-project role
 * controls what they can do in THIS project. The two are commonly
 * confused, so the notification body spells out which scope just
 * changed.
 */
export async function notifyProjectRoleChanged(args: {
  userId: string;
  projectId: string;
  projectName: string;
  changedByName: string;
  fromRole: string;
  toRole: string;
}) {
  await createNotification({
    userId: args.userId,
    type: 'project_role_changed',
    title: `Your role on ${args.projectName} changed`,
    body: `${args.changedByName} changed your project role: ${args.fromRole} → ${args.toRole}`,
    link: `/projects/${args.projectId}`,
  });
}

/**
 * Fire when a sprint transitions PLANNING → ACTIVE. Notifies every
 * project member so the team knows the sprint is now in flight (the
 * "what should I be working on?" signal). The starter is excluded
 * from their own ping.
 *
 * Surfaced by the 2026-05-15 sprint-lifecycle audit — sprint start
 * was a silent surface change, so engineers refreshed their boards
 * trying to figure out which sprint was active.
 */
export async function notifySprintStarted(args: {
  sprintId: string;
  projectId: string;
  sprintName: string;
  projectName: string;
  startedBy: string;
  startedByName: string;
}) {
  const members = await prisma.projectMember.findMany({
    where: { projectId: args.projectId },
    select: { userId: true },
  });
  const recipients = members
    .map((m) => m.userId)
    .filter((id) => id !== args.startedBy);
  if (recipients.length === 0) return;

  await createBulkNotifications(
    recipients.map((userId) => ({
      userId,
      type: 'sprint_started',
      title: `${args.sprintName} is now active`,
      body: `${args.startedByName} started ${args.sprintName} in ${args.projectName}`,
      link: `/projects/${args.projectId}`,
    })),
  );
}

/**
 * Fire when a sprint transitions ACTIVE → COMPLETED. Notifies every
 * project member so they see the close-out + retro stats; the
 * completer is excluded from their own ping.
 *
 * Body surfaces the headline stats inline so the recipient gets
 * value without opening the project — "Sprint 4 closed: 23 of 30
 * points landed, 4 carried over."
 */
export async function notifySprintCompleted(args: {
  sprintId: string;
  projectId: string;
  sprintName: string;
  projectName: string;
  completedBy: string;
  completedByName: string;
  completedPoints: number;
  totalPoints: number;
  carriedOver: number;
}) {
  const members = await prisma.projectMember.findMany({
    where: { projectId: args.projectId },
    select: { userId: true },
  });
  const recipients = members
    .map((m) => m.userId)
    .filter((id) => id !== args.completedBy);
  if (recipients.length === 0) return;

  // Use a compact "X of Y points" string so the body fits in the
  // notification list preview. Carry-over count is omitted when zero
  // (no clutter on a clean close-out).
  const pointsLine = `${args.completedPoints} of ${args.totalPoints} points landed`;
  const carryLine = args.carriedOver > 0 ? ` · ${args.carriedOver} carried over` : '';
  await createBulkNotifications(
    recipients.map((userId) => ({
      userId,
      type: 'sprint_completed',
      title: `${args.sprintName} closed`,
      body: `${pointsLine}${carryLine} (${args.projectName})`,
      link: `/projects/${args.projectId}`,
    })),
  );
}

/**
 * Fire when a task carries over from one sprint to another (or to
 * the backlog) as part of a sprint close-out. Notifies the task's
 * assignee — "your task moved from Sprint 4 to Sprint 5" — so they
 * don't lose track of what they're owning next.
 *
 * Designed to be called from inside `completeSprint` for each
 * carried-over task whose assignee isn't the completer.
 */
export async function notifyTaskCarriedOver(args: {
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string;
  assigneeId: string;
  completedBy: string;
  fromSprintName: string;
  toSprintName: string | null; // null = moved to backlog
}) {
  if (args.assigneeId === args.completedBy) return; // self-skip
  const destination = args.toSprintName ?? 'the backlog';
  await createNotification({
    userId: args.assigneeId,
    type: 'task_carried_over',
    title: 'Your task carried over',
    body: `"${args.taskTitle}" moved from ${args.fromSprintName} to ${destination} (${args.projectName})`,
    link: `/projects/${args.projectId}/tasks/${args.taskId}`,
  });
}

/**
 * Fire when a project is deleted. Fan-out to every member who had
 * access so they don't discover the loss via a 404 on their next
 * visit. The deleter is excluded from the recipient set.
 *
 * Pre-2026-05-15 the project-delete path was completely silent for
 * project members. The audit log captured the event but members
 * had no signal — they'd open the project tomorrow and hit 404.
 *
 * Notification link points at the user's dashboard (not the
 * deleted project) — same reasoning as `notifyRemovedFromProject`.
 */
export async function notifyProjectDeleted(args: {
  projectName: string;
  deletedBy: string;
  deletedByName: string;
  memberIds: string[];
}) {
  const recipients = args.memberIds.filter((id) => id !== args.deletedBy);
  if (recipients.length === 0) return;

  await createBulkNotifications(
    recipients.map((userId) => ({
      userId,
      type: 'project_deleted',
      title: `${args.projectName} was deleted`,
      body: `${args.deletedByName} deleted ${args.projectName}. Any tasks, comments, and time entries on it have been removed.`,
      // Dashboard — the project's gone, deep-linking would 404.
      link: '/',
    })),
  );
}

/**
 * Fire when a milestone transitions to COMPLETED. Notifies every
 * project member except the user who flipped the status. Same
 * shape as `notifySprintCompleted` from PR #123 — major team
 * milestone events shouldn't be silent.
 */
export async function notifyMilestoneCompleted(args: {
  milestoneId: string;
  projectId: string;
  milestoneTitle: string;
  projectName: string;
  completedBy: string;
  completedByName: string;
}) {
  const members = await prisma.projectMember.findMany({
    where: { projectId: args.projectId },
    select: { userId: true },
  });
  const recipients = members
    .map((m) => m.userId)
    .filter((id) => id !== args.completedBy);
  if (recipients.length === 0) return;

  await createBulkNotifications(
    recipients.map((userId) => ({
      userId,
      type: 'milestone_completed',
      title: `Milestone reached: ${args.milestoneTitle}`,
      body: `${args.completedByName} marked "${args.milestoneTitle}" complete in ${args.projectName}`,
      link: `/projects/${args.projectId}`,
    })),
  );
}

/**
 * Fire when a milestone is deleted. Tasks that pointed at it get
 * their `milestoneId` set to null via the schema's onDelete:SetNull,
 * so members may notice tasks suddenly missing a milestone tag
 * with no signal as to why. Pinging them closes the loop.
 *
 * Comments attached to the milestone get cascade-deleted (FK is
 * onDelete:Cascade), so any planning discussion on that milestone
 * is gone too — worth a heads-up in the notification body.
 */
export async function notifyMilestoneDeleted(args: {
  projectId: string;
  milestoneTitle: string;
  projectName: string;
  deletedBy: string;
  deletedByName: string;
  affectedTaskCount: number;
}) {
  const members = await prisma.projectMember.findMany({
    where: { projectId: args.projectId },
    select: { userId: true },
  });
  const recipients = members
    .map((m) => m.userId)
    .filter((id) => id !== args.deletedBy);
  if (recipients.length === 0) return;

  // Surface the affected-task count when non-zero so members
  // understand "those tasks have lost their milestone tag" rather
  // than thinking the tasks themselves were also deleted.
  const taskNote = args.affectedTaskCount > 0
    ? `. ${args.affectedTaskCount} ${args.affectedTaskCount === 1 ? 'task is' : 'tasks are'} now unmilestoned.`
    : '';

  await createBulkNotifications(
    recipients.map((userId) => ({
      userId,
      type: 'milestone_deleted',
      title: `Milestone removed: ${args.milestoneTitle}`,
      body: `${args.deletedByName} deleted "${args.milestoneTitle}" in ${args.projectName}${taskNote}`,
      link: `/projects/${args.projectId}`,
    })),
  );
}

/**
 * Fire when a new comment is posted on a task — fans out to every
 * subscriber EXCEPT the comment author and EXCEPT users already
 * notified by the @-mention path (deduped via the
 * `excludeUserIds` set the caller passes in).
 *
 * Recipients receive a clear "<author> commented on '<task title>'"
 * with a link to the task. Body inlines the first 100 chars of the
 * comment as a preview so the recipient can decide whether to open
 * without leaving the notifications panel.
 */
export async function notifyTaskSubscribersOfComment(args: {
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string;
  authorId: string;
  authorName: string;
  commentSnippet: string;
  subscriberIds: string[];
}) {
  // Defense: filter out the author one more time in case caller
  // didn't (the dedupe is the caller's job but redundancy is cheap).
  const recipients = args.subscriberIds.filter((id) => id !== args.authorId);
  if (recipients.length === 0) return;

  await createBulkNotifications(
    recipients.map((userId) => ({
      userId,
      type: 'task_comment_subscriber',
      title: `${args.authorName} commented on "${args.taskTitle}"`,
      body: `In ${args.projectName}: "${args.commentSnippet}"`,
      link: `/projects/${args.projectId}/tasks/${args.taskId}`,
    })),
  );
}

/**
 * Fire when an engineer posts a story-update comment on a task (Ask 1,
 * 2026-06). The audience is the project's CLIENT members — the update
 * exists precisely so the client sees progress without digging through
 * the thread. The link points at the client portal task view; the bell
 * we added to the portal carries the unread badge.
 *
 * Visibility honours the same gate as the client board: a client with
 * `ProjectMember.fullAccess` sees every task, so they're always
 * notified; a restricted client is only notified when the task is
 * `clientVisible` (otherwise the deep link would 403). The author is
 * filtered out — if a client somehow authored the update they don't
 * notify themselves.
 */
export async function notifyClientsOfStoryUpdate(args: {
  taskId: string;
  taskTitle: string;
  projectId: string;
  authorId: string;
  progress: number;
  nextStep?: string;
}) {
  const task = await prisma.task.findUnique({
    where: { id: args.taskId },
    select: { clientVisible: true },
  });
  if (!task) return;

  const clientMembers = await prisma.projectMember.findMany({
    where: { projectId: args.projectId, user: { role: 'CLIENT' } },
    select: { userId: true, fullAccess: true },
  });

  const recipients = clientMembers
    .filter((m) => (task.clientVisible || m.fullAccess) && m.userId !== args.authorId)
    .map((m) => m.userId);
  if (recipients.length === 0) return;

  const nextStep = args.nextStep?.trim();
  await createBulkNotifications(
    recipients.map((userId) => ({
      userId,
      type: 'story_update',
      title: `Progress update: ${args.taskTitle}`,
      body: nextStep ? `Now ${args.progress}% — next: ${nextStep}` : `Now ${args.progress}% complete`,
      link: `/client/projects/${args.projectId}/tasks/${args.taskId}`,
    })),
  );
}

/**
 * Fire when a task is edited (significant fields only — title,
 * description, priority, due-date, status). Fans out to subscribers
 * minus the actor and minus anyone already notified by a more-
 * specific helper (e.g. assignee was already pinged via
 * `notifyTaskPriorityChanged`).
 *
 * The body lists which fields changed so the recipient can decide
 * whether the change matters to them.
 */
export async function notifyTaskSubscribersOfEdit(args: {
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string;
  editorId: string;
  editorName: string;
  /** Human-readable list of changed fields ("title", "due date", "priority"). */
  changedFields: string[];
  subscriberIds: string[];
}) {
  if (args.changedFields.length === 0) return;
  const recipients = args.subscriberIds.filter((id) => id !== args.editorId);
  if (recipients.length === 0) return;

  const fieldList = args.changedFields.join(', ');
  await createBulkNotifications(
    recipients.map((userId) => ({
      userId,
      type: 'task_edit_subscriber',
      title: `${args.editorName} edited "${args.taskTitle}"`,
      body: `Changed: ${fieldList} (in ${args.projectName})`,
      link: `/projects/${args.projectId}/tasks/${args.taskId}`,
    })),
  );
}

/**
 * Fire when a user nudges a task. Single recipient — the task's
 * current assignee. If the task has no assignee, nothing fires
 * (caller checks first; this is defense-in-depth).
 *
 * Optional message from the nudger inlines directly into the body.
 * "John nudged you about 'Wire SSO': can we have an ETA?"
 */
export async function notifyTaskNudge(args: {
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string;
  nudgedUserId: string;
  nudgerName: string;
  message: string | null;
}) {
  const bodyTail = args.message ? `: "${args.message}"` : '';
  await createNotification({
    userId: args.nudgedUserId,
    type: 'task_nudge',
    title: `${args.nudgerName} nudged you about "${args.taskTitle}"`,
    body: `In ${args.projectName}${bodyTail}`,
    link: `/projects/${args.projectId}/tasks/${args.taskId}`,
  });
}

/**
 * Fire when a user marks a task DONE. Positive-reinforcement
 * notification — single recipient (the completer themselves).
 *
 * Streak-aware: if the user has closed ≥ 3 tasks today, swap the
 * plain "Nice work" body for a celebratory streak message. Streak
 * counting is the caller's responsibility (passed in as
 * `tasksCompletedToday`) so this helper stays pure.
 */
export async function notifyTaskCompletionEncouragement(args: {
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string;
  completerId: string;
  tasksCompletedToday: number;
}) {
  const isStreak = args.tasksCompletedToday >= 3;
  const title = isStreak
    ? `🎉 ${args.tasksCompletedToday} tasks done today — you're on fire`
    : `Nice work — "${args.taskTitle}" is done`;
  const body = isStreak
    ? `Latest: "${args.taskTitle}" in ${args.projectName}. Keep going.`
    : `Closed in ${args.projectName}. One more off the board.`;
  await createNotification({
    userId: args.completerId,
    type: 'task_completion_encouragement',
    title,
    body,
    link: `/projects/${args.projectId}/tasks/${args.taskId}`,
  });
}

export async function notifyMilestoneDue(milestoneId: string, projectId: string, title: string, projectName: string) {
  const members = await prisma.projectMember.findMany({
    where: { projectId },
    select: { userId: true },
  });
  const inputs = members.map((m) => ({
    userId: m.userId,
    type: 'milestone_due',
    title: 'Milestone approaching',
    body: `"${title}" in ${projectName} is due soon`,
    link: `/projects/${projectId}`,
  }));
  await createBulkNotifications(inputs);
}
