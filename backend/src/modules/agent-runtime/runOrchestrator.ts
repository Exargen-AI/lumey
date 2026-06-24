/**
 * Run orchestration — the entry point that turns "run this task" into an
 * executing run. It creates the run (QUEUED) and hands it to the selected
 * runtime adapter, which drives the lifecycle from there. Kept thin and
 * runtime-neutral; the adapter does the real work behind the seam.
 */
import prisma from '../../config/database';
import { UserType, RunStatus } from '@prisma/client';
import { NotFoundError, ValidationError } from '../../utils/errors';
import { createRun, transitionRun } from '../../services/agentRun.service';
import { isTerminal } from '../../lib/runLifecycle';
import { getAdapter, DEFAULT_ADAPTER_ID } from './adapterRegistry';
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
  const adapter = getAdapter(input.adapterId ?? DEFAULT_ADAPTER_ID);

  const run = await createRun({ taskId: task.id, agentId: input.agentId });
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
  await adapter.execute(ctx);
  return run;
}

/**
 * Cancel a run. Platform-level stop: transitions a non-terminal run to
 * CANCELLED (no-op if it already finished). A real runtime adapter will also be
 * signalled to abort its in-flight work once long-running runs land (M2.7).
 */
export async function cancelRun(runId: string) {
  const run = await prisma.agentRun.findUnique({
    where: { id: runId },
    select: { status: true },
  });
  if (!run) throw new NotFoundError('Run');
  if (isTerminal(run.status)) return null; // already done
  return transitionRun(runId, RunStatus.CANCELLED);
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
