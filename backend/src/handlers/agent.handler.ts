import type { Request, Response, NextFunction } from 'express';
import * as service from '../services/agent.service';
import { getKnowledgePackForAgent } from '../services/agentKnowledgePack.service';
import { getNextTaskForAgent } from '../services/agentNextTask.service';

// POST /api/v1/agents/me/budget-increment
// Body: { usdCents: number }
// Auth: any authenticated agent user (rejected for humans inside the service).
export async function budgetIncrementHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const usdCents = Number(req.body?.usdCents);
    const result = await service.incrementAgentBudget(req.user!.id, usdCents);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

// GET /api/v1/agents/me/knowledge-pack/:projectSlug
// Returns a single bundle of project context (project info, members, recent
// activity, active-sprint tasks, decisions, the agent's own assigned tasks,
// quick stats) so the runtime can fetch one response per task. Auth is
// agent-only + project-membership; both are enforced inside the service.
export async function knowledgePackHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await getKnowledgePackForAgent(
      req.user!.id,
      req.user!.userType,
      req.params.projectSlug,
    );
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// GET /api/v1/agents/me/next-task
// Returns ONE task — the highest-priority, unblocked, ready-to-work task
// assigned to the calling agent. Returns { data: null } when nothing is
// ready (runtime should idle / poll later). Auth is agent-only;
// enforced in the service so the error message is human-readable.
export async function nextTaskHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await getNextTaskForAgent(req.user!.id, req.user!.userType);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}
