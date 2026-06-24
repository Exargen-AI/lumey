import { UserRole, TaskStatus, Prisma } from '@prisma/client';
import prisma from '../config/database';
import { NotFoundError, ForbiddenError, ValidationError, ConflictError } from '../utils/errors';
import { logActivity } from './activity.service';
import { emitProductivityEvent } from '../lib/productivityOutbox';
import {
  notifyTaskAssigned,
  notifyTaskBlocked,
  notifyReviewRequested,
  notifyReviewDecided,
  notifyTaskDeleted,
  notifyTaskPriorityChanged,
  notifyTaskDueDateChanged,
  notifyTaskNudge,
  notifyTaskSubscribersOfEdit,
  notifyTaskCompletionEncouragement,
} from './notification.service';
import {
  subscribeToTask,
  getSubscriberIdsForNotify,
} from './taskSubscription.service';
import { checkPermission, canViewProjectInternal } from './rbac.service';
import { validateValuesForProject } from './customField.service';
import {
  viewerCanSeeAgents,
  EXCLUDE_AGENT_ASSIGNED_TASKS,
  maskAgentActor,
} from '../lib/agentVisibility';
import { logger } from '../lib/logger';

async function ensureAssignableProjectMember(client: any, projectId: string, assigneeId?: string | null) {
  if (!assigneeId) return;

  const membership = await client.projectMember.findFirst({
    where: {
      projectId,
      userId: assigneeId,
      user: { isActive: true },
    },
    select: { id: true },
  });

  if (!membership) {
    throw new ValidationError('Assignee must be an active member of this project');
  }
}

// ─── Status state machine ─────────────────────────────────────────────────
//
// Permissive but invariant-protecting (QA finding #7):
//   - You may not skip from BACKLOG straight to DONE / IN_REVIEW. Triage
//     belongs in TODO/IN_PROGRESS so we have a trail of "this was actually
//     worked on" rather than secret instant-completes.
//   - You may not move a task back from DONE into IN_REVIEW. If something
//     was approved Done and needs more work, the right transition is to
//     reopen it as IN_PROGRESS (or de-scope to BACKLOG).
//   - Lateral no-op (X → X) is always fine — used by reorder/sortOrder paths.
//
// Anything else is allowed. The Done-gate (`acceptanceCriteria` enforcement)
// is layered on top via `enforceDoneGate`.
const ILLEGAL_TRANSITIONS: ReadonlyArray<readonly [TaskStatus, TaskStatus]> = [
  [TaskStatus.BACKLOG, TaskStatus.DONE],
  [TaskStatus.BACKLOG, TaskStatus.IN_REVIEW],
  [TaskStatus.DONE, TaskStatus.IN_REVIEW],
];

export function assertLegalTransition(from: TaskStatus, to: TaskStatus): void {
  if (from === to) return;
  for (const [bad, target] of ILLEGAL_TRANSITIONS) {
    if (from === bad && to === target) {
      throw new ValidationError(
        `Cannot move task from ${from} to ${to}. Move it through an intermediate status first.`,
      );
    }
  }
}

// Statuses that mean active, owned work. A task can't be "in progress",
// "in review", or "done" with nobody assigned — that's how work silently
// stalls (Pankaj 2026-06-02: tasks slid into In Progress with no owner).
// BACKLOG and TODO stay assignable-later so triage isn't blocked.
const ASSIGNEE_REQUIRED_STATUSES: ReadonlySet<TaskStatus> = new Set([
  TaskStatus.IN_PROGRESS,
  TaskStatus.IN_REVIEW,
  TaskStatus.DONE,
]);

const ACTIVE_STATUS_LABEL: Record<string, string> = {
  [TaskStatus.IN_PROGRESS]: 'In Progress',
  [TaskStatus.IN_REVIEW]: 'In Review',
  [TaskStatus.DONE]: 'Done',
};

/**
 * Refuse to move a task into an active status (In Progress / In Review /
 * Done) unless it has an owner. `effectiveAssigneeId` is the assignee the
 * task WILL have after this change — a new assigneeId in the SAME update
 * wins over the task's current one, so "assign + move" in one bulk change
 * passes. Enforced in every status-change path: moveTask (drag), updateTask
 * (drawer), and bulkUpdateTasks.
 */
export function assertAssigneeForActiveStatus(
  to: TaskStatus,
  effectiveAssigneeId: string | null | undefined,
): void {
  if (ASSIGNEE_REQUIRED_STATUSES.has(to) && !effectiveAssigneeId) {
    throw new ValidationError(
      `Assign someone before moving this task to ${ACTIVE_STATUS_LABEL[to] ?? to}. ` +
        `A task that's in progress, in review, or done must have an owner.`,
    );
  }
}

// "Done-gate": refuse to land on DONE if any acceptance criterion is still
// unchecked. Applied wherever a task can land in DONE — both `moveTask`
// (kanban drag) and `updateTask` (form save) need this to stay closed.
//
// 2026-05-23 — Pankaj reported the error said WHAT (count) but not WHICH
// (text). He had to dig through the modal to find the unchecked items.
// The error message now names them inline — quoted, truncated to keep
// the toast readable, with overflow count if there are many. So the
// toast reads:
//
//   Cannot mark this task Done — 2 acceptance criteria are still
//   unchecked: "Tests added", "Docs reviewed". Open the task to tick them.
//
// rather than the previous generic "2 acceptance criteria are still
// unchecked."
//
// Limit: first 3 items, then "+N more". Each item truncated to 60 chars
// so a single 500-char AC entry doesn't blow up the toast width. Falls
// back to a positional name ("Item 4") if an AC row has no text.
export function enforceDoneGate(task: { acceptanceCriteria: unknown }, newStatus: TaskStatus): void {
  if (newStatus !== TaskStatus.DONE) return;
  const ac = task.acceptanceCriteria;
  if (!Array.isArray(ac) || ac.length === 0) return;

  const uncheckedItems: string[] = ac
    .map((c: any, i: number) => {
      if (c && c.done === true) return null;
      const raw = typeof c?.text === 'string' ? c.text.trim() : '';
      const fallback = `Item ${i + 1}`;
      const label = raw.length > 0 ? raw : fallback;
      return label.length > 60 ? `${label.slice(0, 57)}…` : label;
    })
    .filter((label: string | null): label is string => label !== null);

  if (uncheckedItems.length === 0) return;

  const count = uncheckedItems.length;
  const preview = uncheckedItems.slice(0, 3).map((t) => `"${t}"`).join(', ');
  const overflow = count > 3 ? ` (+${count - 3} more)` : '';
  const noun = count === 1 ? 'criterion is' : 'criteria are';

  throw new ValidationError(
    `Cannot mark this task Done — ${count} acceptance ${noun} still unchecked: ${preview}${overflow}. Open the task to tick them.`,
  );
}

// "Agent done-gate": agents (userType='AGENT') may not transition tasks to
// DONE — that's a human-review action. Two layers of defense:
//   1. The `task.transition.done` permission is granted to every human role
//      and can be denied to any role from the RBAC matrix. This is the
//      policy expression admins manage.
//   2. The structural userType check below — even if the permission grants
//      drift, an agent never lands a task in DONE. This is the invariant
//      Slice 1 of the agent platform commits to.
//
// Called from both `moveTask` and `updateTask` so the kanban-drag and the
// task-form-save paths share the same gate.
export async function enforceAgentDoneGate(
  newStatus: TaskStatus,
  user: { userType: 'HUMAN' | 'AGENT'; role: UserRole },
): Promise<void> {
  if (newStatus !== TaskStatus.DONE) return;
  if (user.userType === 'AGENT') {
    throw new ForbiddenError(
      'Agents may not transition tasks to Done — request a human reviewer.',
    );
  }
  const canTransitionToDone = await checkPermission(user.role, 'task.transition.done');
  if (!canTransitionToDone) {
    throw new ForbiddenError(
      'You do not have permission to transition tasks to Done.',
    );
  }
}

/**
 * Pulse productivity score — EXECUTION signal hook.
 *
 * Emit a `task.closed` productivity event when a task transitions TO
 * Done (not on done-to-done re-saves, not on from-done reverts).
 * Called inside the caller's existing $transaction.
 *
 * Credit goes to the task's ASSIGNEE (the person who did the work),
 * not whoever clicked the close button — a manager closing someone's
 * task should credit them, not the manager. Unowned tasks emit no
 * event (no one to credit).
 *
 * Gaming guards applied at write time:
 *   task_closed_too_fast: task age <60 min → flagged (scorer drops it)
 *
 * Other guards (self-resolve, no-description) are evaluated by the
 * scorer at recompute time so they can be tuned without re-emitting
 * events. The raw payload carries the needed fields.
 */
async function emitTaskClosedEvent(
  tx: Prisma.TransactionClient,
  taskId: string,
  oldStatus: TaskStatus,
  newStatus: TaskStatus,
  closerUserId: string,
  existing: Pick<
    Prisma.TaskGetPayload<{}>,
    'creatorId' | 'assigneeId' | 'storyPoints' | 'description' | 'createdAt'
  >,
): Promise<void> {
  if (newStatus !== TaskStatus.DONE) return;
  if (oldStatus === TaskStatus.DONE) return;
  if (!existing.assigneeId) return;

  // Comment count at close time — gaming guard input (self-resolve + 0 comments).
  const commentCount = await tx.comment.count({ where: { taskId } });

  const selfResolved = closerUserId === existing.creatorId;
  const hasDescription = !!existing.description?.trim();
  const closedAt = new Date();
  const ageMs = closedAt.getTime() - existing.createdAt.getTime();
  const isTooFast = ageMs < 60 * 60 * 1000;

  await emitProductivityEvent(tx, {
    userId: existing.assigneeId,
    signal: 'EXECUTION',
    eventType: 'task.closed',
    occurredAt: closedAt,
    rawPayload: {
      taskId,
      storyPoints: existing.storyPoints,
      createdAt: existing.createdAt.toISOString(),
      closedAt: closedAt.toISOString(),
      closerUserId,
      selfResolved,
      commentCount,
      hasDescription,
    },
    source: 'tasks',
    sourceId: taskId,
    gamingFlag: isTooFast ? 'task_closed_too_fast' : undefined,
  });
}

export async function listTasks(
  projectId: string,
  viewer: { id?: string; role: UserRole; canViewAgents?: boolean | null },
  filters: any = {},
) {
  const where: any = { projectId };

  // Visibility gate: only viewers who can see this project's internal work
  // get the non-client-visible tasks. Uses the PER-PROJECT check so a CLIENT
  // member granted full access (ProjectMember.fullAccess) sees the entire
  // backlog for THIS project — while staying client-visible-only on other
  // projects. (Was a role-level checkPermission that silently ignored both
  // the per-project grant and the legacy global extendedClientAccess flag.)
  const canViewInternal = await canViewProjectInternal(viewer, projectId);
  if (!canViewInternal) {
    where.clientVisible = true;
  }

  // 2026-06-01 — Agent visibility lockdown. Tasks assigned to an AI
  // agent are hidden from anyone not on the agent-visibility allowlist
  // (SUPER_ADMIN is implicitly allowed). Server-side so agent work
  // never reaches an unauthorised client. Null-assignee + human-
  // assigned tasks pass through (see EXCLUDE_AGENT_ASSIGNED_TASKS).
  if (!viewerCanSeeAgents(viewer)) {
    Object.assign(where, EXCLUDE_AGENT_ASSIGNED_TASKS);
  }

  if (filters.status) where.status = filters.status;
  if (filters.priority) where.priority = filters.priority;
  if (filters.assigneeId) where.assigneeId = filters.assigneeId;
  if (filters.isBlocked !== undefined) where.isBlocked = filters.isBlocked === 'true';
  if (filters.clientVisible !== undefined) where.clientVisible = filters.clientVisible === 'true';
  if (filters.search) where.title = { contains: filters.search, mode: 'insensitive' };
  // Product scoping (PR C). The string `'none'` is a sentinel for
  // "tasks with no product" — used by the admin "unassigned" bucket.
  if (filters.productId === 'none') {
    where.productId = null;
  } else if (filters.productId) {
    where.productId = filters.productId;
  }
  // Task-type filter — used by the bug list views ("show me all the
  // BUGs on this product"). Accepts any of the TaskType enum values.
  if (filters.taskType) where.taskType = filters.taskType;

  // Pagination. The kanban board pages per project (200/page via
  // useTasksInfinite + offset), so a 1000+ task project is reached across
  // several bounded pages — no single request needs to be unbounded. Default
  // 200 when no limit is passed (legacy callers keep their payload size); a
  // requested limit is honored UP TO MAX_LIMIT. The cap is the DoS guard
  // restored after #208 removed it: 2000 is 10 board-pages, generous for any
  // real request while refusing a `?limit=100000` payload bomb.
  const DEFAULT_LIMIT = 200;
  const MAX_LIMIT = 2000;
  const requestedLimit = Number.parseInt(String(filters.limit ?? ''), 10);
  const take = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, MAX_LIMIT)
    : DEFAULT_LIMIT;
  const requestedOffset = Number.parseInt(String(filters.offset ?? ''), 10);
  const skip = Number.isFinite(requestedOffset) && requestedOffset > 0 ? requestedOffset : 0;

  const tasks = await prisma.task.findMany({
    where,
    include: {
      // 2026-05-22 Pankaj policy: include userType so the FE can mask
      // agent identities for CLIENT viewers (show "Internal team"
      // instead of e.g. Manjari). Backwards-compat — additive field.
      assignee: { select: { id: true, name: true, userType: true } },
      // userType added to creator/reviewer/reviewRequester (2026-06-01)
      // so agent identities can be masked for unauthorised viewers on
      // otherwise-visible (human-assigned) tasks.
      creator: { select: { id: true, name: true, userType: true } },
      reviewer: { select: { id: true, name: true, role: true, userType: true } },
      reviewRequester: { select: { id: true, name: true, userType: true } },
      project: { select: { id: true, name: true, slug: true } },
      sprint: { select: { id: true, name: true, number: true } },
      epic: { select: { id: true, title: true, color: true } },
      product: { select: { id: true, name: true, slug: true, color: true, icon: true } },
      _count: { select: { comments: true } },
      // Last "moved into current status" timestamp powers aging dots on
      // the kanban — task.updatedAt is too noisy (every comment, every
      // subtask bumps it). We need the latest history row whose
      // `toStatus === task.status`, NOT just the latest history row,
      // because a task that bounced (TODO → DONE → IN_PROGRESS) has a
      // most-recent row of `toStatus: IN_PROGRESS` that matches but a
      // task that's currently TODO with most-recent `toStatus: DONE`
      // would match nothing if we only pulled `take: 1` (QA K-H4).
      // Filtering by `toStatus = current status` directly via Prisma's
      // raw `where` isn't expressible without per-task knowledge, so
      // we fetch the last 5 rows and post-filter client-side. Five is
      // enough for any realistic bounce pattern.
      statusHistory: {
        orderBy: { changedAt: 'desc' },
        take: 5,
        select: { changedAt: true, toStatus: true },
      },
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    take,
    skip,
  });

  const now = Date.now();
  const canSeeAgents = viewerCanSeeAgents(viewer);
  return tasks.map((t) => {
    // Find the most recent history row whose toStatus matches the current
    // status — that's the moment this task entered its current column.
    const lastEntry = t.statusHistory.find((h) => h.toStatus === t.status);
    const enteredCurrentStatusAt = lastEntry?.changedAt ?? t.createdAt;
    const ageMs = now - enteredCurrentStatusAt.getTime();
    const ageDays = Math.max(0, Math.floor(ageMs / 86_400_000));
    const { statusHistory, ...rest } = t;
    // Mask agent identities on the people fields for unauthorised
    // viewers. (Agent-ASSIGNED tasks are already filtered out above, so
    // assignee here is human; this catches a human-assigned task that an
    // agent created or reviews.)
    return {
      ...rest,
      assignee: maskAgentActor(rest.assignee, canSeeAgents),
      creator: maskAgentActor(rest.creator, canSeeAgents),
      reviewer: maskAgentActor(rest.reviewer, canSeeAgents),
      reviewRequester: maskAgentActor(rest.reviewRequester, canSeeAgents),
      enteredCurrentStatusAt,
      currentStatusAgeDays: ageDays,
    };
  });
}

/**
 * Build the same visibility-aware `where` clause `listTasks` uses, without
 * the pagination/order/include bits. Shared by `countTasksByStatus` and
 * `listTaskIds` so a CLIENT's counts/ids stay in lockstep with what their
 * paginated listing actually returns (no "count says 423, scroll shows 88"
 * mismatch caused by visibility filters).
 */
async function buildTaskWhere(
  projectId: string,
  viewer: { id?: string; role: UserRole; canViewAgents?: boolean | null },
  filters: any = {},
): Promise<any> {
  const where: any = { projectId };
  const canViewInternal = await canViewProjectInternal(viewer, projectId);
  if (!canViewInternal) where.clientVisible = true;
  if (!viewerCanSeeAgents(viewer)) Object.assign(where, EXCLUDE_AGENT_ASSIGNED_TASKS);

  if (filters.status) where.status = filters.status;
  if (filters.priority) where.priority = filters.priority;
  if (filters.assigneeId) where.assigneeId = filters.assigneeId;
  if (filters.isBlocked !== undefined) where.isBlocked = filters.isBlocked === 'true';
  if (filters.clientVisible !== undefined) where.clientVisible = filters.clientVisible === 'true';
  if (filters.search) where.title = { contains: filters.search, mode: 'insensitive' };
  if (filters.productId === 'none') where.productId = null;
  else if (filters.productId) where.productId = filters.productId;
  if (filters.taskType) where.taskType = filters.taskType;
  return where;
}

/**
 * Group-by-status count for a project. Powers the kanban column headers and
 * the BoardPage status strip — both need totals that include unloaded
 * (un-paginated) tasks. Cheap query: index on (projectId, status) covers it.
 * Filters (productId, search, assigneeId, etc.) are honored so the strip
 * reflects whatever filter the user has applied to the board.
 */
export async function countTasksByStatus(
  projectId: string,
  viewer: { id?: string; role: UserRole; canViewAgents?: boolean | null },
  filters: any = {},
): Promise<Record<string, number>> {
  // Strip `status` from the filter — we want a count PER status, not a single
  // status's count. Everything else (visibility, productId, search...) applies.
  const { status: _ignored, ...rest } = filters ?? {};
  const where = await buildTaskWhere(projectId, viewer, rest);
  const rows = await prisma.task.groupBy({
    by: ['status'],
    where,
    _count: { _all: true },
  });
  const out: Record<string, number> = {};
  for (const s of Object.values(TaskStatus)) out[s] = 0;
  for (const r of rows) out[r.status] = r._count._all;
  return out;
}

/**
 * Flat id list for a single column. Used by the "Select all in column"
 * affordance so bulk operations (move / delete / re-priority) cover the
 * whole column even when only the first page of cards is loaded in the UI.
 * Honors the same visibility + filter rules as `listTasks`.
 */
export async function listTaskIds(
  projectId: string,
  viewer: { id?: string; role: UserRole; canViewAgents?: boolean | null },
  filters: any = {},
): Promise<string[]> {
  const where = await buildTaskWhere(projectId, viewer, filters);
  const rows = await prisma.task.findMany({
    where,
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function getTask(
  taskId: string,
  viewer: { id?: string; role: UserRole; canViewAgents?: boolean | null },
) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      // 2026-05-22 Pankaj policy: include userType so the FE can mask
      // agent identities for CLIENT viewers (show "Internal team"
      // instead of e.g. Manjari). Backwards-compat — additive field.
      assignee: { select: { id: true, name: true, userType: true } },
      // userType added to creator/reviewer/reviewRequester (2026-06-01)
      // so agent identities can be masked for unauthorised viewers on
      // otherwise-visible (human-assigned) tasks.
      creator: { select: { id: true, name: true, userType: true } },
      reviewer: { select: { id: true, name: true, role: true, userType: true } },
      reviewRequester: { select: { id: true, name: true, userType: true } },
      project: { select: { id: true, name: true, slug: true } },
      sprint: { select: { id: true, name: true, number: true } },
      epic: { select: { id: true, title: true, color: true } },
      product: { select: { id: true, name: true, slug: true, color: true, icon: true } },
      _count: { select: { comments: true } },
    },
  });

  if (!task) throw new NotFoundError('Task');
  // Per-project internal check so a CLIENT granted full access on this
  // project can open its internal (clientVisible=false) tasks.
  const canViewInternal = await canViewProjectInternal(viewer, task.projectId);
  if (!canViewInternal && !task.clientVisible) {
    throw new ForbiddenError('Access denied');
  }

  // 2026-06-01 — Agent visibility lockdown. A task assigned to an AI
  // agent is invisible to anyone off the allowlist — return NotFound
  // (not Forbidden) so we don't even confirm the task exists.
  const canSeeAgents = viewerCanSeeAgents(viewer);
  if (!canSeeAgents && task.assignee?.userType === 'AGENT') {
    throw new NotFoundError('Task');
  }

  // Mask any agent creator/reviewer on an otherwise-visible task.
  return {
    ...task,
    assignee: maskAgentActor(task.assignee, canSeeAgents),
    creator: maskAgentActor(task.creator, canSeeAgents),
    reviewer: maskAgentActor(task.reviewer, canSeeAgents),
    reviewRequester: maskAgentActor(task.reviewRequester, canSeeAgents),
  };
}

export async function createTask(
  projectId: string,
  data: any,
  creatorId: string,
  creatorRole: UserRole,
) {
  // Client-request constraints (PR A — client kanban quick-add). When the
  // actor is a CLIENT, every shape the request could take is rewritten
  // to the safe shape before we touch the DB:
  //   - clientRequested forced true (this IS a client request)
  //   - clientVisible forced true (a client can't create work they can't see)
  //   - status forced BACKLOG (team triages from there; no skipping to IN_PROGRESS)
  //   - assigneeId stripped (clients don't assign engineers to themselves)
  //   - sprintId / epicId stripped (planning fields the team owns)
  //   - taskType normalised to FEATURE unless explicitly BUG
  //     (CHORE / SPIKE are internal-flow labels)
  // Internal users still get the canonical create path; they may pass
  // clientRequested=true if they're submitting on a client's behalf,
  // but they can't fake a client-creator (creatorId comes from the
  // session, not the body).
  const isClientActor = creatorRole === UserRole.CLIENT;
  const isClientRequest = isClientActor || !!data.clientRequested;

  const effectiveStatus: TaskStatus = isClientActor
    ? TaskStatus.BACKLOG
    : (data.status as TaskStatus | undefined) || TaskStatus.BACKLOG;
  const effectiveClientVisible = isClientActor ? true : !!data.clientVisible;
  const effectiveAssigneeId = isClientActor ? null : (data.assigneeId || null);
  const effectiveSprintId = isClientActor ? null : (data.sprintId || null);
  const effectiveEpicId = isClientActor ? null : (data.epicId || null);
  // Clients don't pick milestones — that's a project-management decision.
  const effectiveMilestoneId = isClientActor ? null : (data.milestoneId || null);
  // Clients can flag a bug, but other types are internal vocabulary.
  const effectiveTaskType = isClientActor
    ? (data.taskType === 'BUG' ? 'BUG' : 'FEATURE')
    : (data.taskType || 'FEATURE');

  // Atomic task creation with auto-increment task number. Custom-field
  // validation runs inside the transaction (QA finding #38) so a concurrent
  // delete of a field definition can't slip values past the schema.
  // Counter increments only land on commit, so no taskCounter burn.
  const task = await prisma.$transaction(async (tx) => {
    const customFieldValues = await validateValuesForProject(projectId, data.customFields, tx);

    await ensureAssignableProjectMember(tx, projectId, effectiveAssigneeId);

    // Verify the productId (if any) belongs to this project. Without
    // this guard, a hand-crafted body could link a task into a product
    // from a different project. We accept null/undefined as "no product
    // scoping" — that's the common case for cross-cutting work.
    if (data.productId) {
      const product = await tx.product.findUnique({
        where: { id: data.productId },
        select: { projectId: true },
      });
      if (!product || product.projectId !== projectId) {
        throw new ValidationError('Product does not belong to this project');
      }
    }

    // Same cross-project guard for milestoneId — a hand-crafted body
    // could try to point a task at a milestone in another project.
    if (effectiveMilestoneId) {
      const milestone = await tx.milestone.findUnique({
        where: { id: effectiveMilestoneId },
        select: { projectId: true },
      });
      if (!milestone || milestone.projectId !== projectId) {
        throw new ValidationError('Milestone does not belong to this project');
      }
    }

    const project = await tx.project.update({
      where: { id: projectId },
      data: { taskCounter: { increment: 1 } },
      select: { taskCounter: true, slug: true },
    });

    // Compute next sortOrder for this project + status
    const maxOrder = await tx.task.aggregate({
      where: { projectId, status: effectiveStatus },
      _max: { sortOrder: true },
    });

    return tx.task.create({
      data: {
        projectId,
        taskNumber: project.taskCounter,
        title: data.title,
        description: data.description || null,
        taskType: effectiveTaskType,
        status: effectiveStatus,
        priority: data.priority || 'P2',
        storyPoints: isClientActor ? null : (data.storyPoints || null),
        sprintId: effectiveSprintId,
        epicId: effectiveEpicId,
        milestoneId: effectiveMilestoneId,
        productId: data.productId ?? null,
        assigneeId: effectiveAssigneeId,
        creatorId,
        dueDate: data.dueDate ? new Date(data.dueDate) : null,
        labels: data.labels || [],
        subtasks: isClientActor ? [] : (data.subtasks || []),
        // Accept AC on create so the new-task form can collect them in one
        // step. The Done-gate uses `acceptanceCriteria` to decide whether
        // a transition to DONE is legal — populating it on create simply
        // means the gate is "real" from day one rather than only after a
        // separate update call. (Team feedback #4.)
        acceptanceCriteria: isClientActor ? [] : (data.acceptanceCriteria || []),
        customFields: customFieldValues as Prisma.InputJsonValue,
        clientVisible: effectiveClientVisible,
        clientRequested: isClientRequest,
        sortOrder: (maxOrder._max.sortOrder || 0) + 1,
      },
      include: {
        // 2026-05-22 Pankaj policy: include userType so the FE can mask
      // agent identities for CLIENT viewers (show "Internal team"
      // instead of e.g. Manjari). Backwards-compat — additive field.
      assignee: { select: { id: true, name: true, userType: true } },
        creator: { select: { id: true, name: true, role: true } },
        project: { select: { slug: true } },
        sprint: { select: { id: true, name: true } },
        epic: { select: { id: true, title: true, color: true } },
        product: { select: { id: true, name: true, slug: true, color: true, icon: true } },
      },
    });
  });

  await logActivity({
    userId: creatorId,
    projectId,
    action: isClientRequest ? 'submitted_client_request' : 'created_task',
    targetType: 'task',
    targetId: task.id,
    details: { title: task.title, taskNumber: task.taskNumber, clientRequested: isClientRequest },
  });

  // ── Auto-subscribe creator + assignee (CC feature PR 2026-05-20) ─
  //
  // Creator obviously cares about their task. Assignee (when set
  // on creation) is the owner of the work — they need every signal
  // about it. Both rows are idempotent; calling subscribeToTask
  // twice with the same key is a no-op.
  //
  // Fire-and-forget: subscription failures shouldn't fail task
  // creation (the user has the task; missing a row on a follow
  // table is recoverable).
  subscribeToTask(task.id, creatorId, 'AUTO_CREATOR')
    .catch((err) => logger.warn({ err: err?.message }, '[subscribe] AUTO_CREATOR failed:'));
  if (task.assigneeId) {
    subscribeToTask(task.id, task.assigneeId, 'AUTO_ASSIGNEE')
      .catch((err) => logger.warn({ err: err?.message }, '[subscribe] AUTO_ASSIGNEE failed:'));
  }

  return task;
}

export async function updateTask(
  taskId: string,
  data: any,
  userId: string,
  userRole: UserRole,
  userType: 'HUMAN' | 'AGENT' = 'HUMAN',
  // 2026-05-15 optimistic-locking audit. When the caller has the
  // task's last-known `updatedAt` (which they got back from a
  // previous GET), pass it here as an ISO string. The service
  // refuses the write if the server's `updatedAt` no longer
  // matches — i.e. someone else's edit landed between the caller's
  // read and write, and a silent overwrite would lose their data.
  //
  // OPT-IN: callers that don't pass this preserve pre-fix
  // behavior (last-write-wins). Once the FE migrates to send the
  // field on every PUT, this becomes the default protection.
  expectedUpdatedAt?: string,
) {
  const existing = await prisma.task.findUnique({ where: { id: taskId } });
  if (!existing) throw new NotFoundError('Task');

  // Early conflict detection — cheap, fail-fast before we run the
  // full permission + validation chain only to reject at the
  // update. Surfaces the server's current `updatedAt` in the error
  // message so the FE can re-fetch and show the user what changed.
  if (expectedUpdatedAt && existing.updatedAt.toISOString() !== expectedUpdatedAt) {
    throw new ConflictError(
      `This task was edited by someone else. Refresh and reapply your changes. (server updatedAt: ${existing.updatedAt.toISOString()})`,
    );
  }

  const canEditAnyTask = await checkPermission(userRole, 'task.edit_any');

  if (!canEditAnyTask && existing.assigneeId !== userId && existing.creatorId !== userId) {
    throw new ForbiddenError('You can only edit tasks you created or are assigned to');
  }

  // Re-verify the actor is still a member of the task's project. Without
  // this, a user removed from a project can keep editing tasks they were
  // previously assigned to (QA finding #8) — taskAccess middleware no
  // longer covers it once the assignee link survives the membership purge.
  if (!canEditAnyTask) {
    const membership = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId, projectId: existing.projectId } },
      select: { id: true },
    });
    if (!membership) {
      throw new ForbiddenError('Not a member of this project');
    }
  }

  if (data.assigneeId !== undefined) {
    await ensureAssignableProjectMember(prisma, existing.projectId, data.assigneeId);
  }

  // Product re-scoping. Verify the new product belongs to the same
  // project before persisting; null/undefined are valid ("unscope this
  // task from any product").
  if (data.productId !== undefined && data.productId !== null) {
    const product = await prisma.product.findUnique({
      where: { id: data.productId },
      select: { projectId: true },
    });
    if (!product || product.projectId !== existing.projectId) {
      throw new ValidationError('Product does not belong to this project');
    }
  }

  // Milestone re-scoping — same cross-project guard as productId. NULL
  // is valid ("unscope this task from any milestone"); a UUID must
  // point to a milestone in this task's project.
  if (data.milestoneId !== undefined && data.milestoneId !== null) {
    const milestone = await prisma.milestone.findUnique({
      where: { id: data.milestoneId },
      select: { projectId: true },
    });
    if (!milestone || milestone.projectId !== existing.projectId) {
      throw new ValidationError('Milestone does not belong to this project');
    }
  }

  // Status flips through the form path (PUT /tasks/:id) used to bypass the
  // state machine and the AC done-gate (QA finding #7). Apply the same
  // checks `moveTask` runs so the gate can't be sidestepped from a different
  // endpoint.
  if (data.status !== undefined && data.status !== existing.status) {
    assertLegalTransition(existing.status, data.status);
    enforceDoneGate(existing, data.status);
    await enforceAgentDoneGate(data.status, { userType, role: userRole });
    // Active statuses need an owner. A new assigneeId in this same save wins
    // over the task's current one (assign + advance in one edit is fine).
    assertAssigneeForActiveStatus(
      data.status,
      'assigneeId' in data ? data.assigneeId : existing.assigneeId,
    );
  }

  const updateData: any = { ...data };
  if (data.dueDate !== undefined) updateData.dueDate = data.dueDate ? new Date(data.dueDate) : null;
  // Custom-field values get validated against the project's current
  // definitions before they're persisted. We replace the whole map (not
  // merge) so the FE can send the authoritative state — and required
  // fields are enforced even when the caller forgets one.
  if (data.customFields !== undefined) {
    updateData.customFields = await validateValuesForProject(existing.projectId, data.customFields);
  }

  // ── The actual write ────────────────────────────────────────────
  //
  // Two paths:
  //
  //   1. expectedUpdatedAt provided → use updateMany with a
  //      compound where clause that includes `updatedAt`. If
  //      someone else's write landed between our early-exit check
  //      above and this point, the where clause matches 0 rows
  //      and we surface a Conflict. Prisma's plain `update` only
  //      accepts unique fields in the where clause and doesn't
  //      surface a count, so updateMany is the right primitive
  //      here even though it forces a follow-up findUnique to
  //      get the includes.
  //
  //   2. expectedUpdatedAt NOT provided → plain update, last-write-
  //      wins. Backwards compat. Once the FE migrates to send the
  //      field on every PUT this branch becomes dead code.
  //
  // The double check (early exit + write-time compound where)
  // closes the race window completely — between the early check
  // and the write there's no way to slip in another mutation that
  // we'd miss.
  // 2026-05-23 audit fix: bug #3 — status-history hole. Previously the
  // updateTask path mutated `status` without writing a TaskStatusHistory
  // row, leaving the audit trail with holes for any form-driven status
  // change (the kanban-drag moveTask path correctly wrote history). The
  // aging-dot calculation and the streak-encouragement counter both read
  // from TaskStatusHistory, so form-driven completions were invisible to
  // them. Wrapping write + history together inside one transaction fixes
  // both the audit-trail and the streak-count bug at once.
  const statusChanged = data.status !== undefined && data.status !== existing.status;
  let task;
  if (expectedUpdatedAt) {
    task = await prisma.$transaction(async (tx) => {
      const result = await tx.task.updateMany({
        where: { id: taskId, updatedAt: existing.updatedAt },
        data: updateData,
      });
      if (result.count === 0) {
        // Someone else wrote between our early-exit check and this
        // write. Re-fetch the current updatedAt so the FE sees the
        // freshest conflict info.
        const current = await tx.task.findUnique({
          where: { id: taskId },
          select: { updatedAt: true },
        });
        throw new ConflictError(
          `This task was edited by someone else. Refresh and reapply your changes. (server updatedAt: ${current?.updatedAt.toISOString() ?? 'unknown'})`,
        );
      }
      if (statusChanged) {
        await tx.taskStatusHistory.create({
          data: {
            taskId,
            fromStatus: existing.status,
            toStatus: data.status as TaskStatus,
            changedBy: userId,
          },
        });
        await emitTaskClosedEvent(
          tx,
          taskId,
          existing.status,
          data.status as TaskStatus,
          userId,
          existing,
        );
      }
      const inner = await tx.task.findUnique({
        where: { id: taskId },
        include: {
          assignee: { select: { id: true, name: true, userType: true } },
          creator: { select: { id: true, name: true } },
        },
      });
      if (!inner) throw new NotFoundError('Task');
      return inner;
    });
  } else {
    task = await prisma.$transaction(async (tx) => {
      const inner = await tx.task.update({
        where: { id: taskId },
        data: updateData,
        include: {
          assignee: { select: { id: true, name: true, userType: true } },
          creator: { select: { id: true, name: true } },
        },
      });
      if (statusChanged) {
        await tx.taskStatusHistory.create({
          data: {
            taskId,
            fromStatus: existing.status,
            toStatus: data.status as TaskStatus,
            changedBy: userId,
          },
        });
        await emitTaskClosedEvent(
          tx,
          taskId,
          existing.status,
          data.status as TaskStatus,
          userId,
          existing,
        );
      }
      return inner;
    });
  }

  if (data.isBlocked !== undefined && data.isBlocked !== existing.isBlocked) {
    await logActivity({
      userId,
      projectId: existing.projectId,
      action: data.isBlocked ? 'blocked_task' : 'unblocked_task',
      targetType: 'task',
      targetId: taskId,
      details: { title: task.title, blockerNote: data.blockerNote },
    });
    // Notify on block — non-blocking, but log failures so ops can investigate.
    if (data.isBlocked) {
      const project = await prisma.project.findUnique({ where: { id: existing.projectId }, select: { name: true } });
      notifyTaskBlocked(taskId, existing.projectId, task.title, project?.name || 'Unknown')
        .catch((err) => logger.warn({ err: err?.message }, '[notify] notifyTaskBlocked failed:'));
    }
  }

  // Notify on assignee change — non-blocking, but log failures.
  if (data.assigneeId && data.assigneeId !== existing.assigneeId) {
    const project = await prisma.project.findUnique({ where: { id: existing.projectId }, select: { name: true } });
    notifyTaskAssigned(taskId, data.assigneeId, task.title, project?.name || 'Unknown', userId, existing.projectId)
      .catch((err) => logger.warn({ err: err?.message }, '[notify] notifyTaskAssigned failed:'));

    // Auto-subscribe the new assignee (CC feature PR 2026-05-20).
    // They become the owner of this task; subscribe so they get
    // comment + edit notifications going forward.
    subscribeToTask(taskId, data.assigneeId, 'AUTO_ASSIGNEE')
      .catch((err) => logger.warn({ err: err?.message }, '[subscribe] AUTO_ASSIGNEE on reassign failed:'));
  }

  // ── Notify on priority change + due-date change ─────────────────
  //
  // Surfaced by the 2026-05-15 task-lifecycle audit: most edits to
  // a task were silent for the assignee, including time-sensitive
  // changes like priority bumps and deadline moves. Title /
  // description / labels remain silent (low-signal); priority +
  // due-date are surfaced because they materially change what the
  // assignee should be working on next.
  //
  // The assignee here is the CURRENT assignee after the update; if
  // the same PUT both reassigned and bumped priority, the new
  // assignee gets the priority ping (correct — they own the work
  // now). The editor is excluded inside the notify helpers.
  const assigneeForNotify = task.assigneeId; // post-update value
  if (assigneeForNotify && data.priority !== undefined && data.priority !== existing.priority) {
    const project = await prisma.project.findUnique({ where: { id: existing.projectId }, select: { name: true } });
    notifyTaskPriorityChanged({
      taskId,
      projectId: existing.projectId,
      taskTitle: task.title,
      projectName: project?.name ?? 'Unknown',
      assigneeId: assigneeForNotify,
      editorId: userId,
      fromPriority: String(existing.priority),
      toPriority: String(data.priority),
    }).catch((err) => logger.warn({ err: err?.message }, '[notify] notifyTaskPriorityChanged failed:'));
  }
  if (assigneeForNotify && data.dueDate !== undefined) {
    // The PUT serializer accepts both string ('YYYY-MM-DD') + null.
    // Normalize both sides to comparable shapes before deciding to
    // notify — a no-op write of the same date shouldn't ping.
    const existingDateIso = existing.dueDate ? existing.dueDate.toISOString().slice(0, 10) : null;
    const newDateIso = data.dueDate ? new Date(data.dueDate).toISOString().slice(0, 10) : null;
    if (existingDateIso !== newDateIso) {
      const project = await prisma.project.findUnique({ where: { id: existing.projectId }, select: { name: true } });
      notifyTaskDueDateChanged({
        taskId,
        projectId: existing.projectId,
        taskTitle: task.title,
        projectName: project?.name ?? 'Unknown',
        assigneeId: assigneeForNotify,
        editorId: userId,
        newDueDate: newDateIso,
      }).catch((err) => logger.warn({ err: err?.message }, '[notify] notifyTaskDueDateChanged failed:'));
    }
  }

  await logActivity({
    userId,
    projectId: existing.projectId,
    action: 'updated_task',
    targetType: 'task',
    targetId: taskId,
    details: { title: task.title },
  });

  // ── Notify subscribers of significant edits (CC feature 2026-05-20) ─
  //
  // Subscribers receive a single "X edited Y" notification listing
  // the fields that changed. Same set of fields that already trigger
  // field-specific notifications (assignee, priority, due-date) PLUS
  // title, description, status — the changes most worth surfacing.
  //
  // Dedupe rule: anyone already notified by a field-specific helper
  // (assignee, priority, due-date) is excluded from the subscriber
  // fan-out so they don't get a redundant "X edited Y" on top of
  // their targeted ping. The editor themselves is always excluded.
  const changedFields: string[] = [];
  if (data.title !== undefined && data.title !== existing.title) changedFields.push('title');
  if (data.description !== undefined && data.description !== existing.description) changedFields.push('description');
  if (data.priority !== undefined && data.priority !== existing.priority) changedFields.push('priority');
  if (data.status !== undefined && data.status !== existing.status) changedFields.push('status');
  if (data.dueDate !== undefined) {
    const existingDateIso = existing.dueDate ? existing.dueDate.toISOString().slice(0, 10) : null;
    const newDateIso = data.dueDate ? new Date(data.dueDate).toISOString().slice(0, 10) : null;
    if (existingDateIso !== newDateIso) changedFields.push('due date');
  }
  if (changedFields.length > 0) {
    // Build the exclude set: editor + anyone who got a more-
    // specific notification already (assignee for priority + due-
    // date changes).
    const exclude = new Set<string>([userId]);
    if (assigneeForNotify && (changedFields.includes('priority') || changedFields.includes('due date'))) {
      exclude.add(assigneeForNotify);
    }
    const subscriberIds = await getSubscriberIdsForNotify(taskId, exclude);
    if (subscriberIds.length > 0) {
      const project = await prisma.project.findUnique({ where: { id: existing.projectId }, select: { name: true } });
      const editor = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
      notifyTaskSubscribersOfEdit({
        taskId,
        taskTitle: task.title,
        projectId: existing.projectId,
        projectName: project?.name ?? 'a project',
        editorId: userId,
        editorName: editor?.name ?? 'A teammate',
        changedFields,
        subscriberIds,
      }).catch((err) => logger.warn({ err: err?.message }, '[notify] notifyTaskSubscribersOfEdit failed:'));
    }
  }

  // ── Encouragement on DONE transition (CC feature 2026-05-20) ────
  //
  // Positive reinforcement: when a user moves a task to DONE, send
  // them a "nice work" notification. Streak-aware — if they've
  // closed ≥ 3 today, swap the plain message for a celebratory one.
  //
  // Fires here AND in moveTask (the kanban drag path). Both paths
  // count the same way (TaskStatusHistory toStatus=DONE today).
  if (data.status === 'DONE' && existing.status !== 'DONE') {
    fireCompletionEncouragement(taskId, userId, task.title, existing.projectId)
      .catch((err) => logger.warn({ err: err?.message }, '[notify] completion encouragement failed:'));
  }

  return task;
}

/**
 * Compute today's DONE-transition count for a user + fire the
 * encouragement notification. Shared between updateTask + moveTask
 * so both kanban-drag and form-save paths celebrate the same way.
 *
 * Streak math: counts how many TaskStatusHistory rows the user
 * authored today with `toStatus=DONE`, including the one that
 * JUST landed.
 */
async function fireCompletionEncouragement(
  taskId: string,
  userId: string,
  taskTitle: string,
  projectId: string,
): Promise<void> {
  // Day window — caller's local day approximated by UTC for now;
  // future revision could take tzOffsetMinutes. For the
  // encouragement use case, UTC day is fine — the worst case is a
  // streak fires a few hours late for someone on the West Coast.
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const completedToday = await prisma.taskStatusHistory.count({
    where: {
      changedBy: userId,
      toStatus: 'DONE',
      changedAt: { gte: startOfDay },
    },
  });

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { name: true },
  });
  await notifyTaskCompletionEncouragement({
    taskId,
    taskTitle,
    projectId,
    projectName: project?.name ?? 'a project',
    completerId: userId,
    tasksCompletedToday: completedToday,
  });
}

export async function deleteTask(taskId: string, userId: string) {
  // Fetch the fields we need for both the audit log AND the
  // post-delete notification. Pre-2026-05-15 this only grabbed the
  // bare task; the lifecycle audit added assignee/reviewer/creator
  // so we can notify the humans whose work just disappeared.
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      projectId: true,
      title: true,
      assigneeId: true,
      reviewerId: true,
      creatorId: true,
    },
  });
  if (!task) throw new NotFoundError('Task');

  // Wrap deletion + audit log in a transaction so we can never end up in the
  // "task deleted but no audit trail" state on partial failure.
  await prisma.$transaction(async (tx) => {
    await tx.task.delete({ where: { id: taskId } });
    await logActivity({
      userId,
      projectId: task.projectId,
      action: 'deleted_task',
      targetType: 'task',
      targetId: taskId,
      details: { title: task.title },
    }, tx);
  });

  // Notify the humans on the task (assignee + reviewer + creator,
  // minus the deleter). Non-blocking — a notification failure must
  // not roll back a successful delete. Surfaced by the 2026-05-15
  // task-lifecycle audit: deletion was silent for the affected
  // humans, who'd discover the loss only by hitting a stale link.
  const project = await prisma.project.findUnique({
    where: { id: task.projectId },
    select: { name: true },
  });
  notifyTaskDeleted({
    taskId,
    projectId: task.projectId,
    taskTitle: task.title,
    projectName: project?.name ?? 'Unknown',
    deletedBy: userId,
    assigneeId: task.assigneeId,
    reviewerId: task.reviewerId,
    creatorId: task.creatorId,
  }).catch((err) => logger.warn({ err: err?.message }, '[notify] notifyTaskDeleted failed:'));
}

/**
 * Nudge a teammate about a task. Sends a notification to the task's
 * current assignee from the requesting user.
 *
 * Anti-spam: 24h cooldown per (task, sender) pair. The second nudge
 * inside the window throws ConflictError so the FE can show
 * "you already nudged about this; give them time."
 *
 * Refused when:
 *   - the task has no assignee (nobody to nudge)
 *   - sender IS the assignee (no self-nudge — would be silly)
 *   - sender has nudged this task within the last 24h
 *
 * Activity log: every successful nudge writes a `nudged_task` row
 * + a TaskNudge row (the dedicated audit + cooldown table).
 */
export async function nudgeTask(
  taskId: string,
  senderId: string,
  message: string | null,
): Promise<void> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      projectId: true,
      title: true,
      assigneeId: true,
      // 2026-05-22 Pankaj policy: include userType so the FE can mask
      // agent identities for CLIENT viewers (show "Internal team"
      // instead of e.g. Manjari). Backwards-compat — additive field.
      assignee: { select: { id: true, name: true, userType: true } },
      project: { select: { name: true } },
    },
  });
  if (!task) throw new NotFoundError('Task');

  if (!task.assigneeId) {
    throw new ValidationError('This task has no assignee — nobody to nudge.');
  }
  if (task.assigneeId === senderId) {
    throw new ValidationError('You can\'t nudge yourself.');
  }

  // Cooldown: refuse a second nudge from the same sender on the
  // same task within the last 24h. Implemented as a single
  // findFirst on the (taskId, senderId, createdAt) index.
  const cooldownCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await prisma.taskNudge.findFirst({
    where: {
      taskId,
      senderId,
      createdAt: { gte: cooldownCutoff },
    },
    select: { createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  if (recent) {
    const minutesLeft = Math.ceil(
      (recent.createdAt.getTime() + 24 * 60 * 60 * 1000 - Date.now()) / 60_000,
    );
    const hoursLeft = Math.max(1, Math.ceil(minutesLeft / 60));
    throw new ConflictError(
      `You already nudged this task. Try again in ${hoursLeft} ${hoursLeft === 1 ? 'hour' : 'hours'}.`,
    );
  }

  const sender = await prisma.user.findUnique({
    where: { id: senderId },
    select: { name: true },
  });

  // Record the nudge (audit + cooldown trail) + write activity log
  // in one transaction. The notification fires after the tx
  // commits (fire-and-forget) so a notification failure doesn't
  // undo the recorded nudge.
  await prisma.$transaction(async (tx) => {
    await tx.taskNudge.create({
      data: {
        taskId,
        senderId,
        message: message ?? null,
      },
    });
    await logActivity({
      userId: senderId,
      projectId: task.projectId,
      action: 'nudged_task',
      targetType: 'task',
      targetId: taskId,
      details: {
        title: task.title,
        recipientId: task.assigneeId,
        hasMessage: !!message,
      },
    }, tx);
  });

  notifyTaskNudge({
    taskId,
    taskTitle: task.title,
    projectId: task.projectId,
    projectName: task.project.name ?? 'a project',
    nudgedUserId: task.assigneeId,
    nudgerName: sender?.name ?? 'A teammate',
    message: message ?? null,
  }).catch((err) => logger.warn({ err: err?.message }, '[notify] notifyTaskNudge failed:'));
}

// ─── Bulk ops ────────────────────────────────────────────────────────────
//
// Both bulk paths share the same shape:
//   1. Load every task in one query (avoids N+1 round trips on auth + reads).
//   2. Group by project so we run the per-project membership check exactly
//      once — not once per task.
//   3. Apply per-task with a granular result list — partial failures are
//      reported back rather than rolled back wholesale. This matches the
//      "21 succeeded, 2 blocked by AC done-gate" UX the FE wants to show.
//
// `taskIds` is already capped at MAX_BULK by the validator. The whole
// operation is best-effort serial; if 200 tasks each take ~10ms this is
// still <2s, well inside the request timeout. Chasing further parallelism
// would gain little and risk row-lock contention on the same project's
// `tasks` table.

interface BulkResult {
  taskId: string;
  ok: boolean;
  error?: string;
}

interface BulkChangeFields {
  sprintId?: string | null;
  epicId?: string | null;
  assigneeId?: string | null;
  status?: TaskStatus;
  priority?: import('@prisma/client').TaskPriority;
  isBlocked?: boolean;
  blockerNote?: string | null;
}

/**
 * Apply the same patch to many tasks. Per-task auth: caller must hold
 * `task.edit_any` OR be the assignee/creator AND a current member of the
 * task's project. Per-task validation: assigneeId must be a member of the
 * task's project; sprintId / epicId must belong to the same project as
 * the task (cross-project moves are rejected).
 */
export async function bulkUpdateTasks(
  taskIds: string[],
  change: BulkChangeFields,
  userId: string,
  userRole: UserRole,
  userType: 'HUMAN' | 'AGENT' = 'HUMAN',
): Promise<{ results: BulkResult[]; succeeded: number; failed: number }> {
  if (taskIds.length === 0) return { results: [], succeeded: 0, failed: 0 };

  const canEditAny = await checkPermission(userRole, 'task.edit_any');

  // Single load — selects the columns we need for auth + scoping AND the
  // current values of every field bulk-edit can touch, so the audit row
  // can record a real before/after diff per task instead of just the keys
  // that changed (Round 2 follow-up #5: previously `details: { changedKeys }`
  // told you "priority changed on 200 tasks" but not WHAT it changed from
  // and to per task — useless for forensic audit).
  //
  // Includes the parent sprint's status so we can refuse to drain a
  // COMPLETED/CANCELLED sprint via bulk-edit (pre-launch finding B2 —
  // matches the invariant assignTaskToSprint enforces in the single-task
  // path).
  const tasks = await prisma.task.findMany({
    where: { id: { in: taskIds } },
    select: {
      id: true,
      projectId: true,
      assigneeId: true,
      creatorId: true,
      status: true,
      isBlocked: true,
      blockerNote: true,
      sprintId: true,
      epicId: true,
      priority: true,
      sprint: { select: { status: true } },
    },
  });
  const tasksById = new Map(tasks.map((t) => [t.id, t]));

  // Pre-fetch caller's memberships once. Used for the per-project gate
  // that updateTask runs (QA finding #8 — defense-in-depth even for the
  // assignee/creator branch).
  const projectIds = Array.from(new Set(tasks.map((t) => t.projectId)));
  const memberRows = await prisma.projectMember.findMany({
    where: { userId, projectId: { in: projectIds } },
    select: { projectId: true },
  });
  const memberOfProject = new Set(memberRows.map((m) => m.projectId));

  // If sprintId or epicId is in the change, validate they belong to ALL
  // referenced projects. We refuse to move tasks across project boundaries
  // even in bulk — same invariant assignTaskToSprint enforces 1:1.
  const sprintProject = new Map<string, string>(); // sprintId → projectId
  const epicProject = new Map<string, string>();
  if (change.sprintId) {
    const s = await prisma.sprint.findUnique({
      where: { id: change.sprintId },
      select: { id: true, projectId: true, status: true },
    });
    if (!s) {
      // No sprint → fail every task. Mirrors single-task behavior.
      return {
        results: taskIds.map((id) => ({ taskId: id, ok: false, error: 'Sprint not found' })),
        succeeded: 0,
        failed: taskIds.length,
      };
    }
    if (s.status === 'COMPLETED' || s.status === 'CANCELLED') {
      return {
        results: taskIds.map((id) => ({ taskId: id, ok: false, error: 'Cannot assign tasks to a completed or cancelled sprint' })),
        succeeded: 0,
        failed: taskIds.length,
      };
    }
    sprintProject.set(change.sprintId, s.projectId);
  }
  if (change.epicId) {
    const e = await prisma.epic.findUnique({
      where: { id: change.epicId },
      select: { id: true, projectId: true },
    });
    if (!e) {
      return {
        results: taskIds.map((id) => ({ taskId: id, ok: false, error: 'Epic not found' })),
        succeeded: 0,
        failed: taskIds.length,
      };
    }
    epicProject.set(change.epicId, e.projectId);
  }

  // If assigneeId is set, fetch their memberships once for ALL touched
  // projects. Validation per task then becomes a Set lookup, not a query.
  let assigneeProjectMemberships: Set<string> | null = null;
  if (change.assigneeId) {
    const rows = await prisma.projectMember.findMany({
      where: {
        userId: change.assigneeId,
        projectId: { in: projectIds },
        user: { isActive: true },
      },
      select: { projectId: true },
    });
    assigneeProjectMemberships = new Set(rows.map((r) => r.projectId));
  }

  // Cap concurrent per-task transactions. Each worker holds ONE connection
  // for its `prisma.$transaction`, so this directly competes with the
  // app's connection pool. Prisma's default pool size (`num_physical_cpus
  // * 2 + 1`) is typically 9–17 on PaaS dyno-class hardware — leaving us
  // 1–9 spare connections at concurrency=8. Operators who set
  // `?connection_limit=20` on DATABASE_URL get plenty of headroom; those
  // who don't won't get pool-starvation symptoms during a 200-task bulk
  // (QA K-H1: previous comment claimed "pool is 20" but no config
  // actually set it).
  //
  // Round 2 follow-up #14 originally raised this to 16 from serial; 8 is
  // the safer default. A 200-task batch at ~5ms median per task lands at
  // ~150ms wall — still 25× faster than serial, two-thirds the speed of
  // 16-way without the starvation risk. Bump back up if/when DATABASE_URL
  // is documented to carry `?connection_limit=20+`.
  const PER_TASK_CONCURRENCY = 8;

  // Process a single task — pure function over the captured maps above.
  // Returns the BulkResult to push into the aggregate; never throws (any
  // surprise bubbles up as `ok: false` so one bad task can't poison the
  // whole batch).
  const runOne = async (id: string): Promise<BulkResult> => {
    const task = tasksById.get(id);
    if (!task) {
      return { taskId: id, ok: false, error: 'Task not found' };
    }

    // Authorization. Mirrors the single-task `updateTask` rules:
    //   - Membership in the task's project is ALWAYS required, even for
    //     `task.edit_any` holders (QA finding K-C1: previously
    //     `task.edit_any` short-circuited the membership check, so a
    //     PRODUCT_MANAGER with that permission could bulk-PATCH tasks in
    //     projects they were never added to. Single-task `updateTask`
    //     enforces membership uniformly; the bulk path now matches.)
    //   - Without `task.edit_any`, the user additionally must be the
    //     assignee or creator.
    if (!memberOfProject.has(task.projectId)) {
      return { taskId: id, ok: false, error: 'Not a member of this project' };
    }
    if (!canEditAny && task.assigneeId !== userId && task.creatorId !== userId) {
      return { taskId: id, ok: false, error: 'Not authorized to edit this task' };
    }

    // Source-sprint terminal-state guard. If this bulk-edit would change
    // the task's sprintId (set or unset), the task can't currently live in
    // a COMPLETED/CANCELLED sprint — same invariant as the single-task
    // `assignTaskToSprint` (sprint.service.ts). Without this, a bulk
    // "move to backlog" silently drains a frozen sprint and rewrites
    // historical velocity (pre-launch finding B2).
    if (change.sprintId !== undefined &&
        (task.sprint?.status === 'COMPLETED' || task.sprint?.status === 'CANCELLED')) {
      return { taskId: id, ok: false, error: 'Cannot move a task out of a completed or cancelled sprint' };
    }

    // Cross-project guards.
    if (change.sprintId !== undefined && change.sprintId !== null && sprintProject.get(change.sprintId) !== task.projectId) {
      return { taskId: id, ok: false, error: 'Sprint belongs to a different project' };
    }
    if (change.epicId !== undefined && change.epicId !== null && epicProject.get(change.epicId) !== task.projectId) {
      return { taskId: id, ok: false, error: 'Epic belongs to a different project' };
    }
    if (change.assigneeId && assigneeProjectMemberships && !assigneeProjectMemberships.has(task.projectId)) {
      return { taskId: id, ok: false, error: 'Assignee is not a member of this project' };
    }

    // Compose the final update — strip undefined keys so we don't write
    // nulls accidentally. blockerNote pairs with isBlocked: setting
    // unblocked also wipes the note.
    const updateData: any = {};
    if (change.sprintId !== undefined) updateData.sprintId = change.sprintId;
    if (change.epicId !== undefined) updateData.epicId = change.epicId;
    if (change.assigneeId !== undefined) updateData.assigneeId = change.assigneeId;
    if (change.status !== undefined) updateData.status = change.status;
    if (change.priority !== undefined) updateData.priority = change.priority;
    if (change.isBlocked !== undefined) {
      updateData.isBlocked = change.isBlocked;
      if (change.isBlocked === false) {
        updateData.blockerNote = null;
      } else if (change.blockerNote !== undefined) {
        updateData.blockerNote = change.blockerNote;
      }
    } else if (change.blockerNote !== undefined) {
      updateData.blockerNote = change.blockerNote;
    }

    // Bulk status moves run the SAME state-machine + AC done-gate + assignee
    // gate that updateTask/moveTask run, so the bulk path can't sidestep
    // PR #38's "Done means Done" invariant or the "active work needs an
    // owner" rule. Each task validates independently → partial failure
    // (e.g. "move 50 to In Progress" fails only the unassigned ones, with a
    // clear per-task reason).
    if ('status' in updateData) {
      const next = updateData.status as TaskStatus;
      // Re-fetch full task with acceptanceCriteria + assigneeId — the
      // auth-time select doesn't include them.
      const fresh = await prisma.task.findUnique({
        where: { id },
        select: { status: true, acceptanceCriteria: true, assigneeId: true },
      });
      if (!fresh) {
        return { taskId: id, ok: false, error: 'Task not found' };
      }
      try {
        assertLegalTransition(fresh.status, next);
        enforceDoneGate(fresh as { acceptanceCriteria: unknown }, next);
        await enforceAgentDoneGate(next, { userType, role: userRole });
        // A new assigneeId in the SAME bulk change wins over the task's
        // current assignee — so "assign to X + move to In Progress" in one
        // batch passes; moving an unassigned task with no assignee in the
        // change fails just that task.
        assertAssigneeForActiveStatus(
          next,
          'assigneeId' in updateData ? updateData.assigneeId : fresh.assigneeId,
        );
      } catch (err: any) {
        return { taskId: id, ok: false, error: err?.message ?? 'Status transition rejected' };
      }
    }

    // Compose a per-key before/after diff. Only includes keys that
    // ACTUALLY changed (skip the "Reset to Medium on tasks that were
    // already Medium" case — saves audit-log bytes and reads cleanly when
    // a reviewer is sweeping for "what changed" later). Round 2 #5.
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    if ('sprintId' in updateData && updateData.sprintId !== task.sprintId) {
      diff.sprintId = { from: task.sprintId, to: updateData.sprintId };
    }
    if ('epicId' in updateData && updateData.epicId !== task.epicId) {
      diff.epicId = { from: task.epicId, to: updateData.epicId };
    }
    if ('assigneeId' in updateData && updateData.assigneeId !== task.assigneeId) {
      diff.assigneeId = { from: task.assigneeId, to: updateData.assigneeId };
    }
    if ('status' in updateData && updateData.status !== task.status) {
      diff.status = { from: task.status, to: updateData.status };
    }
    if ('priority' in updateData && updateData.priority !== task.priority) {
      diff.priority = { from: task.priority, to: updateData.priority };
    }
    if ('isBlocked' in updateData && updateData.isBlocked !== task.isBlocked) {
      diff.isBlocked = { from: task.isBlocked, to: updateData.isBlocked };
    }
    if ('blockerNote' in updateData && updateData.blockerNote !== task.blockerNote) {
      diff.blockerNote = { from: task.blockerNote, to: updateData.blockerNote };
    }

    try {
      await prisma.$transaction(async (tx) => {
        await tx.task.update({ where: { id }, data: updateData });
        await logActivity({
          userId,
          projectId: task.projectId,
          action: 'bulk_updated_task',
          targetType: 'task',
          targetId: id,
          // `changes` is the per-field diff; `changedKeys` kept for
          // backward compat with any consumer (admin trail UI) that
          // hasn't migrated to the richer shape yet.
          details: { changes: diff, changedKeys: Object.keys(diff) },
        }, tx);
      });

      // Notify on assignee change — non-blocking. Same notify dance the
      // single-task path runs; we run after the tx commits to avoid stale
      // reads if the notify fan-out ever started touching tasks.
      if (change.assigneeId && change.assigneeId !== task.assigneeId) {
        const project = await prisma.project.findUnique({ where: { id: task.projectId }, select: { name: true } });
        const t = await prisma.task.findUnique({ where: { id }, select: { title: true } });
        notifyTaskAssigned(id, change.assigneeId, t?.title || '', project?.name || 'Unknown', userId, task.projectId)
          .catch((err) => logger.warn({ err: err?.message }, '[notify] notifyTaskAssigned (bulk) failed:'));
      }
      // Notify on first-time block — same pattern.
      if (change.isBlocked === true && !task.isBlocked) {
        const project = await prisma.project.findUnique({ where: { id: task.projectId }, select: { name: true } });
        const t = await prisma.task.findUnique({ where: { id }, select: { title: true } });
        notifyTaskBlocked(id, task.projectId, t?.title || '', project?.name || 'Unknown')
          .catch((err) => logger.warn({ err: err?.message }, '[notify] notifyTaskBlocked (bulk) failed:'));
      }

      return { taskId: id, ok: true };
    } catch (err: any) {
      return { taskId: id, ok: false, error: err?.message ?? 'Update failed' };
    }
  };

  // Run with bounded concurrency. Tiny inline limiter — no need for a
  // dependency just to cap a Promise.all. Order of completion is
  // non-deterministic but the `results` array preserves taskIds order
  // because we splice each result back into its source slot.
  const results: BulkResult[] = new Array(taskIds.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(PER_TASK_CONCURRENCY, taskIds.length) }, async () => {
    while (true) {
      const myIdx = cursor++;
      if (myIdx >= taskIds.length) return;
      results[myIdx] = await runOne(taskIds[myIdx]);
    }
  });
  await Promise.all(workers);

  const succeeded = results.filter((r) => r.ok).length;
  return { results, succeeded, failed: results.length - succeeded };
}

/**
 * Bulk delete. Per-task `task.delete` permission is required (route also
 * gates on it); membership in the task's project is required uniformly.
 *
 * Pre-launch finding H1: `project.view_all` is a *view* permission and was
 * previously used here as a "skip the membership check" override, which
 * meant a super-admin with view_all could delete tasks in projects they
 * don't belong to. The single-task `deleteTask` doesn't allow that. We now
 * require membership uniformly; a super-admin who is also a member acts
 * unimpeded, but cross-project deletion needs an explicit join first.
 */
/**
 * Preview what cascade-deletes if we run `bulkDeleteTasks(taskIds)`. Used by
 * the confirm dialog so the user sees "12 comments + 3.5h logged + 2 PRs
 * will also be deleted" before they hit OK (QA finding K-C2: a 50-task
 * bulk delete could destroy hours of timesheet data with no warning).
 *
 * **Membership gate (added 2026-05-15 sweep #1):** filter the supplied
 * taskIds down to only those in projects the caller is a member of
 * BEFORE running the aggregates. The original implementation
 * intentionally skipped per-task membership checks under the reasoning
 * that "this is read-only and the same data is already visible per-task
 * to anyone with project access" — but that reasoning is wrong. Aggregate
 * counts (comment count, total logged hours, time-entry count) are NOT
 * "already visible to anyone" — they require project membership to see.
 * A PM in Project A who learned task IDs from Project B (e.g., via a
 * shared Slack screenshot) could use this endpoint to exfiltrate
 * activity-volume metrics for tasks they have no business reading.
 *
 * The fix mirrors `bulkDeleteTasks`'s membership check: super-admins
 * (`project.view_all`) bypass; everyone else gets their taskIds
 * intersected against their project memberships, and the aggregates
 * only run on the survivors. taskCount reflects the post-filter count
 * so the FE confirm dialog shows the truthful number.
 */
export async function previewBulkDeleteCascade(
  taskIds: string[],
  userId: string,
  userRole: UserRole,
) {
  if (taskIds.length === 0) {
    return { taskCount: 0, comments: 0, timeEntries: 0, loggedHours: 0, externalLinks: 0, taskLinks: 0, statusHistory: 0 };
  }

  // ── Filter taskIds to caller-authorized ones ────────────────────
  const tasks = await prisma.task.findMany({
    where: { id: { in: taskIds } },
    select: { id: true, projectId: true },
  });

  const canViewAll = await checkPermission(userRole, 'project.view_all');
  let allowedTaskIds: string[];
  if (canViewAll) {
    allowedTaskIds = tasks.map((t) => t.id);
  } else {
    const projectIds = Array.from(new Set(tasks.map((t) => t.projectId)));
    const memberRows = await prisma.projectMember.findMany({
      where: { userId, projectId: { in: projectIds } },
      select: { projectId: true },
    });
    const memberOfProject = new Set(memberRows.map((r) => r.projectId));
    allowedTaskIds = tasks.filter((t) => memberOfProject.has(t.projectId)).map((t) => t.id);
  }

  if (allowedTaskIds.length === 0) {
    return { taskCount: 0, comments: 0, timeEntries: 0, loggedHours: 0, externalLinks: 0, taskLinks: 0, statusHistory: 0 };
  }

  const [comments, timeEntries, hoursAgg, externalLinks, taskLinksFrom, taskLinksTo, statusHistory] = await Promise.all([
    prisma.comment.count({ where: { taskId: { in: allowedTaskIds } } }),
    prisma.timeEntry.count({ where: { taskId: { in: allowedTaskIds } } }),
    prisma.timeEntry.aggregate({ where: { taskId: { in: allowedTaskIds } }, _sum: { hours: true } }),
    prisma.taskExternalLink.count({ where: { taskId: { in: allowedTaskIds } } }),
    prisma.taskLink.count({ where: { fromTaskId: { in: allowedTaskIds } } }),
    prisma.taskLink.count({ where: { toTaskId: { in: allowedTaskIds } } }),
    prisma.taskStatusHistory.count({ where: { taskId: { in: allowedTaskIds } } }),
  ]);
  return {
    taskCount: allowedTaskIds.length,
    comments,
    timeEntries,
    loggedHours: Number(hoursAgg._sum.hours ?? 0),
    externalLinks,
    taskLinks: taskLinksFrom + taskLinksTo,
    statusHistory,
  };
}

export async function bulkDeleteTasks(
  taskIds: string[],
  userId: string,
  userRole: UserRole,
): Promise<{ results: BulkResult[]; succeeded: number; failed: number }> {
  if (taskIds.length === 0) return { results: [], succeeded: 0, failed: 0 };

  const canDelete = await checkPermission(userRole, 'task.delete');
  if (!canDelete) {
    return {
      results: taskIds.map((id) => ({ taskId: id, ok: false, error: 'Insufficient permissions' })),
      succeeded: 0,
      failed: taskIds.length,
    };
  }

  const tasks = await prisma.task.findMany({
    where: { id: { in: taskIds } },
    select: { id: true, projectId: true, title: true },
  });
  const tasksById = new Map(tasks.map((t) => [t.id, t]));

  // Always require membership of the task's project. Aligned with the
  // single-task `deleteTask` path; closes the divergence H1 flagged.
  const projectIds = Array.from(new Set(tasks.map((t) => t.projectId)));
  const memberRows = await prisma.projectMember.findMany({
    where: { userId, projectId: { in: projectIds } },
    select: { projectId: true },
  });
  const memberOfProject = new Set(memberRows.map((r) => r.projectId));

  const results: BulkResult[] = [];

  for (const id of taskIds) {
    const task = tasksById.get(id);
    if (!task) {
      results.push({ taskId: id, ok: false, error: 'Task not found' });
      continue;
    }
    if (!memberOfProject.has(task.projectId)) {
      results.push({ taskId: id, ok: false, error: 'Not a member of this project' });
      continue;
    }
    try {
      await prisma.$transaction(async (tx) => {
        await tx.task.delete({ where: { id } });
        await logActivity({
          userId,
          projectId: task.projectId,
          action: 'bulk_deleted_task',
          targetType: 'task',
          targetId: id,
          details: { title: task.title },
        }, tx);
      });
      results.push({ taskId: id, ok: true });
    } catch (err: any) {
      results.push({ taskId: id, ok: false, error: err?.message ?? 'Delete failed' });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  return { results, succeeded, failed: results.length - succeeded };
}

export async function moveTask(
  taskId: string,
  newStatus: TaskStatus,
  sortOrder: number | undefined,
  userId: string,
  user: { userType: 'HUMAN' | 'AGENT'; role: UserRole },
  // 2026-06 collaboration hardening. The board was the ONE mutation with
  // no optimistic-locking guard — two people dragging the same card was a
  // silent last-write-wins. Pass the card's last-known `updatedAt` (from
  // the cache the drag started against); the move is refused if someone
  // else moved it in between. OPT-IN, mirrors updateTask.
  expectedUpdatedAt?: string,
) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new NotFoundError('Task');

  // Fail-fast conflict detection before the state-machine + gate chain.
  if (expectedUpdatedAt && task.updatedAt.toISOString() !== expectedUpdatedAt) {
    throw new ConflictError(
      `This task was moved by someone else. Refresh and try again. (server updatedAt: ${task.updatedAt.toISOString()})`,
    );
  }

  const oldStatus = task.status;

  // State-machine + agent-Done-gate run OUTSIDE the tx — they don't read
  // mutable state (transition map is static; agent gate keys on user+role
  // which can't change for THIS request).
  if (oldStatus !== newStatus) {
    assertLegalTransition(oldStatus, newStatus);
    await enforceAgentDoneGate(newStatus, user);
    // Active statuses need an owner. A drag doesn't change the assignee,
    // so the task's current assignee is the effective one.
    assertAssigneeForActiveStatus(newStatus, task.assigneeId);
  }

  // If no sortOrder provided, append at end
  if (sortOrder === undefined) {
    const maxOrder = await prisma.task.aggregate({
      where: { projectId: task.projectId, status: newStatus },
      _max: { sortOrder: true },
    });
    sortOrder = (maxOrder._max.sortOrder || 0) + 1;
  }

  // Wrap update + status history + activity log atomically. Previously the
  // history write was fire-and-forget (`.catch(() => {})`) which meant a
  // status change could land in the DB without a corresponding history row.
  //
  // 2026-05-23 audit fix: the AC Done-gate now runs INSIDE the transaction
  // by re-reading the task's acceptanceCriteria field at write time. The
  // previous shape (check outside, write inside) had a TOCTOU race — a
  // concurrent AC uncheck between read and write could let a task land
  // in DONE with unchecked AC. Re-reading inside the tx closes the window
  // for the common interleaving; Serializable isolation isn't worth the
  // overhead given the read+write happen back-to-back in the same fork.
  const updated = await prisma.$transaction(async (tx) => {
    if (oldStatus !== newStatus && newStatus === 'DONE') {
      const fresh = await tx.task.findUnique({
        where: { id: taskId },
        select: { acceptanceCriteria: true },
      });
      // Same gate as before, but reading the LATEST acceptanceCriteria
      // — not the snapshot from before any concurrent edit.
      enforceDoneGate({ acceptanceCriteria: fresh?.acceptanceCriteria }, newStatus);
    }

    // 2026-05-22 Pankaj policy: include userType so the FE can mask agent
    // identities for CLIENT viewers (show "Internal team" instead of e.g.
    // Manjari). Backwards-compat — additive field.
    const moveInclude = {
      assignee: { select: { id: true, name: true, userType: true } },
      creator: { select: { id: true, name: true } },
    };

    let result;
    if (expectedUpdatedAt) {
      // Race-safe write: guard on updatedAt so a move that lost the race
      // between the fail-fast check above and here surfaces as a 409
      // rather than clobbering the other person's move.
      const guarded = await tx.task.updateMany({
        where: { id: taskId, updatedAt: task.updatedAt },
        data: { status: newStatus, sortOrder },
      });
      if (guarded.count === 0) {
        const current = await tx.task.findUnique({
          where: { id: taskId },
          select: { updatedAt: true },
        });
        throw new ConflictError(
          `This task was moved by someone else. Refresh and try again. (server updatedAt: ${current?.updatedAt.toISOString() ?? 'unknown'})`,
        );
      }
      const inner = await tx.task.findUnique({ where: { id: taskId }, include: moveInclude });
      if (!inner) throw new NotFoundError('Task');
      result = inner;
    } else {
      result = await tx.task.update({
        where: { id: taskId },
        data: { status: newStatus, sortOrder },
        include: moveInclude,
      });
    }

    if (oldStatus !== newStatus) {
      await tx.taskStatusHistory.create({
        data: { taskId, fromStatus: oldStatus, toStatus: newStatus, changedBy: userId },
      });
      await emitTaskClosedEvent(tx, taskId, oldStatus, newStatus, userId, task);
    }

    await logActivity({
      userId,
      projectId: task.projectId,
      action: 'moved_task',
      targetType: 'task',
      targetId: taskId,
      details: { title: task.title, from: oldStatus, to: newStatus },
    }, tx);

    return result;
  });

  // Encouragement on DONE transition (CC feature 2026-05-20).
  // Mirror of the updateTask path so kanban-drag completions
  // celebrate the same way as form-save completions.
  if (oldStatus !== newStatus && newStatus === 'DONE') {
    fireCompletionEncouragement(taskId, userId, task.title, task.projectId)
      .catch((err) => logger.warn({ err: err?.message }, '[notify] completion encouragement failed:'));
  }

  return updated;
}

export async function reorderTask(taskId: string, newSortOrder: number) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new NotFoundError('Task');

  return prisma.task.update({
    where: { id: taskId },
    data: { sortOrder: newSortOrder },
  });
}

/* ─────────────────────────────────────────────────────────────────────────────
   Review workflow (PR B, feature #5).

   Two service entry points:
     - `requestReview` — explicit handoff. Sets reviewer fields, moves the
        task to IN_REVIEW (if it isn't already), optionally posts a note as
        a Comment, notifies the reviewer, logs activity.
     - `decideReview`  — the reviewer (or admin) approves or asks for
        changes. APPROVE → DONE through the same Done-gate kanban-drag
        uses; REQUEST_CHANGES → IN_PROGRESS and REQUIRES a comment.
        Either path clears the reviewer fields so the task is "ready for
        next" cleanly.

   Authorization model:
     - `requestReview` requires the role permission `task.request_review`
        AND project membership. Assignee + creator may also request a
        review on their OWN task without that permission (covers the
        engineer-handing-to-PM case for an org that revokes the role
        permission from engineers).
     - `decideReview` uses ROW-LEVEL authorisation: `task.reviewerId ===
        actor.id` or actor is SUPER_ADMIN / ADMIN. No role permission
        needed — the data IS the gate.
   ─────────────────────────────────────────────────────────────────── */

interface ReviewActor {
  id: string;
  role: UserRole;
  userType: 'HUMAN' | 'AGENT';
}

export async function requestReview(
  taskId: string,
  reviewerId: string,
  note: string | null,
  actor: ReviewActor,
) {
  if (!reviewerId) throw new ValidationError('reviewerId is required');
  if (reviewerId === actor.id) {
    throw new ValidationError('Cannot request a review from yourself');
  }

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new NotFoundError('Task');

  // Done isn't a state you "send for review" from — finishing review IS
  // what gets you to Done. Refuse early so the UI's surfaced action set
  // matches what the server accepts.
  if (task.status === 'DONE') {
    throw new ValidationError('This task is already Done — reopen it before requesting review');
  }
  if (task.status === 'BACKLOG') {
    // assertLegalTransition would also catch this (BACKLOG → IN_REVIEW
    // is illegal), but a hand-crafted error message reads better.
    throw new ValidationError('Move the task out of Backlog before requesting review');
  }

  // Permission check: role-permission OR own task.
  const canRequestRole = await checkPermission(actor.role, 'task.request_review');
  const isOwn = task.assigneeId === actor.id || task.creatorId === actor.id;
  if (!canRequestRole && !isOwn) {
    throw new ForbiddenError('You do not have permission to request a review on this task');
  }

  // Verify the actor is a member of the project (defense in depth on top
  // of the projectAccess middleware that gated the route).
  const actorMembership = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId: actor.id, projectId: task.projectId } },
    select: { id: true },
  });
  if (!actorMembership && !['SUPER_ADMIN', 'ADMIN'].includes(actor.role)) {
    throw new ForbiddenError('Not a member of this project');
  }

  // Reviewer must also be a project member. We allow CLIENT members (the
  // whole point of this feature) — the membership check is role-blind.
  // We also require the reviewer's user account to be active so a
  // deactivated account can't be tagged.
  const reviewerMembership = await prisma.projectMember.findFirst({
    where: {
      projectId: task.projectId,
      userId: reviewerId,
      user: { isActive: true },
    },
    select: { id: true, user: { select: { id: true, name: true, role: true } } },
  });
  if (!reviewerMembership) {
    throw new ValidationError('Reviewer must be an active member of this project');
  }

  // State machine + agent gate. We're not approving (target is IN_REVIEW,
  // not DONE), so enforceDoneGate doesn't apply, but the legal-transition
  // gate is the same one moveTask uses.
  const oldStatus = task.status;
  const targetStatus: TaskStatus = 'IN_REVIEW';
  if (oldStatus !== targetStatus) {
    assertLegalTransition(oldStatus, targetStatus);
  }

  const updated = await prisma.$transaction(async (tx) => {
    // Compute next sortOrder in the target column. We only need this
    // when the task is actually moving columns; staying in IN_REVIEW
    // keeps its sortOrder.
    let nextSortOrder: number | undefined;
    if (oldStatus !== targetStatus) {
      const maxOrder = await tx.task.aggregate({
        where: { projectId: task.projectId, status: targetStatus },
        _max: { sortOrder: true },
      });
      nextSortOrder = (maxOrder._max.sortOrder || 0) + 1;
    }

    const result = await tx.task.update({
      where: { id: taskId },
      data: {
        reviewerId,
        reviewRequestedAt: new Date(),
        reviewRequestedById: actor.id,
        status: targetStatus,
        ...(nextSortOrder !== undefined && { sortOrder: nextSortOrder }),
      },
      include: {
        // 2026-05-22 Pankaj policy: include userType so the FE can mask
      // agent identities for CLIENT viewers (show "Internal team"
      // instead of e.g. Manjari). Backwards-compat — additive field.
      assignee: { select: { id: true, name: true, userType: true } },
        creator: { select: { id: true, name: true } },
        reviewer: { select: { id: true, name: true, role: true } },
        reviewRequester: { select: { id: true, name: true } },
        project: { select: { id: true, name: true, slug: true } },
      },
    });

    if (oldStatus !== targetStatus) {
      await tx.taskStatusHistory.create({
        data: { taskId, fromStatus: oldStatus, toStatus: targetStatus, changedBy: actor.id },
      });
    }

    // Optional note → posted as a comment so it lives next to the task
    // discussion (and shows up in the daily "what shipped today" wrap-up
    // if the task lands today).
    const trimmedNote = (note ?? '').trim();
    if (trimmedNote) {
      await tx.comment.create({
        data: {
          projectId: task.projectId,
          taskId,
          content: trimmedNote,
          authorId: actor.id,
        },
      });
    }

    await logActivity({
      userId: actor.id,
      projectId: task.projectId,
      action: 'review_requested',
      targetType: 'task',
      targetId: taskId,
      details: {
        title: task.title,
        reviewerId,
        reviewerName: reviewerMembership.user.name,
        from: oldStatus,
        to: targetStatus,
      },
    }, tx);

    return result;
  });

  // Notify the reviewer outside the transaction — a notification failure
  // shouldn't roll back the review request itself.
  await notifyReviewRequested({
    taskId,
    projectId: task.projectId,
    taskTitle: task.title,
    projectName: updated.project.name,
    reviewerId,
    requesterName: 'Someone', // overridden below if available
    reviewerIsClient: reviewerMembership.user.role === 'CLIENT',
  }).catch((err) => {
    logger.warn({ err: err?.message }, '[review] notifyReviewRequested failed:');
  });

  // Auto-subscribe the new reviewer (CC feature PR 2026-05-20). They
  // own the next step of the workflow — every comment + edit until
  // they decide matters to them.
  subscribeToTask(taskId, reviewerId, 'AUTO_REVIEWER')
    .catch((err) => logger.warn({ err: err?.message }, '[subscribe] AUTO_REVIEWER failed:'));

  return updated;
}

export async function decideReview(
  taskId: string,
  decision: 'APPROVE' | 'REQUEST_CHANGES',
  comment: string | null,
  actor: ReviewActor,
) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new NotFoundError('Task');

  if (task.status !== 'IN_REVIEW') {
    throw new ValidationError('This task is not currently under review');
  }
  if (!task.reviewerId) {
    // Defensive — shouldn't happen if status is IN_REVIEW + requestReview
    // is the only path in, but rows might exist from before this feature.
    throw new ValidationError('No reviewer is assigned to this task');
  }

  // Row-level authorisation: the designated reviewer can decide, or an
  // admin can override (covers "reviewer is on PTO; admin closes out").
  const isReviewer = task.reviewerId === actor.id;
  const isAdmin = actor.role === 'SUPER_ADMIN' || actor.role === 'ADMIN';
  if (!isReviewer && !isAdmin) {
    throw new ForbiddenError('Only the requested reviewer (or an admin) can decide this review');
  }

  // REQUEST_CHANGES needs a comment. The form prompts for one but we enforce
  // it here too so a hand-crafted POST can't bypass.
  const trimmedComment = (comment ?? '').trim();
  if (decision === 'REQUEST_CHANGES' && trimmedComment.length === 0) {
    throw new ValidationError('A comment is required when requesting changes');
  }

  const targetStatus: TaskStatus = decision === 'APPROVE' ? 'DONE' : 'IN_PROGRESS';

  // The Done-gate (acceptance-criteria + agent gate) applies to APPROVE.
  if (decision === 'APPROVE') {
    enforceDoneGate(task, targetStatus);
    await enforceAgentDoneGate(targetStatus, { userType: actor.userType, role: actor.role });
  }
  // assertLegalTransition isn't needed here — IN_REVIEW → DONE and
  // IN_REVIEW → IN_PROGRESS are both legal under the state machine.

  const updated = await prisma.$transaction(async (tx) => {
    // Recompute sortOrder for the target column so the card lands at the
    // bottom of its new pile (matches moveTask's behaviour).
    const maxOrder = await tx.task.aggregate({
      where: { projectId: task.projectId, status: targetStatus },
      _max: { sortOrder: true },
    });
    const nextSortOrder = (maxOrder._max.sortOrder || 0) + 1;

    const result = await tx.task.update({
      where: { id: taskId },
      data: {
        status: targetStatus,
        sortOrder: nextSortOrder,
        // Clear the review pointer set so the next state is "ready for
        // next" rather than carrying a stale reviewer.
        reviewerId: null,
        reviewRequestedAt: null,
        reviewRequestedById: null,
      },
      include: {
        // 2026-05-22 Pankaj policy: include userType so the FE can mask
      // agent identities for CLIENT viewers (show "Internal team"
      // instead of e.g. Manjari). Backwards-compat — additive field.
      assignee: { select: { id: true, name: true, userType: true } },
        creator: { select: { id: true, name: true } },
        reviewer: { select: { id: true, name: true } },
        project: { select: { id: true, name: true, slug: true } },
      },
    });

    await tx.taskStatusHistory.create({
      data: {
        taskId,
        fromStatus: task.status,
        toStatus: targetStatus,
        changedBy: actor.id,
      },
    });

    if (trimmedComment.length > 0) {
      await tx.comment.create({
        data: {
          projectId: task.projectId,
          taskId,
          content: trimmedComment,
          authorId: actor.id,
        },
      });
    }

    await logActivity({
      userId: actor.id,
      projectId: task.projectId,
      action: decision === 'APPROVE' ? 'review_approved' : 'review_changes_requested',
      targetType: 'task',
      targetId: taskId,
      details: { title: task.title, from: task.status, to: targetStatus },
    }, tx);

    return result;
  });

  // Notify the assignee (or skip if there isn't one — e.g. client-
  // requested tasks may not be assigned yet at the time of decision).
  await notifyReviewDecided({
    taskId,
    projectId: task.projectId,
    taskTitle: task.title,
    projectName: updated.project.name,
    assigneeId: updated.assignee?.id ?? null,
    reviewerName: 'A reviewer', // overridden by upstream if needed
    decision,
  }).catch((err) => {
    logger.warn({ err: err?.message }, '[review] notifyReviewDecided failed:');
  });

  return updated;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Subtasks + Acceptance Criteria

   Both are stored as JSON arrays of `{ id, text, done }` on Task. They share
   identical update semantics — bulk-replace the whole array — so we share the
   same internal helper. The route exposes them as two endpoints for clarity
   (and so a future migration to separate tables is a clean swap).
   ─────────────────────────────────────────────────────────────────────────── */

type ChecklistItem = { id: string; text: string; done: boolean };

function sanitizeChecklist(input: unknown): ChecklistItem[] {
  if (!Array.isArray(input)) {
    throw new ValidationError('Expected an array of checklist items.');
  }
  return input.map((raw, idx) => {
    if (!raw || typeof raw !== 'object') {
      throw new ValidationError(`Item ${idx}: expected an object with id, text, done.`);
    }
    const item = raw as Record<string, unknown>;
    const text = typeof item.text === 'string' ? item.text.trim() : '';
    if (text.length === 0) {
      throw new ValidationError(`Item ${idx}: text is required.`);
    }
    if (text.length > 500) {
      throw new ValidationError(`Item ${idx}: text exceeds 500 characters.`);
    }
    const id = typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 64
      ? item.id
      // Generate a stable id if missing — works on Node 18+
      : (globalThis as any).crypto?.randomUUID?.() ?? `c_${Date.now()}_${idx}`;
    return { id, text, done: item.done === true };
  });
}

async function updateChecklistField(
  taskId: string,
  field: 'subtasks' | 'acceptanceCriteria',
  rawItems: unknown,
  userId: string,
) {
  const items = sanitizeChecklist(rawItems);
  // Hard cap to defend against runaway client payloads (huge arrays would
  // bloat the row and slow up every task fetch).
  if (items.length > 50) {
    throw new ValidationError('Up to 50 items allowed.');
  }

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw new NotFoundError('Task');

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.task.update({
      where: { id: taskId },
      data: { [field]: items },
      include: {
        // 2026-05-22 Pankaj policy: include userType so the FE can mask
      // agent identities for CLIENT viewers (show "Internal team"
      // instead of e.g. Manjari). Backwards-compat — additive field.
      assignee: { select: { id: true, name: true, userType: true } },
        creator: { select: { id: true, name: true } },
      },
    });
    await logActivity({
      userId,
      projectId: task.projectId,
      action: field === 'subtasks' ? 'updated_subtasks' : 'updated_acceptance_criteria',
      targetType: 'task',
      targetId: taskId,
      details: { count: items.length, done: items.filter((i) => i.done).length },
    }, tx);
    return result;
  });

  return updated;
}

export function updateSubtasks(taskId: string, items: unknown, userId: string) {
  return updateChecklistField(taskId, 'subtasks', items, userId);
}

export function updateAcceptanceCriteria(taskId: string, items: unknown, userId: string) {
  return updateChecklistField(taskId, 'acceptanceCriteria', items, userId);
}

export async function getMyTasks(userId: string, userRole: UserRole) {
  // Filter to tasks the user can ACTUALLY open. Mirrors `taskAccess`
  // middleware logic so the dashboard's contract is honest: every task
  // shown is clickable.
  //
  // Team feedback #8: previously this returned every task where
  // assigneeId = userId regardless of project membership, so an engineer
  // could see (on their dashboard) tasks in a project they were no longer
  // a member of — clicking returned "Task not found" because the detail-
  // page fetch hit a 403 from taskAccess middleware.
  //
  // Users with `project.view_all` (admins/super-admins) skip the
  // membership filter — they can open tasks in any project, so showing
  // every assignment is correct for them. Everyone else is filtered to
  // tasks in projects they're a current member of.
  const canViewAllProjects = await checkPermission(userRole, 'project.view_all');

  const where: any = { assigneeId: userId };
  if (!canViewAllProjects) {
    const memberships = await prisma.projectMember.findMany({
      where: { userId },
      select: { projectId: true },
    });
    where.projectId = { in: memberships.map((m) => m.projectId) };
  }

  // Hide DONE tasks older than 60 days from "My Tasks" so a long-tenured
  // engineer doesn't load 1000+ rows on each dashboard render (QA K-H5).
  // Active tasks always show; recently-completed tasks (within 60 days)
  // also show so users have a "what did I just finish" view. Older done
  // tasks are still reachable via project boards.
  const SIXTY_DAYS_AGO = new Date(Date.now() - 60 * 86_400_000);
  where.OR = [
    { status: { not: 'DONE' } },
    { status: 'DONE', updatedAt: { gte: SIXTY_DAYS_AGO } },
  ];

  return prisma.task.findMany({
    where,
    include: {
      project: { select: { id: true, name: true, slug: true } },
      // 2026-05-22 Pankaj policy: include userType so the FE can mask
      // agent identities for CLIENT viewers (show "Internal team"
      // instead of e.g. Manjari). Backwards-compat — additive field.
      assignee: { select: { id: true, name: true, userType: true } },
      creator: { select: { id: true, name: true } },
      sprint: { select: { id: true, name: true, number: true } },
      epic: { select: { id: true, title: true, color: true } },
      _count: { select: { comments: true } },
    },
    orderBy: [{ priority: 'asc' }, { dueDate: 'asc' }],
    // Hard cap so even with the 60-day filter someone can't blow up the
    // dashboard by being assigned 500 active tasks. 200 covers any
    // realistic individual workload while keeping the response sub-50ms.
    take: 200,
  });
}
