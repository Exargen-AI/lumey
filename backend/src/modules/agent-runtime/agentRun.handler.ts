import type { Request, Response, NextFunction } from 'express';
import * as service from '../../services/agentRun.service';
import { listClarificationsForRun } from '../../services/runClarification.service';
import { listApprovalsForRun } from '../../services/runApproval.service';
import { getRunSdlc } from '../../services/runSdlc.service';
import { startRun, cancelRun, pauseRun, resumeRun, answerClarification, decideApproval, resolveRunnerAgentId } from './runOrchestrator';
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

// GET /api/v1/tasks/:id/runs/:runId/clarifications — the agent's questions on
// this run (oldest first), for the run trace + answer UI.
export async function listRunClarificationsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const run = await service.getRun(req.params.runId);
    if (run.taskId !== req.params.id) throw new NotFoundError('Run');
    const clarifications = await listClarificationsForRun(req.params.runId);
    res.json({ success: true, data: clarifications });
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/tasks/:id/runs/:runId/clarifications/:clarificationId/answer —
// answer an agent's question; the parked run resumes with it.
export async function answerClarificationHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const run = await service.getRun(req.params.runId);
    if (run.taskId !== req.params.id) throw new NotFoundError('Run');
    const answer = typeof req.body?.answer === 'string' ? req.body.answer.trim() : '';
    if (!answer) throw new ValidationError('An answer is required.');
    await answerClarification({ clarificationId: req.params.clarificationId, answer, userId: req.user!.id });
    res.json({ success: true, data: { id: req.params.clarificationId } });
  } catch (err) {
    next(err);
  }
}

// GET /api/v1/tasks/:id/runs/:runId/approvals — the agent's approval checkpoints
// on this run (oldest first), for the run trace + decision UI.
export async function listRunApprovalsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const run = await service.getRun(req.params.runId);
    if (run.taskId !== req.params.id) throw new NotFoundError('Run');
    const approvals = await listApprovalsForRun(req.params.runId);
    res.json({ success: true, data: approvals });
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/tasks/:id/runs/:runId/approvals/:approvalId/approve — let the
// gated action proceed.
export async function approveRunApprovalHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const run = await service.getRun(req.params.runId);
    if (run.taskId !== req.params.id) throw new NotFoundError('Run');
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() || undefined : undefined;
    await decideApproval({ approvalId: req.params.approvalId, approved: true, reason, userId: req.user!.id });
    res.json({ success: true, data: { id: req.params.approvalId } });
  } catch (err) {
    next(err);
  }
}

// POST /api/v1/tasks/:id/runs/:runId/approvals/:approvalId/reject — refuse the
// gated action; the reason is fed back to the agent.
export async function rejectRunApprovalHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const run = await service.getRun(req.params.runId);
    if (run.taskId !== req.params.id) throw new NotFoundError('Run');
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() || undefined : undefined;
    await decideApproval({ approvalId: req.params.approvalId, approved: false, reason, userId: req.user!.id });
    res.json({ success: true, data: { id: req.params.approvalId } });
  } catch (err) {
    next(err);
  }
}

// GET /api/v1/tasks/:id/runs/:runId/sdlc — the run's delivery chain: the commits
// it made, the PR it opened, and that PR's CI checks (the pipeline strip).
export async function getRunSdlcHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const run = await service.getRun(req.params.runId);
    if (run.taskId !== req.params.id) throw new NotFoundError('Run');
    const sdlc = await getRunSdlc(req.params.runId);
    res.json({ success: true, data: sdlc });
  } catch (err) {
    next(err);
  }
}
