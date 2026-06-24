import { Request, Response, NextFunction } from 'express';
import * as service from '../services/currentSprint.service';

/**
 * GET /projects/:id/current-sprint
 *
 * Returns the active sprint snapshot for the project, or `{ sprint: null }`
 * if no sprint is currently ACTIVE. CLIENT-role users get their own
 * projects' snapshots — gated by `projectAccess`.
 */
export async function currentSprintHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.getCurrentSprint(req.params.id, req.user!);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}
