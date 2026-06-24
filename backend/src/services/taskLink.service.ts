import { TaskLinkType, UserRole } from '@prisma/client';
import prisma from '../config/database';
import { NotFoundError, ValidationError, ForbiddenError } from '../utils/errors';
import { logActivity } from './activity.service';
import { checkPermission } from './rbac.service';

/**
 * "Linked Issues" — directional links between tasks. Industry-standard PM
 * tools (Jira, Linear, Shortcut) split this into:
 *   - Blocks / Blocked by  (BLOCKS, asymmetric)
 *   - Related to           (RELATES_TO, symmetric)
 *   - Duplicates / Duplicated by (DUPLICATES, asymmetric)
 *
 * We store all three as the same row shape, with direction encoded by
 * `fromTaskId` and `toTaskId`. RELATES_TO is symmetric in spirit but we
 * still record direction for audit ("who linked what, from where").
 *
 * The data shape returned by `getTaskLinks` is grouped to match how the UI
 * renders, so the front-end doesn't have to do the inversion math.
 */

interface LinkedTaskSummary {
  linkId: string;
  taskId: string;
  taskNumber: number;
  title: string;
  status: string;
  priority: string;
  isBlocked: boolean;
  project: { id: string; slug: string; name: string };
}

const LINKED_INCLUDE = {
  fromTask: { include: { project: { select: { id: true, slug: true, name: true } } } },
  toTask:   { include: { project: { select: { id: true, slug: true, name: true } } } },
} as const;

function toSummary(link: any, otherSide: 'from' | 'to'): LinkedTaskSummary {
  const t = otherSide === 'from' ? link.fromTask : link.toTask;
  return {
    linkId: link.id,
    taskId: t.id,
    taskNumber: t.taskNumber,
    title: t.title,
    status: t.status,
    priority: t.priority,
    isBlocked: t.isBlocked,
    project: t.project,
  };
}

export async function getTaskLinks(taskId: string) {
  // One trip for "this task is the source" rows...
  const [outgoing, incoming] = await Promise.all([
    prisma.taskLink.findMany({
      where: { fromTaskId: taskId },
      include: LINKED_INCLUDE,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.taskLink.findMany({
      where: { toTaskId: taskId },
      include: LINKED_INCLUDE,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  // Empty buckets so the FE always gets the same shape and can avoid null checks.
  const blocks: LinkedTaskSummary[] = [];
  const blockedBy: LinkedTaskSummary[] = [];
  const relatesTo: LinkedTaskSummary[] = [];
  const duplicates: LinkedTaskSummary[] = [];
  const duplicatedBy: LinkedTaskSummary[] = [];
  // SPAWNED_FROM is directional, like BLOCKS: the "from" side is the
  // child (the spin-off); the "to" side is the parent (the bug).
  //   - spawnedFrom: this task points to its parent (outgoing)
  //   - spawned: tasks that point to this one (incoming) — the
  //     children spun off from this parent.
  const spawnedFrom: LinkedTaskSummary[] = [];
  const spawned:     LinkedTaskSummary[] = [];

  for (const l of outgoing) {
    if (l.type === TaskLinkType.BLOCKS)       blocks.push(toSummary(l, 'to'));
    else if (l.type === TaskLinkType.RELATES_TO) relatesTo.push(toSummary(l, 'to'));
    else if (l.type === TaskLinkType.DUPLICATES) duplicates.push(toSummary(l, 'to'));
    else if (l.type === TaskLinkType.SPAWNED_FROM) spawnedFrom.push(toSummary(l, 'to'));
  }
  for (const l of incoming) {
    if (l.type === TaskLinkType.BLOCKS)       blockedBy.push(toSummary(l, 'from'));
    else if (l.type === TaskLinkType.RELATES_TO) relatesTo.push(toSummary(l, 'from'));
    else if (l.type === TaskLinkType.DUPLICATES) duplicatedBy.push(toSummary(l, 'from'));
    else if (l.type === TaskLinkType.SPAWNED_FROM) spawned.push(toSummary(l, 'from'));
  }

  return { blocks, blockedBy, relatesTo, duplicates, duplicatedBy, spawnedFrom, spawned };
}

/**
 * Cycle detection for BLOCKS — refuses to create A→B if a path B→…→A exists.
 * Self-blocking (A blocks A) is rejected up front. We do a bounded BFS
 * starting from `targetId` and walking forward through BLOCKS edges; if we
 * reach `sourceId` within the bound, the link would create a cycle.
 *
 * The bound caps work for adversarial graphs — a healthy project never has
 * blocking chains anywhere near this depth.
 */
const BLOCKS_CYCLE_BOUND = 200;

async function blocksWouldCycle(sourceId: string, targetId: string): Promise<boolean> {
  if (sourceId === targetId) return true;
  const visited = new Set<string>([targetId]);
  let frontier: string[] = [targetId];
  let walked = 0;

  while (frontier.length > 0 && walked < BLOCKS_CYCLE_BOUND) {
    const next = await prisma.taskLink.findMany({
      where: { fromTaskId: { in: frontier }, type: TaskLinkType.BLOCKS },
      select: { toTaskId: true },
    });
    const newFrontier: string[] = [];
    for (const row of next) {
      walked++;
      if (row.toTaskId === sourceId) return true;
      if (!visited.has(row.toTaskId)) {
        visited.add(row.toTaskId);
        newFrontier.push(row.toTaskId);
      }
    }
    frontier = newFrontier;
  }
  return false;
}

export async function createTaskLink(
  fromTaskId: string,
  data: { targetTaskId: string; type: TaskLinkType },
  userId: string,
) {
  if (!data.targetTaskId) throw new ValidationError('Target task is required.');
  if (data.targetTaskId === fromTaskId) {
    throw new ValidationError('A task cannot link to itself.');
  }

  // Pull both ends in one query to validate + grab project for activity log.
  const [from, to] = await Promise.all([
    prisma.task.findUnique({
      where: { id: fromTaskId },
      select: { id: true, projectId: true, title: true, taskNumber: true },
    }),
    prisma.task.findUnique({
      where: { id: data.targetTaskId },
      select: { id: true, projectId: true, title: true, taskNumber: true },
    }),
  ]);
  if (!from) throw new NotFoundError('Task');
  if (!to)   throw new NotFoundError('Linked task');

  // Cross-project links are out of scope for v1 — the UI also only searches
  // within-project, but enforce on the server defensively.
  if (from.projectId !== to.projectId) {
    throw new ValidationError('Linked tasks must belong to the same project.');
  }

  // Symmetric type — RELATES_TO — should normalize to a canonical direction
  // so we don't store both A→B and B→A as separate rows. We pick the side
  // with the lexicographically smaller id as the canonical "from".
  let normalizedFrom = fromTaskId;
  let normalizedTo   = data.targetTaskId;
  if (data.type === TaskLinkType.RELATES_TO && fromTaskId > data.targetTaskId) {
    normalizedFrom = data.targetTaskId;
    normalizedTo   = fromTaskId;
  }

  // Cycle guard — only meaningful for BLOCKS, the one type that creates a
  // dependency graph. Skip the work for the symmetric / pseudo-symmetric kinds.
  if (data.type === TaskLinkType.BLOCKS) {
    if (await blocksWouldCycle(normalizedFrom, normalizedTo)) {
      throw new ValidationError(
        'This blocks-link would create a cycle. Resolve the existing chain first.',
      );
    }
  }

  // Reject duplicate inverse for RELATES_TO too: if (B, A, RELATES_TO) exists
  // because we already normalized, the unique index handles it. For BLOCKS we
  // also block A→B if B→A already exists (would be a 1-cycle).
  if (data.type === TaskLinkType.BLOCKS) {
    const inverse = await prisma.taskLink.findUnique({
      where: {
        fromTaskId_toTaskId_type: {
          fromTaskId: normalizedTo,
          toTaskId: normalizedFrom,
          type: TaskLinkType.BLOCKS,
        },
      },
    });
    if (inverse) {
      throw new ValidationError(
        `This is the inverse of an existing "blocks" link — remove that one first if you want to flip the direction.`,
      );
    }
  }

  const link = await prisma.$transaction(async (tx) => {
    let created;
    try {
      created = await tx.taskLink.create({
        data: {
          fromTaskId: normalizedFrom,
          toTaskId: normalizedTo,
          type: data.type,
          createdById: userId,
        },
      });
    } catch (e: any) {
      // Unique-constraint violation surfaces as P2002 — friendlier message.
      if (e?.code === 'P2002') {
        throw new ValidationError('This link already exists.');
      }
      throw e;
    }

    await logActivity({
      userId,
      projectId: from.projectId,
      action: 'created_task_link',
      targetType: 'task',
      targetId: fromTaskId,
      details: {
        type: data.type,
        fromTitle: from.title,
        toTitle: to.title,
        toTaskNumber: to.taskNumber,
      },
    }, tx);

    return created;
  });

  return link;
}

/**
 * Spin off a child task from a parent (typically a BUG).
 *
 * Two operations in one transaction:
 *   1. Create a new task in the same project as the parent. Inherits
 *      productId + clientVisible from the parent so the spin-offs land
 *      in the right scope by default; the team can re-scope later.
 *      Status is forced to BACKLOG so the spawned task hits triage.
 *   2. Create a SPAWNED_FROM TaskLink (from=new child, to=parent).
 *
 * Done atomically because a half-done spawn (task created but link
 * missing) would orphan the new task from its parent — exactly the
 * provenance the feature exists to preserve.
 *
 * Used by the "Spin off task" action on bug tasks. Not exposed as a
 * generic "create-task-with-link" endpoint to keep the call site
 * unambiguous; a generic version would have to grow defensive
 * validation around what link kinds are legal.
 */
export async function spawnSubtask(
  parentTaskId: string,
  data: { title: string; description?: string | null; taskType?: 'FEATURE' | 'BUG' | 'CHORE' | 'SPIKE' },
  userId: string,
) {
  const parent = await prisma.task.findUnique({
    where: { id: parentTaskId },
    select: {
      id: true,
      projectId: true,
      productId: true,
      clientVisible: true,
      title: true,
      taskType: true,
    },
  });
  if (!parent) throw new NotFoundError('Parent task');

  // Title must be non-empty after trim — same 200-char cap as the
  // regular task validator (we duplicate here for the inline create).
  const trimmedTitle = (data.title ?? '').trim();
  if (!trimmedTitle) throw new ValidationError('Title is required');
  if (trimmedTitle.length > 200) throw new ValidationError('Title cannot exceed 200 characters');

  const child = await prisma.$transaction(async (tx) => {
    const project = await tx.project.update({
      where: { id: parent.projectId },
      data: { taskCounter: { increment: 1 } },
      select: { taskCounter: true },
    });

    const maxOrder = await tx.task.aggregate({
      where: { projectId: parent.projectId, status: 'BACKLOG' },
      _max: { sortOrder: true },
    });

    const created = await tx.task.create({
      data: {
        projectId: parent.projectId,
        taskNumber: project.taskCounter,
        title: trimmedTitle,
        description: data.description ?? null,
        taskType: data.taskType ?? 'FEATURE',
        status: 'BACKLOG',
        priority: 'P2',
        creatorId: userId,
        // Inherit scope from the parent — a fix for a bug stays in the
        // same product + visibility bucket.
        productId: parent.productId,
        clientVisible: parent.clientVisible,
        sortOrder: (maxOrder._max.sortOrder ?? 0) + 1,
      },
      include: {
        assignee: { select: { id: true, name: true } },
        creator: { select: { id: true, name: true } },
        project: { select: { slug: true } },
        product: { select: { id: true, name: true, slug: true, color: true, icon: true } },
      },
    });

    await tx.taskLink.create({
      data: {
        fromTaskId: created.id,
        toTaskId: parent.id,
        type: 'SPAWNED_FROM',
        createdById: userId,
      },
    });

    await logActivity({
      userId,
      projectId: parent.projectId,
      action: 'spawned_subtask',
      targetType: 'task',
      targetId: parent.id,
      details: {
        parentTitle: parent.title,
        childTaskId: created.id,
        childTitle: created.title,
      },
    }, tx);

    return created;
  });

  return child;
}

export async function deleteTaskLink(linkId: string, userId: string, userRole: UserRole) {
  const link = await prisma.taskLink.findUnique({
    where: { id: linkId },
    include: {
      fromTask: { select: { id: true, projectId: true, title: true } },
      toTask:   { select: { title: true, taskNumber: true } },
    },
  });
  if (!link) throw new NotFoundError('Link');

  // ── Membership gate ────────────────────────────────────────────────
  //
  // The route (`DELETE /links/:linkId`) only authorizes by role
  // permission (`task.edit_any` OR `task.edit_own`). It cannot apply
  // `taskAccess` middleware because the URL param is a linkId, not a
  // taskId — there's no task to look up at the middleware layer.
  //
  // Without this check, any user whose role has `task.edit_own`
  // (notably ENGINEER) could delete any task link in any project
  // simply by knowing the linkId. linkIds are UUIDs so they're not
  // guessable, but they leak via screenshots, activity logs, shared
  // URLs, etc. — a real attack surface.
  //
  // Mirror the `taskAccess` middleware shape: `project.view_all`
  // (super-admin) bypasses; otherwise enforce membership of the
  // source task's project. `createTaskLink` already enforces that
  // `from.projectId === to.projectId`, so the source-side check is
  // sufficient.
  const canViewAll = await checkPermission(userRole, 'project.view_all');
  if (!canViewAll) {
    const membership = await prisma.projectMember.findUnique({
      where: {
        userId_projectId: {
          userId,
          projectId: link.fromTask.projectId,
        },
      },
      select: { userId: true },
    });
    if (!membership) {
      throw new ForbiddenError('Not a member of this project');
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.taskLink.delete({ where: { id: linkId } });
    await logActivity({
      userId,
      projectId: link.fromTask.projectId,
      action: 'removed_task_link',
      targetType: 'task',
      targetId: link.fromTask.id,
      details: {
        type: link.type,
        fromTitle: link.fromTask.title,
        toTitle: link.toTask.title,
        toTaskNumber: link.toTask.taskNumber,
      },
    }, tx);
  });
}

/**
 * Lightweight task search for the "add link" picker — within-project only,
 * excludes the source task itself, capped at 20 results.
 *
 * **Visibility gate:** CLIENT viewers (no `task.view_internal`) only see
 * `clientVisible: true` rows. Without this filter the search autocomplete
 * leaks internal task titles to any project member who can hit the route
 * — the route has only `projectAccess`, so CLIENT users CAN reach this
 * endpoint even though they can't actually create links (link-creation
 * requires `task.edit_any` / `task.edit_own`, which CLIENT lacks).
 * Same-shape leak as the activity-feed milestone/decision-title leaks.
 */
export async function searchTasksForLinking(
  projectId: string,
  query: string,
  excludeTaskId: string,
  userRole: UserRole,
) {
  const trimmed = query.trim();
  // Allow "FUR-12" style task-number lookups by extracting the trailing digits.
  const numericMatch = trimmed.match(/(\d+)/);
  const taskNumber = numericMatch ? parseInt(numericMatch[1], 10) : null;

  const canViewInternal = await checkPermission(userRole, 'task.view_internal');

  const where: any = {
    projectId,
    id: { not: excludeTaskId },
    OR: [
      { title: { contains: trimmed, mode: 'insensitive' } },
    ],
  };
  if (taskNumber != null) {
    where.OR.push({ taskNumber });
  }
  if (!canViewInternal) {
    where.clientVisible = true;
  }

  return prisma.task.findMany({
    where,
    select: {
      id: true,
      taskNumber: true,
      title: true,
      status: true,
      priority: true,
    },
    orderBy: [{ taskNumber: 'asc' }],
    take: 20,
  });
}
