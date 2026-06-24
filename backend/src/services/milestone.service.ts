import { MilestoneStatus, TaskStatus, UserRole } from '@prisma/client';
import prisma from '../config/database';
import { NotFoundError, ValidationError, ConflictError } from '../utils/errors';
import { logActivity } from './activity.service';
import { canViewProjectInternal } from './rbac.service';
import {
  notifyMilestoneCompleted,
  notifyMilestoneDeleted,
} from './notification.service';
import { logger } from '../lib/logger';

/**
 * Legal milestone status transitions. Same shape as the sprint
 * lifecycle audit (#123) which closed the bug where COMPLETED
 * sprints could be re-activated, corrupting history.
 *
 *   UPCOMING → COMPLETED   ✓ Hit the milestone on time.
 *   UPCOMING → MISSED      ✓ Manually marked missed (eventually a cron).
 *   COMPLETED → UPCOMING   ✓ Reopen — team decides the milestone
 *                            wasn't really hit. Allowed.
 *   COMPLETED → MISSED     ❌ Refuse. A milestone that already landed
 *                            CANNOT retroactively become "missed" —
 *                            that's history rewriting.
 *   MISSED → COMPLETED     ✓ Late delivery — correct the history.
 *   MISSED → UPCOMING      ✓ Reopen from miss.
 *
 * Validation only runs on actual transitions; no-op same-status
 * saves flow through without an activity row.
 */
function assertLegalMilestoneTransition(from: MilestoneStatus, to: MilestoneStatus): void {
  if (from === MilestoneStatus.COMPLETED && to === MilestoneStatus.MISSED) {
    throw new ValidationError(
      'Cannot mark a completed milestone as missed. Reopen it first if you need to revert it.',
    );
  }
}

/**
 * Roll-up of task progress for a single milestone. Computed in-memory
 * from the nested `tasks` include — for MVP this is fine (a milestone
 * typically holds 10-30 tasks). If milestones ever grow to hundreds of
 * tasks each, switch to a `groupBy` + separate `aggregate` query.
 */
function rollupProgress(tasks: Array<{ storyPoints: number | null; status: TaskStatus }>) {
  const totalTasks = tasks.length;
  const doneTasks = tasks.filter((t) => t.status === TaskStatus.DONE).length;
  const totalPoints = tasks.reduce((n, t) => n + (t.storyPoints ?? 0), 0);
  const donePoints = tasks
    .filter((t) => t.status === TaskStatus.DONE)
    .reduce((n, t) => n + (t.storyPoints ?? 0), 0);
  // Prefer story-point completion (the planning unit) when there's any
  // scored work; fall back to task-count completion otherwise.
  const completionPct =
    totalPoints > 0
      ? Math.round((donePoints / totalPoints) * 100)
      : totalTasks > 0
        ? Math.round((doneTasks / totalTasks) * 100)
        : 0;
  return { totalTasks, doneTasks, totalPoints, donePoints, completionPct };
}

export async function listMilestones(
  projectId: string,
  viewer: { id?: string; role: UserRole },
) {
  const where: any = { projectId };
  // Visibility gate: only viewers who can see this project's internal work get
  // non-client-visible milestones. Uses the PER-PROJECT check so a CLIENT member
  // granted full access (ProjectMember.fullAccess) sees internal milestones for
  // THIS project — matching how listTasks gates the backlog. (Was a role-level
  // checkPermission that silently ignored the per-project grant: the same wiring
  // that landed for tasks/decisions but was missed for milestones.)
  const canViewInternal = await canViewProjectInternal(viewer, projectId);
  if (!canViewInternal) where.clientVisible = true;

  // Pull tasks alongside so we can compute the per-milestone progress
  // rollup. For clients, filter the embedded tasks to clientVisible
  // only — we don't want internal task counts inflating the
  // client-facing progress bar.
  const rows = await prisma.milestone.findMany({
    where,
    orderBy: { date: 'asc' },
    include: {
      tasks: {
        where: canViewInternal ? undefined : { clientVisible: true },
        select: { storyPoints: true, status: true },
      },
    },
  });

  // Strip the nested tasks before returning. Callers only need the
  // rollup numbers; the raw task list is a payload-bloat + leak risk.
  return rows.map((m) => {
    const { tasks, ...rest } = m;
    return { ...rest, progress: rollupProgress(tasks) };
  });
}

export async function createMilestone(projectId: string, data: any, userId: string) {
  const milestone = await prisma.milestone.create({
    data: { ...data, projectId, date: new Date(data.date) },
  });

  await logActivity({
    userId, projectId, action: 'created_milestone',
    targetType: 'milestone', targetId: milestone.id,
    details: { title: milestone.title },
  });

  return milestone;
}

export async function updateMilestone(
  milestoneId: string,
  data: any,
  userId: string,
  // 2026-05-21 optimistic-locking expansion (matches Task pattern from
  // PR #128). When the caller has the milestone's last-known updatedAt,
  // pass it here as an ISO string. The service refuses the write if
  // the server's updatedAt no longer matches — i.e. someone else's
  // edit landed between read and write, and a silent overwrite would
  // lose their data. OPT-IN: callers that don't pass this preserve
  // last-write-wins (backwards compat).
  expectedUpdatedAt?: string,
) {
  const existing = await prisma.milestone.findUnique({ where: { id: milestoneId } });
  if (!existing) throw new NotFoundError('Milestone');

  // Early conflict detection — cheap, fail-fast before we run the
  // status-transition + write logic only to reject at the end.
  if (expectedUpdatedAt && existing.updatedAt.toISOString() !== expectedUpdatedAt) {
    throw new ConflictError(
      `This milestone was edited by someone else. Refresh and reapply your changes. (server updatedAt: ${existing.updatedAt.toISOString()})`,
    );
  }

  // 2026-05-15 milestone-lifecycle audit (Bug A — status integrity):
  // validate the transition BEFORE writing. Pre-fix this code blindly
  // applied `data.status` to the row, so a PM could mark a
  // COMPLETED milestone as MISSED retroactively (history rewriting).
  // Same shape as the sprint restart-completed bug fixed in #123.
  const isStatusChange = data.status && data.status !== existing.status;
  if (isStatusChange) {
    assertLegalMilestoneTransition(existing.status, data.status);
  }

  const updateData: any = { ...data };
  if (data.date) updateData.date = new Date(data.date);

  // ── The actual write ────────────────────────────────────────────
  // Two paths (matches the Task service):
  //   1. expectedUpdatedAt provided → updateMany with a compound
  //      where clause so a race between our early check and this
  //      write surfaces as a 409 (count===0).
  //   2. Not provided → plain update, last-write-wins.
  let milestone;
  if (expectedUpdatedAt) {
    const result = await prisma.milestone.updateMany({
      where: { id: milestoneId, updatedAt: existing.updatedAt },
      data: updateData,
    });
    if (result.count === 0) {
      const current = await prisma.milestone.findUnique({
        where: { id: milestoneId },
        select: { updatedAt: true },
      });
      throw new ConflictError(
        `This milestone was edited by someone else. Refresh and reapply your changes. (server updatedAt: ${current?.updatedAt.toISOString() ?? 'unknown'})`,
      );
    }
    const fresh = await prisma.milestone.findUnique({ where: { id: milestoneId } });
    if (!fresh) throw new NotFoundError('Milestone');
    milestone = fresh;
  } else {
    milestone = await prisma.milestone.update({ where: { id: milestoneId }, data: updateData });
  }

  if (isStatusChange) {
    // More precise action labels than the pre-fix shape (which
    // collapsed everything-not-COMPLETED into `updated_milestone`).
    // Lets the activity feed distinguish "completed late" from
    // "reopened" from "marked missed" — all distinct lifecycle
    // events with different downstream meaning.
    //
    // The three branches below are exhaustive over the
    // MilestoneStatus enum because we've already excluded the
    // same-status case above (isStatusChange === true). When
    // data.status is UPCOMING, the existing status MUST be
    // COMPLETED or MISSED (it can't be UPCOMING — that'd be
    // a no-op we already filtered), so reopened_milestone is
    // always the correct label there.
    let action: string;
    if (data.status === MilestoneStatus.COMPLETED) {
      action = 'completed_milestone';
    } else if (data.status === MilestoneStatus.MISSED) {
      action = 'missed_milestone';
    } else {
      action = 'reopened_milestone';
    }

    await logActivity({
      userId, projectId: existing.projectId,
      action,
      targetType: 'milestone', targetId: milestoneId,
      details: { title: milestone.title, from: existing.status, to: data.status },
    });
  }

  // ── Notify project members on completion (Bug B) ─────────────────
  //
  // Milestone completion is a major team event. Pre-fix it was
  // silent except for the activity row, so nobody felt the close-out
  // unless they happened to be scrolling the activity feed.
  // Fire-and-forget AFTER the update commits — a notification
  // failure can't undo a legitimate milestone close.
  if (isStatusChange && data.status === MilestoneStatus.COMPLETED) {
    const [project, completer] = await Promise.all([
      prisma.project.findUnique({ where: { id: existing.projectId }, select: { name: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    ]);
    notifyMilestoneCompleted({
      milestoneId,
      projectId: existing.projectId,
      milestoneTitle: milestone.title,
      projectName: project?.name ?? 'a project',
      completedBy: userId,
      completedByName: completer?.name ?? 'A teammate',
    }).catch((err) => logger.warn({ err: err?.message }, '[notify] notifyMilestoneCompleted failed:'));
  }

  return milestone;
}

export async function deleteMilestone(milestoneId: string, userId: string) {
  const milestone = await prisma.milestone.findUnique({ where: { id: milestoneId } });
  if (!milestone) throw new NotFoundError('Milestone');

  // 2026-05-15 milestone-lifecycle audit: capture the affected-task
  // count BEFORE the delete fires. Task.milestoneId has
  // onDelete:SetNull so the tasks survive (lose their milestone
  // tag), but members may be confused by tasks suddenly missing a
  // milestone label with no signal. The count surfaces in both the
  // audit log row + the notification body.
  const affectedTaskCount = await prisma.task.count({
    where: { milestoneId },
  });

  await prisma.milestone.delete({ where: { id: milestoneId } });

  await logActivity({
    userId, projectId: milestone.projectId, action: 'deleted_milestone',
    targetType: 'milestone', targetId: milestoneId,
    details: { title: milestone.title, affectedTaskCount },
  });

  // ── Notify project members (Bug C) ──────────────────────────────
  //
  // Pre-fix milestone deletion was silent for members — they'd see
  // their tasks lose a milestone tag with no clue why. Same shape
  // as the task delete + project delete fixes from #120/#126.
  // Fire-and-forget after the delete commits; deleter excluded.
  const [project, deleter] = await Promise.all([
    prisma.project.findUnique({ where: { id: milestone.projectId }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
  ]);
  notifyMilestoneDeleted({
    projectId: milestone.projectId,
    milestoneTitle: milestone.title,
    projectName: project?.name ?? 'a project',
    deletedBy: userId,
    deletedByName: deleter?.name ?? 'A teammate',
    affectedTaskCount,
  }).catch((err) => logger.warn({ err: err?.message }, '[notify] notifyMilestoneDeleted failed:'));
}
