import type { Request, Response, NextFunction } from 'express';
import { listInboxItems } from '../../services/runInbox.service';

// GET /api/v1/inbox — every run awaiting THIS viewer's decision (questions +
// approvals), oldest wait first. Authorization (agent-visibility + project
// scope) lives in the service, so this stays a thin pass-through.
export async function listInboxHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const items = await listInboxItems({
      id: req.user!.id,
      role: req.user!.role,
      canViewAgents: req.user!.canViewAgents,
    });
    res.json({ success: true, data: items });
  } catch (err) {
    next(err);
  }
}
