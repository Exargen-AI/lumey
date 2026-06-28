/**
 * Background run execution. A run executes *detached* from the request that
 * started it: the adapter drives the lifecycle to a stopping point while the
 * HTTP call returns immediately with a QUEUED run. The trace UI / SDK observe
 * progress by polling.
 *
 * Two safety properties:
 *   - **Error isolation** — a thrown `execute` (the adapter couldn't even start)
 *     is caught, logged, and the run is forced to FAILED, so it never hangs in
 *     QUEUED/RUNNING.
 *   - **Restart recovery** — `failInterruptedRuns()` (run at boot) fails any run
 *     left RUNNING, PAUSED, *or AWAITING_INPUT* by a previous process: in-process
 *     execution (and a paused/clarification-parked run's in-memory
 *     transcript/sandbox) doesn't survive a restart. Open questions on those runs
 *     are cancelled too. (A durable job queue is the eventual home; this keeps
 *     state honest in the meantime.)
 */
import { RunStatus } from '@prisma/client';
import prisma from '../../config/database';
import { logger } from '../../lib/logger';
import { transitionRun } from '../../services/agentRun.service';
import { cancelOpenClarificationsForRun } from '../../services/runClarification.service';
import { isTerminal } from '../../lib/runLifecycle';
import type { RuntimeAdapter, RunContext } from './runtimeAdapter';

const inflight = new Set<string>();

export function inflightRunCount(): number {
  return inflight.size;
}

export function isRunInflight(runId: string): boolean {
  return inflight.has(runId);
}

/**
 * Start a run in the background. Returns the isolated promise so callers *may*
 * await completion (tests do); production fires and forgets — rejections are
 * already handled inside, so ignoring the return never leaks an unhandled one.
 */
export function dispatchRun(adapter: RuntimeAdapter, ctx: RunContext): Promise<void> {
  inflight.add(ctx.runId);
  return adapter
    .execute(ctx)
    .catch(async (err) => {
      logger.error({ err, runId: ctx.runId }, '[agent-runtime] run execution crashed');
      await forceFail(ctx.runId, err).catch(() => undefined);
    })
    .finally(() => {
      inflight.delete(ctx.runId);
    });
}

async function forceFail(runId: string, err: unknown): Promise<void> {
  const run = await prisma.agentRun.findUnique({ where: { id: runId }, select: { status: true } });
  if (run && !isTerminal(run.status)) {
    await transitionRun(runId, RunStatus.FAILED, { error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Fail runs left RUNNING, PAUSED, or AWAITING_INPUT by a dead process (none of
 * in-process execution, a paused run's in-memory state, nor a clarification-
 * parked loop survives a restart) and cancel any questions still open on them.
 * Call once at startup. Returns the number reaped.
 */
export async function failInterruptedRuns(): Promise<number> {
  const stale = await prisma.agentRun.findMany({
    where: { status: { in: [RunStatus.RUNNING, RunStatus.PAUSED, RunStatus.AWAITING_INPUT] } },
    select: { id: true },
  });
  let reaped = 0;
  for (const run of stale) {
    await transitionRun(run.id, RunStatus.FAILED, { error: 'Run interrupted by a server restart.' }).catch(() => undefined);
    await cancelOpenClarificationsForRun(run.id).catch(() => undefined);
    reaped += 1;
  }
  if (reaped > 0) logger.warn({ reaped }, '[agent-runtime] failed interrupted runs at startup');
  return reaped;
}
