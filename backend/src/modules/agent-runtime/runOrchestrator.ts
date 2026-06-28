/**
 * Run orchestration — the entry point that turns "run this task" into an
 * executing run. It creates the run (QUEUED) and hands it to the selected
 * runtime adapter, which drives the lifecycle from there. Kept thin and
 * runtime-neutral; the adapter does the real work behind the seam.
 */
import prisma from '../../config/database';
import { ClarificationStatus, RunStatus, UserType } from '@prisma/client';
import { NotFoundError, ValidationError } from '../../utils/errors';
import { createRun, transitionRun } from '../../services/agentRun.service';
import { recordClarificationAnswer } from '../../services/runClarification.service';
import { isTerminal } from '../../lib/runLifecycle';
import { getAdapter, DEFAULT_ADAPTER_ID } from './adapterRegistry';
import { dispatchRun, isRunInflight } from './runExecutor';
import type { RunContext } from './runtimeAdapter';

export async function startRun(input: {
  taskId: string;
  agentId: string;
  adapterId?: string;
}) {
  const task = await prisma.task.findUnique({
    where: { id: input.taskId },
    select: { id: true, title: true, description: true, acceptanceCriteria: true },
  });
  if (!task) throw new NotFoundError('Task');

  // Runs are agent-driven by definition — refuse to start one "as" a human.
  const agent = await prisma.user.findUnique({
    where: { id: input.agentId },
    select: { userType: true },
  });
  if (!agent) throw new NotFoundError('Agent');
  if (agent.userType !== UserType.AGENT) {
    throw new ValidationError('Runs can only be started for agent users');
  }

  // Resolve the runtime up front so an unknown adapter fails before we create a
  // run that nothing will execute.
  const adapterId = input.adapterId ?? DEFAULT_ADAPTER_ID;
  const adapter = getAdapter(adapterId);

  const run = await createRun({ taskId: task.id, agentId: input.agentId, adapterId });
  const ctx: RunContext = {
    runId: run.id,
    taskId: task.id,
    agentId: input.agentId,
    task: {
      title: task.title,
      description: task.description,
      acceptanceCriteria: task.acceptanceCriteria,
    },
  };
  // Execute in the background — return the QUEUED run immediately; the adapter
  // drives the lifecycle from here and the trace UI / SDK poll for progress.
  dispatchRun(adapter, ctx);
  return run;
}

/**
 * Cancel a run by delegating to the adapter that ran it — which aborts its
 * in-flight (background) work and lets the loop transition CANCELLED
 * cooperatively, or transitions directly if it's already idle. No-op if the run
 * already finished.
 */
export async function cancelRun(runId: string) {
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: { status: true, adapterId: true },
  });
  if (!run) throw new NotFoundError('Run');
  if (isTerminal(run.status)) return null; // already done
  await getAdapter(run.adapterId).cancel(runId);
  return null;
}

/**
 * Pause a running run: suspend the loop at its next turn boundary, transcript and
 * sandbox kept alive, so it can be resumed in place. We require the run to be
 * RUNNING, executing **in this process** (`isRunInflight` — pause is in-memory),
 * and on a runtime that supports suspension. We flip the loop's pause flag first,
 * then record PAUSED, so the loop parks no later than the DB says it has.
 */
export async function pauseRun(runId: string) {
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: { status: true, adapterId: true },
  });
  if (!run) throw new NotFoundError('Run');
  if (run.status !== RunStatus.RUNNING) {
    throw new ValidationError(`Only a running run can be paused (run is ${run.status}).`);
  }
  const adapter = getAdapter(run.adapterId);
  if (!adapter.pause || !isRunInflight(runId)) {
    throw new ValidationError('This run cannot be paused — its runtime does not support pausing, or it is not executing on this server.');
  }
  await adapter.pause(runId);
  await transitionRun(runId, RunStatus.PAUSED, { summary: 'Run paused by a human.' });
  return null;
}

/**
 * Resume a paused run. We move the DB back to RUNNING **before** unblocking the
 * loop: if we unparked it first it could finish (→ AWAITING_REVIEW) while the DB
 * still said PAUSED, an illegal transition. RUNNING first keeps every subsequent
 * loop transition legal.
 */
export async function resumeRun(runId: string) {
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: { status: true, adapterId: true },
  });
  if (!run) throw new NotFoundError('Run');
  if (run.status !== RunStatus.PAUSED) {
    throw new ValidationError(`Only a paused run can be resumed (run is ${run.status}).`);
  }
  const adapter = getAdapter(run.adapterId);
  if (!adapter.resume || !isRunInflight(runId)) {
    throw new ValidationError('This run cannot be resumed — its runtime does not support resuming, or it is no longer executing on this server.');
  }
  await transitionRun(runId, RunStatus.RUNNING, { summary: 'Run resumed by a human.' });
  await adapter.resume(runId);
  return null;
}

/**
 * Answer a clarification the agent raised mid-run. We wake the parked loop
 * **first** (so it transitions AWAITING_INPUT→RUNNING and resumes with the
 * answer), then persist the answer — if the loop turns out not to be waiting
 * (a race, or the run isn't executing here) we reject *before* writing, leaving
 * the question PENDING for a retry rather than marking it answered on a dead run.
 */
export async function answerClarification(input: { clarificationId: string; answer: string; userId: string }) {
  const clarification = await prisma.runClarificationRequest.findUnique({
    where: { id: input.clarificationId },
    select: { status: true, runId: true, run: { select: { status: true, adapterId: true } } },
  });
  if (!clarification) throw new NotFoundError('Clarification');
  if (clarification.status !== ClarificationStatus.PENDING) {
    throw new ValidationError(`This clarification is already ${clarification.status.toLowerCase()}.`);
  }
  if (clarification.run.status !== RunStatus.AWAITING_INPUT) {
    throw new ValidationError(`This run is not awaiting input (it is ${clarification.run.status}).`);
  }

  const adapter = getAdapter(clarification.run.adapterId);
  if (!adapter.answerClarification || !isRunInflight(clarification.runId)) {
    throw new ValidationError('This run is no longer waiting for an answer on this server.');
  }
  const woke = await adapter.answerClarification(clarification.runId, input.answer);
  if (!woke) {
    throw new ValidationError('This run is not currently waiting for an answer.');
  }

  return recordClarificationAnswer(input);
}

/**
 * Resolve the agent to run a task as. For now (single-agent dev), default to
 * the task's agent assignee if it is one, else the first active agent user.
 * Returns null when the deployment has no agents.
 */
export async function resolveRunnerAgentId(taskId: string): Promise<string | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { assignee: { select: { id: true, userType: true, agentActive: true } } },
  });
  if (task?.assignee && task.assignee.userType === UserType.AGENT && task.assignee.agentActive) {
    return task.assignee.id;
  }
  const agent = await prisma.user.findFirst({
    where: { userType: UserType.AGENT, agentActive: true, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return agent?.id ?? null;
}
