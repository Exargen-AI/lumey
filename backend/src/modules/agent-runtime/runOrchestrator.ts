/**
 * Run orchestration — the entry point that turns "run this task" into an
 * executing run. It creates the run (QUEUED) and hands it to the selected
 * runtime adapter, which drives the lifecycle from there. Kept thin and
 * runtime-neutral; the adapter does the real work behind the seam.
 */
import prisma from '../../config/database';
import { UserType } from '@prisma/client';
import { NotFoundError, ValidationError } from '../../utils/errors';
import { createRun } from '../../services/agentRun.service';
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
