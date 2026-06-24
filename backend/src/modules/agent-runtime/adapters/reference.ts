/**
 * Reference runtime adapter — a deterministic, dependency-free simulator for
 * local development, demos, and tests. It produces a realistic step trace and
 * parks the run at AWAITING_REVIEW (the human-only done-gate), exactly where a
 * real coding agent lands after opening a PR. No external calls, no sandbox,
 * no model — it just exercises the seam and the run lifecycle.
 */
import { RunStatus, RunStepType } from '@prisma/client';
import prisma from '../../../config/database';
import { transitionRun, appendStep } from '../../../services/agentRun.service';
import { isTerminal } from '../../../lib/runLifecycle';
import type { RuntimeAdapter } from '../runtimeAdapter';

export const referenceAdapter: RuntimeAdapter = {
  id: 'reference',

  capabilities: () => ({
    selfHosted: true, // it's in-process, so trivially "on your infra"
    memory: false,
    outcomes: false,
    multiAgent: false,
  }),

  async execute(ctx) {
    await transitionRun(ctx.runId, RunStatus.RUNNING);
    await appendStep(ctx.runId, {
      type: RunStepType.PLAN,
      title: 'Plan the change',
      detail: `Read the task and acceptance criteria for "${ctx.task.title}".`,
    });
    await appendStep(ctx.runId, { type: RunStepType.EDIT, title: 'Apply edits (simulated)' });
    await appendStep(ctx.runId, {
      type: RunStepType.TEST,
      title: 'Run tests',
      detail: 'All green (simulated).',
    });
    await appendStep(ctx.runId, {
      type: RunStepType.REVIEW_REQUEST,
      title: 'Open PR + request review',
    });
    await transitionRun(ctx.runId, RunStatus.AWAITING_REVIEW, {
      summary: 'Reference run: simulated implementation complete; awaiting human review.',
    });
  },

  async cancel(runId) {
    const run = await prisma.agentRun.findUnique({
      where: { id: runId },
      select: { status: true },
    });
    if (run && !isTerminal(run.status)) {
      await transitionRun(runId, RunStatus.CANCELLED);
    }
  },
};
