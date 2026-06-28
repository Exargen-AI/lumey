/**
 * Clarification service — the durable record of an agent's mid-run questions to
 * a human (HITL). The runtime opens a PENDING request when the agent calls
 * `ask_human`; a human answers it through the API; a run that ends with open
 * questions cancels them. This module owns the DB row + the `run.clarification.*`
 * bus facts; the *live wake-up* of the parked loop is the adapter's job
 * (in-memory), kept separate so persistence and process-local signalling don't
 * entangle.
 */
import prisma from '../config/database';
import { bus } from '../kernel';
import { NotFoundError, ValidationError } from '../utils/errors';
import { ClarificationStatus } from '@prisma/client';
import type {
  RunClarificationRequestedEvent,
  RunClarificationAnsweredEvent,
} from '../modules/agent-runtime/events';

/** Open a PENDING question on a run and announce it. Returns the created row. */
export async function createClarification(input: { runId: string; taskId: string; question: string }) {
  const clarification = await prisma.runClarificationRequest.create({
    data: { runId: input.runId, question: input.question },
  });
  void bus.publish<RunClarificationRequestedEvent>({
    type: 'run.clarification.requested',
    runId: input.runId,
    taskId: input.taskId,
    clarificationId: clarification.id,
  });
  return clarification;
}

/**
 * Persist a human's answer to a PENDING clarification. Validates it is still
 * answerable (a second answer, or answering a cancelled one, is rejected).
 * Returns the run/task ids so the caller can announce the resume. Does NOT wake
 * the loop — that is the adapter's in-memory channel, driven by the orchestrator.
 */
export async function recordClarificationAnswer(input: { clarificationId: string; answer: string; userId: string }) {
  const existing = await prisma.runClarificationRequest.findUnique({
    where: { id: input.clarificationId },
    select: { id: true, status: true, runId: true, run: { select: { taskId: true } } },
  });
  if (!existing) throw new NotFoundError('Clarification');
  if (existing.status !== ClarificationStatus.PENDING) {
    throw new ValidationError(`This clarification is already ${existing.status.toLowerCase()}.`);
  }

  const updated = await prisma.runClarificationRequest.update({
    where: { id: input.clarificationId },
    data: {
      status: ClarificationStatus.ANSWERED,
      answer: input.answer,
      answeredById: input.userId,
      answeredAt: new Date(),
    },
  });
  void bus.publish<RunClarificationAnsweredEvent>({
    type: 'run.clarification.answered',
    runId: existing.runId,
    taskId: existing.run.taskId,
    clarificationId: updated.id,
  });
  return { runId: existing.runId, taskId: existing.run.taskId, clarification: updated };
}

/** A run's clarifications, oldest first (for the run trace / answer UI). */
export async function listClarificationsForRun(runId: string) {
  return prisma.runClarificationRequest.findMany({
    where: { runId },
    orderBy: { askedAt: 'asc' },
  });
}

/**
 * Mark any still-open questions on a run CANCELLED. Called when a run reaches a
 * terminal state so the inbox/trace never shows a question for a dead run.
 * Returns how many were closed.
 */
export async function cancelOpenClarificationsForRun(runId: string): Promise<number> {
  const { count } = await prisma.runClarificationRequest.updateMany({
    where: { runId, status: ClarificationStatus.PENDING },
    data: { status: ClarificationStatus.CANCELLED },
  });
  return count;
}
