import { Prisma, SprintStatus, TaskStatus, UserRole } from '@prisma/client';
import prisma from '../config/database';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { logActivity } from './activity.service';
import { checkPermission, canViewProjectInternal } from './rbac.service';
import {
  notifySprintStarted,
  notifySprintCompleted,
  notifyTaskCarriedOver,
} from './notification.service';
import { logger } from '../lib/logger';

export async function createSprint(projectId: string, data: { name: string; goal?: string; startDate: string; endDate: string }) {
  // Auto-increment sprint number per project
  const maxNumber = await prisma.sprint.aggregate({
    where: { projectId },
    _max: { number: true },
  });
  const nextNumber = (maxNumber._max.number || 0) + 1;

  return prisma.sprint.create({
    data: {
      projectId,
      name: data.name || `Sprint ${nextNumber}`,
      number: nextNumber,
      goal: data.goal || null,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
    },
    include: { _count: { select: { tasks: true } } },
  });
}

export async function getProjectSprints(
  projectId: string,
  viewer: { id?: string; role: UserRole },
) {
  // Per-project visibility: a regular client must not have internal
  // (clientVisible=false) tasks inflating the sprint progress counts. Staff
  // (role grant) and CLIENT members granted ProjectMember.fullAccess see the
  // full task set — same gate as listTasks / milestones / current-sprint.
  const canViewInternal = await canViewProjectInternal(viewer, projectId);
  const taskWhere = canViewInternal ? undefined : { clientVisible: true };

  const sprints = await prisma.sprint.findMany({
    where: { projectId },
    orderBy: { number: 'desc' },
    include: {
      tasks: {
        where: taskWhere,
        // Pull createdAt so we can compute scope-creep client-side without
        // a second round-trip per sprint.
        select: { status: true, storyPoints: true, createdAt: true },
      },
    },
  });

  return sprints.map((s) => {
    const totalTasks = s.tasks.length;
    const doneTasks = s.tasks.filter((t) => t.status === 'DONE').length;
    const totalPoints = s.tasks.reduce((sum, t) => sum + (t.storyPoints || 0), 0);
    const donePoints = s.tasks.filter((t) => t.status === 'DONE').reduce((sum, t) => sum + (t.storyPoints || 0), 0);
    // Scope creep: tasks added after the sprint started (best-effort proxy:
    // task.createdAt > sprint.startDate; doesn't catch tasks reassigned from
    // another sprint mid-flight, but covers the common case).
    const startMs = new Date(s.startDate).getTime();
    const addedAfterStart = s.tasks.filter((t) => t.createdAt.getTime() > startMs);
    const scopeCreepTasks = addedAfterStart.length;
    const scopeCreepPoints = addedAfterStart.reduce((sum, t) => sum + (t.storyPoints || 0), 0);
    const { tasks, ...sprint } = s;
    // _count mirrors the gated task total so a regular client can't read the
    // internal task count off the rollup either.
    return {
      ...sprint,
      _count: { tasks: totalTasks },
      totalTasks,
      doneTasks,
      totalPoints,
      donePoints,
      scopeCreepTasks,
      scopeCreepPoints,
    };
  });
}

export async function getSprintDetail(sprintId: string) {
  const sprint = await prisma.sprint.findUnique({
    where: { id: sprintId },
    include: {
      project: { select: { id: true, name: true, slug: true } },
      tasks: {
        include: {
          assignee: { select: { id: true, name: true } },
          epic: { select: { id: true, title: true, color: true } },
          project: { select: { id: true, name: true, slug: true } },
        },
        orderBy: [{ status: 'asc' }, { priority: 'asc' }, { sortOrder: 'asc' }],
      },
    },
  });
  return sprint;
}

export async function getActiveSprint(projectId: string) {
  return prisma.sprint.findFirst({
    where: { projectId, status: 'ACTIVE' },
    include: { _count: { select: { tasks: true } } },
  });
}

export async function updateSprint(
  sprintId: string,
  data: any,
  // 2026-05-21 optimistic-locking expansion (matches Task pattern from
  // PR #128). OPT-IN — when present, the service refuses the write if
  // someone else's edit landed since the caller's last read.
  expectedUpdatedAt?: string,
) {
  const updateData: any = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.goal !== undefined) updateData.goal = data.goal;
  if (data.startDate) updateData.startDate = new Date(data.startDate);
  if (data.endDate) updateData.endDate = new Date(data.endDate);
  if (data.retroNotes !== undefined) updateData.retroNotes = data.retroNotes;
  // NOTE: status changes MUST go through startSprint/completeSprint — not allowed via generic update

  // Optimistic-lock path — uses updateMany so a concurrent write is
  // detected at the DB level (count===0 means another transaction
  // beat us between fetch and write). For the legacy callers that
  // don't pass `expectedUpdatedAt`, fall through to the unguarded
  // update.
  if (expectedUpdatedAt) {
    const existing = await prisma.sprint.findUnique({
      where: { id: sprintId },
      select: { updatedAt: true },
    });
    if (!existing) throw new NotFoundError('Sprint');
    if (existing.updatedAt.toISOString() !== expectedUpdatedAt) {
      throw new ConflictError(
        `This sprint was edited by someone else. Refresh and reapply your changes. (server updatedAt: ${existing.updatedAt.toISOString()})`,
      );
    }
    const result = await prisma.sprint.updateMany({
      where: { id: sprintId, updatedAt: existing.updatedAt },
      data: updateData,
    });
    if (result.count === 0) {
      const current = await prisma.sprint.findUnique({
        where: { id: sprintId },
        select: { updatedAt: true },
      });
      throw new ConflictError(
        `This sprint was edited by someone else. Refresh and reapply your changes. (server updatedAt: ${current?.updatedAt.toISOString() ?? 'unknown'})`,
      );
    }
    const fresh = await prisma.sprint.findUnique({
      where: { id: sprintId },
      include: { _count: { select: { tasks: true } } },
    });
    if (!fresh) throw new NotFoundError('Sprint');
    return fresh;
  }

  return prisma.sprint.update({
    where: { id: sprintId },
    data: updateData,
    include: { _count: { select: { tasks: true } } },
  });
}

/**
 * Delete a sprint. Refuses if the sprint has ever held real activity —
 * specifically, if status is ACTIVE or COMPLETED. Round 2 follow-up R5:
 * previously there was no delete endpoint at all, so a typo'd PLANNED
 * sprint stayed forever in the dropdown until someone hand-edited the DB.
 *
 *   PLANNED   → deletable. Tasks (if any) get unparented to the backlog
 *               atomically; we DON'T delete the tasks themselves.
 *   ACTIVE    → refused. Use completeSprint with carryOver: 'all' first.
 *   COMPLETED → refused. Historical record — burnup/velocity charts depend
 *               on the row's continued existence. Use a separate "archive"
 *               flag if hiding from the picker is the goal.
 *   CANCELLED → deletable. Same handling as PLANNED.
 */
export async function deleteSprint(sprintId: string) {
  return prisma.$transaction(async (tx) => {
    const sprint = await tx.sprint.findUnique({
      where: { id: sprintId },
      select: { id: true, projectId: true, status: true, name: true, _count: { select: { tasks: true } } },
    });
    if (!sprint) throw new NotFoundError('Sprint');

    if (sprint.status === 'ACTIVE') {
      throw new ConflictError('Cannot delete an active sprint. Complete it first.');
    }
    if (sprint.status === 'COMPLETED') {
      throw new ConflictError('Cannot delete a completed sprint. Historical reports depend on it.');
    }

    // Move any task on the sprint back to backlog. The Task.sprintId FK uses
    // SetNull so this would happen on cascade anyway, but doing it
    // explicitly + collecting the count for the audit row is cheaper than
    // re-querying after the cascade.
    if (sprint._count.tasks > 0) {
      await tx.task.updateMany({
        where: { sprintId },
        data: { sprintId: null },
      });
    }

    await tx.sprint.delete({ where: { id: sprintId } });
    return { projectId: sprint.projectId, name: sprint.name, unparkedTasks: sprint._count.tasks };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function startSprint(sprintId: string, projectId: string, userId?: string) {
  // Race-safe activation. Previously the "no active sprint" check ran outside
  // a transaction — two concurrent startSprint calls in the same project
  // could both pass the check and both flip ACTIVE, breaking the invariant
  // every consumer of getActiveSprint relies on (QA finding #13).
  // Wrapping in $transaction with Serializable means the second call sees
  // the first's write and bails out cleanly.
  //
  // ── 2026-05-15 sprint-lifecycle audit (real bug) ──────────────────
  //
  // ALSO: validate the SOURCE sprint's status. Pre-audit, this code
  // only checked "no other sprint is active in this project" — it
  // never looked at what status the source sprint itself was in.
  // The result: a PM could click "Start" on a COMPLETED or CANCELLED
  // sprint and flip its status back to ACTIVE. That corrupted
  // historical velocity charts, burnup series, and retro stats —
  // the sprint was suddenly "active again" with leftover state from
  // its first life.
  //
  // Only `PLANNING → ACTIVE` is legal. `ACTIVE → ACTIVE` is idempotent
  // (just returns the sprint). Everything else throws ConflictError
  // with a message that tells the user how to proceed.
  return prisma.$transaction(async (tx) => {
    const source = await tx.sprint.findUnique({
      where: { id: sprintId },
      select: { id: true, status: true, name: true, projectId: true },
    });
    if (!source) throw new NotFoundError('Sprint');
    // projectScopedResourceAccess middleware already verified the
    // caller has access to this sprint's project, BUT the URL also
    // carries a projectId on the start route — defense in depth,
    // refuse if they mismatch (e.g. forged URL).
    if (source.projectId !== projectId) {
      throw new ConflictError('Sprint does not belong to the supplied project.');
    }

    if (source.status === 'ACTIVE') {
      // Idempotent. Two clients double-clicking "Start" within the
      // same tick shouldn't see an error. Return the same shape as
      // the legal-transition path so the post-tx notify branch can
      // skip cleanly (already-active doesn't re-notify).
      const existing = await tx.sprint.findUnique({ where: { id: sprintId } });
      return { updated: existing!, sprintName: source.name, alreadyActive: true as const };
    }
    if (source.status === 'COMPLETED') {
      throw new ConflictError(
        'Cannot restart a completed sprint. Create a new sprint and copy any incomplete work into it.',
      );
    }
    if (source.status === 'CANCELLED') {
      throw new ConflictError(
        'Cannot start a cancelled sprint. Cancellation is terminal — create a new sprint instead.',
      );
    }
    // source.status === 'PLANNING' — the legal transition.

    const active = await tx.sprint.findFirst({
      where: { projectId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (active && active.id !== sprintId) {
      throw new ConflictError('Another sprint is already active. Complete it first.');
    }

    const updated = await tx.sprint.update({
      where: { id: sprintId },
      data: { status: 'ACTIVE' },
    });

    // Audit log — pre-2026-05-15 there was no `started_sprint` row,
    // an asymmetry with `completed_sprint` that left a hole in the
    // project's activity stream right where the start event belonged.
    // The handler now passes userId; older callers that don't are
    // tolerated (audit skipped, behavior matches pre-fix).
    if (userId) {
      await logActivity({
        userId,
        projectId,
        action: 'started_sprint',
        targetType: 'sprint',
        targetId: sprintId,
        details: { name: source.name },
      }, tx);
    }

    return { updated, sprintName: source.name, alreadyActive: false as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).then(async ({ updated, sprintName, alreadyActive }) => {
    // Notify project members AFTER the tx commits. Pulling project +
    // starter name in parallel keeps the post-commit latency minimal;
    // a notify failure is logged but doesn't fail the start (the
    // sprint already activated).
    //
    // Skip the notification fan-out on the idempotent already-active
    // path — re-clicking "Start" shouldn't re-notify the team.
    if (userId && !alreadyActive) {
      const [project, starter] = await Promise.all([
        prisma.project.findUnique({ where: { id: projectId }, select: { name: true } }),
        prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
      ]);
      notifySprintStarted({
        sprintId,
        projectId,
        sprintName,
        projectName: project?.name ?? 'a project',
        startedBy: userId,
        startedByName: starter?.name ?? 'A teammate',
      }).catch((err) => logger.warn({ err: err?.message }, '[notify] notifySprintStarted failed:'));
    }
    return updated;
  });
}

/**
 * Options for closing out a sprint:
 *   - retro:      free-text notes captured from the team retrospective
 *   - carryOver:  what to do with tasks that aren't yet DONE
 *       'all'      → move every incomplete task off the sprint (default; matches
 *                    legacy behavior where the field was a single boolean)
 *       'none'     → leave incomplete tasks attached to the completed sprint
 *                    so they show up as "didn't make it" historically
 *       'selected' → only move the IDs in `carryOverTaskIds`
 *   - carryOverToSprintId: optional target sprint to move them into instead of
 *       the backlog. Lets the team plan-ahead before closing.
 */
interface CompleteSprintOptions {
  retro?: { wentWell?: string; didntGoWell?: string; actionItems?: string };
  carryOver?: 'all' | 'none' | 'selected';
  carryOverTaskIds?: string[];
  carryOverToSprintId?: string | null;
}

export async function completeSprint(
  sprintId: string,
  options: CompleteSprintOptions = {},
  userId?: string,
) {
  const sprint = await prisma.sprint.findUnique({
    where: { id: sprintId },
    include: { tasks: { where: { status: { not: TaskStatus.DONE } }, select: { id: true, storyPoints: true } } },
  });
  if (!sprint) throw new NotFoundError('Sprint');
  if (sprint.status !== SprintStatus.ACTIVE) {
    throw new ValidationError('Only active sprints can be completed.');
  }

  // Resolve which incomplete tasks to carry over.
  const carryOverMode = options.carryOver ?? 'all';
  let carryOverIds: string[] = [];
  if (carryOverMode === 'all')      carryOverIds = sprint.tasks.map((t) => t.id);
  else if (carryOverMode === 'none') carryOverIds = [];
  else                               carryOverIds = (options.carryOverTaskIds ?? []).filter(
    (id) => sprint.tasks.some((t) => t.id === id),
  );

  // Validate target sprint (if any) belongs to the same project + is active or planning.
  if (options.carryOverToSprintId) {
    const target = await prisma.sprint.findUnique({
      where: { id: options.carryOverToSprintId },
      select: { id: true, projectId: true, status: true },
    });
    if (!target || target.projectId !== sprint.projectId) {
      throw new ValidationError('Target sprint must belong to the same project.');
    }
    if (target.status === SprintStatus.COMPLETED || target.status === SprintStatus.CANCELLED) {
      throw new ValidationError('Cannot carry over into a completed or cancelled sprint.');
    }
    if (target.id === sprintId) {
      throw new ValidationError('Cannot carry over into the sprint being completed.');
    }
  }

  const newSprintId = options.carryOverToSprintId ?? null; // null = backlog

  // Snapshot stats from the data BEFORE we mutate, so retro reflects the
  // sprint as it actually was when closed.
  const allTasksForStats = await prisma.task.findMany({
    where: { sprintId },
    select: { status: true, storyPoints: true },
  });
  const completedPoints = allTasksForStats
    .filter((t) => t.status === TaskStatus.DONE)
    .reduce((sum, t) => sum + (t.storyPoints ?? 0), 0);
  const totalPoints = allTasksForStats.reduce((sum, t) => sum + (t.storyPoints ?? 0), 0);
  const stats = {
    totalTasks: allTasksForStats.length,
    completedTasks: allTasksForStats.filter((t) => t.status === TaskStatus.DONE).length,
    carriedOver: carryOverIds.length,
    totalPoints,
    completedPoints,
  };

  // Pre-capture the carry-over task details for the post-commit
  // notifications. Need title + assignee for each carried task; we
  // can't read these inside the tx-then-notify path without an extra
  // round-trip, and we want one consistent snapshot. The full task
  // record (with assignee) is only needed when there are carry-overs.
  const carryOverTaskDetails = carryOverIds.length > 0
    ? await prisma.task.findMany({
        where: { id: { in: carryOverIds } },
        select: { id: true, title: true, assigneeId: true },
      })
    : [];

  // Lookup target-sprint name once so the carry-over notifications
  // can say "moved to Sprint 5" instead of just "moved off".
  const targetSprintName = options.carryOverToSprintId
    ? (await prisma.sprint.findUnique({
        where: { id: options.carryOverToSprintId },
        select: { name: true },
      }))?.name ?? null
    : null;

  const updated = await prisma.$transaction(async (tx) => {
    if (carryOverIds.length > 0) {
      await tx.task.updateMany({
        where: { id: { in: carryOverIds } },
        data: { sprintId: newSprintId },
      });
    }

    const result = await tx.sprint.update({
      where: { id: sprintId },
      data: {
        status: SprintStatus.COMPLETED,
        retroNotes: {
          stats,
          wentWell: options.retro?.wentWell ?? '',
          didntGoWell: options.retro?.didntGoWell ?? '',
          actionItems: options.retro?.actionItems ?? '',
          completedAt: new Date().toISOString(),
        },
      },
    });

    if (userId) {
      await logActivity({
        userId,
        projectId: sprint.projectId,
        action: 'completed_sprint',
        targetType: 'sprint',
        targetId: sprintId,
        details: {
          name: sprint.name,
          stats,
          carryOverMode,
          carryOverCount: carryOverIds.length,
          carryOverToSprintId: newSprintId,
        },
      }, tx);
    }

    return result;
  });

  // ── Post-commit notifications (2026-05-15 sprint-lifecycle audit) ─
  //
  // Two fan-outs, both fire-and-forget:
  //
  //   1. Sprint-completed → every project member except the
  //      completer. Body inlines the headline stats so recipients
  //      get value without opening the project.
  //   2. Task-carried-over → each carried task's assignee (except
  //      the completer themselves, to avoid self-spam if the PM
  //      who closed is also assigned to follow-up work).
  //
  // Skipped entirely when userId is missing — older callers (e.g.
  // background reconciliation jobs) shouldn't be wired into the
  // user-facing notification stream.
  if (userId) {
    const [project, completer] = await Promise.all([
      prisma.project.findUnique({ where: { id: sprint.projectId }, select: { name: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    ]);
    const projectName = project?.name ?? 'a project';

    notifySprintCompleted({
      sprintId,
      projectId: sprint.projectId,
      sprintName: sprint.name,
      projectName,
      completedBy: userId,
      completedByName: completer?.name ?? 'A teammate',
      completedPoints: stats.completedPoints,
      totalPoints: stats.totalPoints,
      carriedOver: stats.carriedOver,
    }).catch((err) => logger.warn({ err: err?.message }, '[notify] notifySprintCompleted failed:'));

    for (const t of carryOverTaskDetails) {
      if (!t.assigneeId) continue;
      notifyTaskCarriedOver({
        taskId: t.id,
        taskTitle: t.title,
        projectId: sprint.projectId,
        projectName,
        assigneeId: t.assigneeId,
        completedBy: userId,
        fromSprintName: sprint.name,
        toSprintName: targetSprintName,
      }).catch((err) => logger.warn({ err: err?.message }, '[notify] notifyTaskCarriedOver failed:'));
    }
  }

  return updated;
}

/**
 * Daily burnup series for a sprint. For each day from sprint.startDate to
 * min(today, sprint.endDate):
 *   - completedPoints = sum of points of tasks that transitioned to DONE
 *     on or before end-of-day (computed from TaskStatusHistory)
 *   - scopePoints     = total points of tasks currently in the sprint
 *     (approximation; we don't track sprintId history per task)
 *   - remainingPoints = scope - completed
 *   - idealRemaining  = linear ideal from initial scope to 0 across the
 *     full sprint duration
 */
export async function getSprintBurnup(sprintId: string) {
  const sprint = await prisma.sprint.findUnique({ where: { id: sprintId } });
  if (!sprint) throw new NotFoundError('Sprint');

  const tasks = await prisma.task.findMany({
    where: { sprintId },
    select: { id: true, storyPoints: true, status: true, createdAt: true },
  });
  const totalScope = tasks.reduce((s, t) => s + (t.storyPoints ?? 0), 0);

  // Fetch every "moved into DONE" history row for these tasks so we can
  // determine the "done" date for each (the first time it transitioned to
  // DONE — a task can be re-opened, but for burnup we use the first
  // completion to avoid spiky reversals).
  const taskIds = tasks.map((t) => t.id);
  const historyRows = taskIds.length
    ? await prisma.taskStatusHistory.findMany({
        where: { taskId: { in: taskIds }, toStatus: TaskStatus.DONE },
        orderBy: { changedAt: 'asc' },
        select: { taskId: true, changedAt: true },
      })
    : [];

  // First-completion timestamp per task. Falls back to task.updatedAt for
  // tasks already DONE without a history row (e.g. legacy seed data).
  const firstDoneAt = new Map<string, Date>();
  for (const row of historyRows) {
    if (!firstDoneAt.has(row.taskId)) firstDoneAt.set(row.taskId, row.changedAt);
  }

  const start = new Date(sprint.startDate); start.setHours(0, 0, 0, 0);
  const end   = new Date(sprint.endDate);   end.setHours(23, 59, 59, 999);
  const today = new Date();
  const lastDay = today < end ? today : end;
  // Bound the loop — sprints can run weeks but we cap at 60 days defensively.
  const totalDays = Math.min(60, Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86_400_000) + 1));
  const elapsedDays = Math.min(totalDays, Math.max(1, Math.ceil((lastDay.getTime() - start.getTime()) / 86_400_000) + 1));

  const series: Array<{
    date: string; completedPoints: number; remainingPoints: number;
    scopePoints: number; idealRemaining: number;
  }> = [];

  for (let i = 0; i < elapsedDays; i++) {
    const day = new Date(start); day.setDate(start.getDate() + i); day.setHours(23, 59, 59, 999);
    let completed = 0;
    for (const t of tasks) {
      const doneAt = firstDoneAt.get(t.id);
      if (doneAt && doneAt <= day) completed += t.storyPoints ?? 0;
    }
    const ideal = Math.max(0, Math.round((totalScope * (totalDays - 1 - i) / Math.max(1, totalDays - 1)) * 100) / 100);
    series.push({
      date: day.toISOString().slice(0, 10),
      completedPoints: completed,
      remainingPoints: Math.max(0, totalScope - completed),
      scopePoints: totalScope,
      idealRemaining: ideal,
    });
  }

  return {
    sprintId,
    sprintName: sprint.name,
    startDate: sprint.startDate,
    endDate: sprint.endDate,
    totalDays,
    totalScope,
    series,
  };
}

export async function getBacklog(projectId: string) {
  return prisma.task.findMany({
    where: { projectId, sprintId: null, status: { not: 'DONE' } },
    include: {
      assignee: { select: { id: true, name: true } },
      epic: { select: { id: true, title: true, color: true } },
      project: { select: { id: true, name: true, slug: true } },
    },
    orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
  });
}

export async function assignTaskToSprint(taskId: string, sprintId: string | null, userId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { projectId: true, sprintId: true, sprint: { select: { status: true } } },
  });
  if (!task) throw new NotFoundError('Task');

  // Bug fix: SUPER_ADMIN (and anyone else with `project.view_all`) is
  // intentionally NOT added as a member of every project, but they are
  // expected to be able to plan sprints across the studio. Previously this
  // check rejected them flat-out — same defensive-check-without-role-bypass
  // pattern as the project acknowledgment bug.
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user) throw new ValidationError('User no longer exists');
  const canViewAllProjects = await checkPermission(user.role, 'project.view_all');
  if (!canViewAllProjects) {
    const membership = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId, projectId: task.projectId } },
    });
    if (!membership) throw new ValidationError('Not a member of this project');
  }

  // Sprints in terminal states are immutable — reassigning tasks out of a
  // COMPLETED/CANCELLED sprint rewrites historical velocity/burnup, and
  // adding into one creates orphan history (QA finding #11).
  const isTerminal = (s?: SprintStatus | null) => s === 'COMPLETED' || s === 'CANCELLED';
  if (isTerminal(task.sprint?.status)) {
    throw new ValidationError('Cannot move a task out of a completed or cancelled sprint');
  }

  if (sprintId) {
    const sprint = await prisma.sprint.findUnique({ where: { id: sprintId }, select: { projectId: true, status: true } });
    if (!sprint) throw new NotFoundError('Sprint');
    if (sprint.projectId !== task.projectId) throw new ValidationError('Sprint and task must belong to the same project');
    if (isTerminal(sprint.status)) {
      throw new ValidationError('Cannot assign tasks to a completed or cancelled sprint');
    }
  }

  return prisma.task.update({
    where: { id: taskId },
    data: { sprintId },
  });
}
