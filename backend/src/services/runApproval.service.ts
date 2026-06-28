/**
 * Approval service — the durable record of the human checkpoints an agent must
 * clear before a high-risk action (e.g. `open_pr`). The runtime opens a PENDING
 * approval when the agent attempts a gated action; a human approves or rejects
 * it through the API; a run that ends with open approvals cancels them. This
 * module owns the DB row + the `run.approval.*` bus facts; waking the parked
 * loop is the adapter's in-memory job, kept separate (mirrors
 * {@link file://./runClarification.service.ts}).
 */
import prisma from '../config/database';
import { bus } from '../kernel';
import { NotFoundError, ValidationError } from '../utils/errors';
import { ApprovalStatus } from '@prisma/client';
import type {
  RunApprovalRequestedEvent,
  RunApprovalDecidedEvent,
} from '../modules/agent-runtime/events';

/** Open a PENDING approval on a run and announce it. Returns the created row. */
export async function createApproval(input: {
  runId: string;
  taskId: string;
  action: string;
  summary: string;
  detail?: string;
}) {
  const approval = await prisma.runApprovalRequest.create({
    data: { runId: input.runId, action: input.action, summary: input.summary, detail: input.detail ?? null },
  });
  void bus.publish<RunApprovalRequestedEvent>({
    type: 'run.approval.requested',
    runId: input.runId,
    taskId: input.taskId,
    approvalId: approval.id,
    action: input.action,
  });
  return approval;
}

/**
 * Persist a human's decision on a PENDING approval. Validates it is still
 * decidable. Returns the run/task ids so the caller can announce the resume.
 * Does NOT wake the loop — that is the adapter's in-memory channel, driven by
 * the orchestrator.
 */
export async function recordApprovalDecision(input: {
  approvalId: string;
  approved: boolean;
  reason?: string;
  userId: string;
}) {
  const existing = await prisma.runApprovalRequest.findUnique({
    where: { id: input.approvalId },
    select: { id: true, status: true, runId: true, run: { select: { taskId: true } } },
  });
  if (!existing) throw new NotFoundError('Approval');
  if (existing.status !== ApprovalStatus.PENDING) {
    throw new ValidationError(`This approval is already ${existing.status.toLowerCase()}.`);
  }

  const updated = await prisma.runApprovalRequest.update({
    where: { id: input.approvalId },
    data: {
      status: input.approved ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED,
      reason: input.reason ?? null,
      decidedById: input.userId,
      decidedAt: new Date(),
    },
  });
  void bus.publish<RunApprovalDecidedEvent>({
    type: 'run.approval.decided',
    runId: existing.runId,
    taskId: existing.run.taskId,
    approvalId: updated.id,
    approved: input.approved,
  });
  return { runId: existing.runId, taskId: existing.run.taskId, approval: updated };
}

/** A run's approvals, oldest first (for the run trace / decision UI). */
export async function listApprovalsForRun(runId: string) {
  return prisma.runApprovalRequest.findMany({
    where: { runId },
    orderBy: { requestedAt: 'asc' },
  });
}

/**
 * Mark any still-open approvals on a run CANCELLED. Called when a run reaches a
 * terminal state so the inbox/trace never shows a live checkpoint on a dead run.
 * Returns how many were closed.
 */
export async function cancelOpenApprovalsForRun(runId: string): Promise<number> {
  const { count } = await prisma.runApprovalRequest.updateMany({
    where: { runId, status: ApprovalStatus.PENDING },
    data: { status: ApprovalStatus.CANCELLED },
  });
  return count;
}
