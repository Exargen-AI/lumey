import type { Request, Response, NextFunction } from 'express';
import * as service from '../../services/agentRun.service';
import { startRun, cancelRun, pauseRun, resumeRun, resolveRunnerAgentId } from './runOrchestrator';
import { NotFoundError, ValidationError } from '../../utils/errors';

// GET /api/v1/tasks/:id/runs — a task's runs, newest first (summary view).
export async function listTaskRunsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const runs = await service.listRunsForTask(req.params.id);
    res.json({ success: true, data: runs });
  } catch (err) {
    next(err);
  }
}

// GET /api/v1/tasks/:id/runs/:runId — one run with its ordered steps + trace.
// Scoped under the task so the existing taskAccess gate authorises it; we
// re-check the run actually belongs to that task (a run id from another task
// must not be readable just by pairing it with a task the caller can see).
export async function getTaskRunHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const run = await service.getRun(req.params.runId);
    if (run.taskId !== req.params.id) throw new NotFoundError('Run');
    res.json({ success: true, data: run });
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/tasks/:id/runs — dispatch an agent run on the task. Body may
// name an `agentId`; otherwise we default to the task's agent assignee (if any)
// or the first active agent. The reference runtime executes synchronously, so
// the response already reflects the parked-for-review run.
export async function startTaskRunHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const agentId: string | undefined = req.body?.agentId ?? undefined;
    const resolvedAgentId = agentId ?? (await resolveRunnerAgentId(req.params.id));
    if (!resolvedAgentId) {
      throw new ValidationError('No agent available to run this task. Provision an agent user first.');
    }
    const run = await startRun({ taskId: req.params.id, agentId: resolvedAgentId, adapterId: req.body?.adapterId });
    res.status(201).json({ success: true, data: run });
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/tasks/:id/runs/:runId/cancel — stop a non-terminal run.
export async function cancelTaskRunHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const run = await service.getRun(req.params.runId);
    if (run.taskId !== req.params.id) throw new NotFoundError('Run');
    await cancelRun(req.params.runId);
    res.json({ success: true, data: { id: req.params.runId } });
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/tasks/:id/runs/:runId/pause — suspend a running run in place.
export async function pauseTaskRunHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const run = await service.getRun(req.params.runId);
    if (run.taskId !== req.params.id) throw new NotFoundError('Run');
    await pauseRun(req.params.runId);
    res.json({ success: true, data: { id: req.params.runId } });
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/tasks/:id/runs/:runId/resume — continue a paused run from where it parked.
export async function resumeTaskRunHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const run = await service.getRun(req.params.runId);
    if (run.taskId !== req.params.id) throw new NotFoundError('Run');
    await resumeRun(req.params.runId);
    res.json({ success: true, data: { id: req.params.runId } });
  } catch (err) {
    next(err);
  }
}
