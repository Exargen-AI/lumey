import { Request, Response, NextFunction } from 'express';
import * as service from '../services/clientActions.service';

/**
 * GET /projects/:id/client-actions
 *
 * Returns items currently blocked on the client (awaiting-sign-off
 * deliverables + proposed decisions), oldest-first. Used by the callout
 * at the top of the client project status page.
 *
 * Access: `projectAccess` middleware gates this to project members —
 * including CLIENT-role members, who are the primary audience. No
 * additional permission needed.
 */
export async function clientActionsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.getClientActions(req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}
