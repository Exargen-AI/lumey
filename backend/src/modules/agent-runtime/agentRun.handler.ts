import type { Request, Response, NextFunction } from 'express';
import * as service from '../../services/agentRun.service';
import { NotFoundError } from '../../utils/errors';

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
