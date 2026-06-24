import prisma from '../config/database';
import { ForbiddenError } from '../utils/errors';
import { logger } from '../lib/logger';
import { evaluateAgentReadiness } from '../lib/taskReadiness';
import type { Task, TaskPriority, TaskStatus } from '@prisma/client';

/**
 * 2026-05-23 — Layer 2 / agent control plane.
 *
 * `getNextTaskForAgent` — returns the single highest-priority,
 * unblocked, ready-to-work task assigned to the calling agent. Lets a
 * runtime call ONE endpoint per work cycle instead of fetching every
 * assigned task and re-implementing the selection heuristic.
 *
 * Selection contract (in order):
 *
 *   1. Assignee filter: `task.assigneeId === agentUserId`.
 *      An agent only works on tasks it owns. Helper tasks for the
 *      agent's review of someone else's PR are out of scope here —
 *      that's the review workflow, separate endpoint.
 *
 *   2. Status filter: `status NOT IN (DONE, IN_REVIEW)`.
 *      DONE is finished work. IN_REVIEW is human-only by design (see
 *      `enforceAgentDoneGate` + the review workflow) — an agent cannot
 *      action its own task in review.
 *
 *   3. Block filter: `task.isBlocked === false`.
 *      The blocker note exists for a reason — the team has flagged this
 *      task as gated on something external. Skip until unblocked.
 *
 *   4. Decline filter: tasks the agent has declined are not surfaced.
 *      (Not yet implemented — Task has no decline mechanism today.)
 *
 *   5. Dependency filter: tasks where ANY incoming BLOCKS link points
 *      to a not-yet-DONE blocker are skipped. This is the soft
 *      dependency graph the team uses on the kanban — "A blocks B"
 *      means B can't start until A is done.
 *
 *   6. Sprint preference: if the project has an ACTIVE sprint and the
 *      task is in that sprint, it beats a same-priority task NOT in
 *      that sprint. The team's current focus wins.
 *
 *   7. Priority order: P0 > P1 > P2 > P3. Standard.
 *
 *   8. Due-date tiebreaker: among same-priority, sprint-membership
 *      tasks, the one whose dueDate is sooner (or overdue) wins. NULL
 *      dueDates come last.
 *
 *   9. Stable tiebreaker: by `createdAt` ascending so two identical
 *      tasks deterministically pick the older one. Avoids agent
 *      thrashing between two "equally next" tasks across calls.
 *
 * Authorization:
 *
 *   - Caller MUST have `userType === 'AGENT'`. The endpoint is shaped
 *     for the agent runtime; humans have richer UI surfaces. Calling
 *     as a human → 403.
 *   - Caller can only retrieve their OWN next task. The `agentUserId`
 *     argument is always `req.user.id` — no admin-impersonates path.
 *     (A future "what's next for agent X" admin surface would be a
 *     separate endpoint with its own auth.)
 *
 * Returns:
 *
 *   - `null` when nothing is ready — runtime should idle / poll later.
 *   - The selected task with enough context to start work:
 *       id, taskNumber, title, description, status, priority, sprintId,
 *       dueDate, acceptanceCriteria (so the agent knows "what does done
 *       look like"), incomingBlocks (so it can see which tasks were
 *       gating, in case the unblock just happened).
 *
 * Performance:
 *
 *   - One DB round-trip for candidate tasks (indexed on assigneeId).
 *   - One DB round-trip for incoming BLOCKS links among candidate ids.
 *   - One DB round-trip for the active sprint (cheap; usually cached
 *     by Postgres's plan cache).
 *   - In-memory sort + pick.
 *
 *   Even on an agent with 200 assigned tasks, this is sub-50ms.
 */

export interface NextTaskResult {
  task: {
    id: string;
    taskNumber: number;
    title: string;
    description: string | null;
    status: TaskStatus;
    priority: TaskPriority;
    projectId: string;
    projectSlug: string;
    sprintId: string | null;
    dueDate: Date | null;
    storyPoints: number | null;
    acceptanceCriteria: unknown;
    // Tasks this one blocks (downstream — useful for the agent to
    // understand "if I finish this, who's unblocked?").
    blockingTaskIds: string[];
  };
  /**
   * Why this task was chosen, in human terms. The runtime can surface
   * this in logs or include it in the agent's initial prompt — useful
   * for debugging "why is the agent working on X instead of Y?".
   */
  rationale: string;
}

/** Numeric ordering for the P0-P3 enum. P0 is highest priority. */
const PRIORITY_ORDER: Record<TaskPriority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

/**
 * Status set we consider "actionable by an agent right now". DONE is
 * terminal; IN_REVIEW belongs to humans.
 */
const ACTIONABLE_STATUSES: TaskStatus[] = ['BACKLOG', 'TODO', 'IN_PROGRESS'];

/**
 * Loads + scores the agent's next task. See file header for the full
 * selection contract.
 */
export async function getNextTaskForAgent(
  agentUserId: string,
  userType: 'HUMAN' | 'AGENT',
): Promise<NextTaskResult | null> {
  // Layer 1 auth: agent-only endpoint. Humans have the kanban + task
  // detail UI; this surface is shaped for prompt-budget callers.
  if (userType !== 'AGENT') {
    throw new ForbiddenError('next-task is an agent-only endpoint');
  }

  // Pull every actionable task the agent owns. We over-fetch slightly
  // (status filter at DB layer is a Postgres IN, fast) and filter the
  // dependency graph in memory because Prisma can't express "all
  // incoming BLOCKS rows whose source is not DONE" in a single query
  // without a raw join.
  //
  // TaskLink shape: `fromTask BLOCKS toTask`. So a task's INCOMING
  // dependencies (tasks blocking IT) are its `linksTo` rows (where it's
  // the toTask). Its OUTGOING dependencies (tasks it blocks) are its
  // `linksFrom` rows.
  const candidates = await prisma.task.findMany({
    where: {
      assigneeId: agentUserId,
      status: { in: ACTIONABLE_STATUSES },
      isBlocked: false,
    },
    include: {
      project: { select: { id: true, slug: true } },
      // INCOMING BLOCKS — links where this task is the toTask.
      // If any source (fromTask) is still not DONE, the dependency
      // is unsatisfied → skip this task.
      linksTo: {
        where: { type: 'BLOCKS' },
        include: { fromTask: { select: { id: true, status: true } } },
      },
      // OUTGOING BLOCKS — links where this task is the fromTask.
      // Surfaced in the response so the agent knows which tasks
      // become unblocked when it finishes. Read-only metadata.
      linksFrom: {
        where: { type: 'BLOCKS' },
        select: { toTaskId: true },
      },
    },
  });

  if (candidates.length === 0) return null;

  // Filter out tasks with unsatisfied BLOCKS dependencies, then apply the
  // Definition of Ready: an agent only picks up a task that declares a
  // checkable "done" (≥1 acceptance criterion). A not-ready task is a poison
  // task — surfaced at debug so under-specified work is diagnosable, not
  // silently dropped. See lib/taskReadiness.
  const ready = candidates
    .filter((t) => t.linksTo.every((link) => link.fromTask.status === 'DONE'))
    .filter((t) => {
      const readiness = evaluateAgentReadiness(t);
      if (!readiness.ready) {
        logger.debug({ taskId: t.id, reason: readiness.reason }, '[agent next-task] task not agent-ready — skipped');
      }
      return readiness.ready;
    });
  if (ready.length === 0) return null;

  // Active-sprint preference: tasks in the project's currently ACTIVE
  // sprint outrank tasks of the same priority that are not in the
  // sprint. We look up active sprints per distinct project — usually a
  // single query because most agents are scoped to one project, and
  // even multi-project agents have only a handful of active sprints
  // across them.
  const projectIds = Array.from(new Set(ready.map((t) => t.projectId)));
  const activeSprints = await prisma.sprint.findMany({
    where: { projectId: { in: projectIds }, status: 'ACTIVE' },
    select: { id: true, projectId: true },
  });
  const activeSprintByProject = new Map<string, string>();
  for (const s of activeSprints) activeSprintByProject.set(s.projectId, s.id);

  function inActiveSprint(t: (typeof ready)[number]): boolean {
    const activeId = activeSprintByProject.get(t.projectId);
    return Boolean(activeId && t.sprintId === activeId);
  }

  // The scoring function. Lower-is-better so the standard `.sort()`
  // ascending puts the winner first.
  function score(t: (typeof ready)[number]): readonly [number, number, number, number] {
    return [
      PRIORITY_ORDER[t.priority],
      inActiveSprint(t) ? 0 : 1, // active sprint wins
      t.dueDate ? t.dueDate.getTime() : Number.POSITIVE_INFINITY,
      t.createdAt.getTime(),
    ];
  }

  ready.sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    for (let i = 0; i < sa.length; i++) {
      if (sa[i] !== sb[i]) return sa[i] - sb[i];
    }
    return 0;
  });

  const winner = ready[0];
  const rationale = buildRationale(winner, inActiveSprint(winner));

  return {
    task: {
      id: winner.id,
      taskNumber: winner.taskNumber,
      title: winner.title,
      description: winner.description,
      status: winner.status,
      priority: winner.priority,
      projectId: winner.projectId,
      projectSlug: winner.project.slug,
      sprintId: winner.sprintId,
      dueDate: winner.dueDate,
      storyPoints: winner.storyPoints,
      acceptanceCriteria: winner.acceptanceCriteria,
      blockingTaskIds: winner.linksFrom.map((l) => l.toTaskId),
    },
    rationale,
  };
}

/**
 * Builds a short human-readable explanation of why this task was
 * selected over others. Surfaced in the runtime logs + optionally the
 * agent's initial prompt.
 */
function buildRationale(
  task: { priority: TaskPriority; dueDate: Date | null },
  inSprint: boolean,
): string {
  const parts: string[] = [];
  parts.push(`priority ${task.priority}`);
  if (inSprint) parts.push('in active sprint');
  if (task.dueDate) {
    const overdue = task.dueDate.getTime() < Date.now();
    parts.push(overdue ? `overdue (due ${task.dueDate.toISOString().slice(0, 10)})` : `due ${task.dueDate.toISOString().slice(0, 10)}`);
  }
  return parts.join(' · ');
}
