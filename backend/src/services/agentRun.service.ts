/**
 * Agent-run service — the platform-side lifecycle of a run, independent of any
 * runtime. A runtime adapter (M2.2) drives a run through these calls; the API
 * reads runs back. Every meaningful change appends a `RunEvent` (the trace)
 * and publishes a `run.*` fact on the kernel bus for observability.
 *
 * Runtime-neutral: no vendor concepts appear here. Sequence numbers for steps
 * and events are independent 1-based counters per run, assigned inside a
 * transaction so concurrent appends can't collide on the `(runId, seq)`
 * uniqueness.
 */
import prisma from '../config/database';
import { bus } from '../kernel';
import { NotFoundError } from '../utils/errors';
import { assertTransition, isTerminal } from '../lib/runLifecycle';
import { RunStatus, type RunStepType, type Prisma } from '@prisma/client';
import type {
  RunCreatedEvent,
  RunTransitionedEvent,
  RunStepRecordedEvent,
} from '../modules/agent-runtime/events';

/** Append a trace event with the next per-run sequence number. */
async function appendEvent(runId: string, type: string, payload: Record<string, unknown> = {}) {
  return prisma.$transaction(async (tx) => {
    const last = await tx.runEvent.findFirst({
      where: { runId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    return tx.runEvent.create({
      data: { runId, seq: (last?.seq ?? 0) + 1, type, payload: payload as Prisma.InputJsonValue },
    });
  });
}

/** Create a QUEUED run for a task. */
export async function createRun(input: { taskId: string; agentId: string; model?: string | null }) {
  const run = await prisma.agentRun.create({
    data: { taskId: input.taskId, agentId: input.agentId, model: input.model ?? null },
  });
  await appendEvent(run.id, 'run.created', { taskId: run.taskId, agentId: run.agentId });
  void bus.publish<RunCreatedEvent>({
    type: 'run.created',
    runId: run.id,
    taskId: run.taskId,
    agentId: run.agentId,
  });
  return run;
}

/**
 * Move a run to a new lifecycle state (validated). Stamps `startedAt` on first
 * RUNNING and `endedAt` on any terminal state. Optional `error`/`summary` are
 * recorded alongside.
 */
export async function transitionRun(
  runId: string,
  to: RunStatus,
  opts: { error?: string; summary?: string } = {},
) {
  const run = await prisma.agentRun.findUnique({ where: { id: runId } });
  if (!run) throw new NotFoundError('Run');
  assertTransition(run.status, to);

  const now = new Date();
  const data: Prisma.AgentRunUpdateInput = { status: to };
  if (to === RunStatus.RUNNING && !run.startedAt) data.startedAt = now;
  if (isTerminal(to)) data.endedAt = now;
  if (opts.error !== undefined) data.error = opts.error;
  if (opts.summary !== undefined) data.summary = opts.summary;

  const updated = await prisma.agentRun.update({ where: { id: runId }, data });
  await appendEvent(runId, 'run.transitioned', { from: run.status, to });
  void bus.publish<RunTransitionedEvent>({
    type: 'run.transitioned',
    runId,
    taskId: run.taskId,
    from: run.status,
    to,
  });
  return updated;
}

/** Record a step (defaults to RUNNING) with the next per-run step sequence. */
export async function appendStep(
  runId: string,
  input: { type: RunStepType; title: string; detail?: string },
) {
  const exists = await prisma.agentRun.findUnique({ where: { id: runId }, select: { id: true } });
  if (!exists) throw new NotFoundError('Run');

  const step = await prisma.$transaction(async (tx) => {
    const last = await tx.runStep.findFirst({
      where: { runId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    return tx.runStep.create({
      data: {
        runId,
        seq: (last?.seq ?? 0) + 1,
        type: input.type,
        title: input.title,
        detail: input.detail ?? null,
      },
    });
  });

  await appendEvent(runId, 'run.step.recorded', { stepId: step.id, seq: step.seq, stepType: step.type });
  void bus.publish<RunStepRecordedEvent>({
    type: 'run.step.recorded',
    runId,
    stepId: step.id,
    seq: step.seq,
    stepType: step.type,
    title: step.title,
  });
  return step;
}

/** Read a run with its ordered steps + trace events. */
export async function getRun(runId: string) {
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    include: {
      steps: { orderBy: { seq: 'asc' } },
      events: { orderBy: { seq: 'asc' } },
    },
  });
  if (!run) throw new NotFoundError('Run');
  return run;
}

/** List a task's runs, newest first (no steps/events — a summary view). */
export async function listRunsForTask(taskId: string) {
  return prisma.agentRun.findMany({
    where: { taskId },
    orderBy: { createdAt: 'desc' },
  });
}
