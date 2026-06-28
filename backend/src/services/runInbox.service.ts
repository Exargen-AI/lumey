/**
 * HITL inbox — one cross-task view of every run currently waiting on a human.
 * It unifies the two human-decision queues (PENDING clarifications + PENDING
 * approvals) into a single, oldest-waiting-first list with enough run/task/
 * project context to act without hunting through boards.
 *
 * Visibility: runs are agent work, so the inbox obeys the same rules as the
 * rest of the agent surface — only viewers allowed to see agents get items at
 * all, and then only for projects they can access (admins with `project.view_all`
 * see everything; everyone else is scoped to their project memberships). Enforced
 * server-side: an unauthorised caller gets an empty list, never a leaked run.
 */
import prisma from '../config/database';
import { checkPermission } from './rbac.service';
import { viewerCanSeeAgents } from '../lib/agentVisibility';
import { ApprovalStatus, ClarificationStatus, type UserRole } from '@prisma/client';

export interface InboxViewer {
  readonly id: string;
  readonly role: UserRole;
  readonly canViewAgents?: boolean | null;
}

/** One actionable item in the inbox — a question to answer or an action to approve. */
export interface InboxItem {
  readonly kind: 'clarification' | 'approval';
  /** The clarification/approval id (what the action endpoints take). */
  readonly id: string;
  readonly runId: string;
  readonly taskId: string;
  readonly taskNumber: number;
  readonly taskTitle: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly projectSlug: string;
  /** The question (clarification) or the action summary (approval). */
  readonly prompt: string;
  /** Extra context (approval detail); null for clarifications. */
  readonly detail: string | null;
  /** The gated tool for an approval (e.g. `open_pr`); null for clarifications. */
  readonly action: string | null;
  /** When the agent started waiting (ISO) — drives the oldest-first ordering. */
  readonly waitingSince: string;
}

// Pull the run → task → project context every item needs, in one include.
const RUN_CONTEXT = {
  run: {
    select: {
      id: true,
      taskId: true,
      task: {
        select: {
          taskNumber: true,
          title: true,
          projectId: true,
          project: { select: { name: true, slug: true } },
        },
      },
    },
  },
} as const;

/**
 * Every run awaiting this viewer's decision, oldest wait first. Empty for a
 * viewer who can't see agents, or who shares no project with any waiting run.
 */
export async function listInboxItems(viewer: InboxViewer): Promise<InboxItem[]> {
  if (!viewerCanSeeAgents(viewer)) return [];

  // Project scope: admins see all; everyone else only their memberships.
  const canViewAll = await checkPermission(viewer.role, 'project.view_all');
  let runScope: object = {};
  if (!canViewAll) {
    const memberships = await prisma.projectMember.findMany({
      where: { userId: viewer.id },
      select: { projectId: true },
    });
    const projectIds = memberships.map((m) => m.projectId);
    if (projectIds.length === 0) return [];
    runScope = { run: { task: { projectId: { in: projectIds } } } };
  }

  const [clarifications, approvals] = await Promise.all([
    prisma.runClarificationRequest.findMany({
      where: { status: ClarificationStatus.PENDING, ...runScope },
      include: RUN_CONTEXT,
      orderBy: { askedAt: 'asc' },
    }),
    prisma.runApprovalRequest.findMany({
      where: { status: ApprovalStatus.PENDING, ...runScope },
      include: RUN_CONTEXT,
      orderBy: { requestedAt: 'asc' },
    }),
  ]);

  const items: InboxItem[] = [
    ...clarifications.map((c): InboxItem => ({
      kind: 'clarification',
      id: c.id,
      runId: c.runId,
      taskId: c.run.taskId,
      taskNumber: c.run.task.taskNumber,
      taskTitle: c.run.task.title,
      projectId: c.run.task.projectId,
      projectName: c.run.task.project.name,
      projectSlug: c.run.task.project.slug,
      prompt: c.question,
      detail: null,
      action: null,
      waitingSince: c.askedAt.toISOString(),
    })),
    ...approvals.map((a): InboxItem => ({
      kind: 'approval',
      id: a.id,
      runId: a.runId,
      taskId: a.run.taskId,
      taskNumber: a.run.task.taskNumber,
      taskTitle: a.run.task.title,
      projectId: a.run.task.projectId,
      projectName: a.run.task.project.name,
      projectSlug: a.run.task.project.slug,
      prompt: a.summary,
      detail: a.detail,
      action: a.action,
      waitingSince: a.requestedAt.toISOString(),
    })),
  ];

  // Oldest wait first across both kinds — the thing that's been blocked longest
  // is the thing a human should look at first.
  items.sort((x, y) => x.waitingSince.localeCompare(y.waitingSince));
  return items;
}
