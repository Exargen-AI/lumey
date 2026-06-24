import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { projectAccess } from '../middleware/projectAccess';
import * as handler from '../handlers/clientActions.handler';

const router = Router();

/**
 * "Your action needed" feed for the client project status page —
 * aggregated deliverables awaiting sign-off + open decisions.
 *
 * Gated by `projectAccess` so a CLIENT-role user only ever sees actions
 * on projects they're a member of.
 */
router.get(
  '/projects/:id/client-actions',
  authenticate,
  projectAccess,
  handler.clientActionsHandler,
);

export default router;
