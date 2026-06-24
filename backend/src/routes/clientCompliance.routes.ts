import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { projectAccess } from '../middleware/projectAccess';
import * as handler from '../handlers/clientCompliance.handler';

const router = Router();

/**
 * Client-facing compliance summary — who's on the team, what
 * compliance agreements each has signed, when.
 *
 * Auth chain:
 *   - `authenticate` — must be signed in
 *   - `projectAccess` — must be a member of this project (or carry
 *     project.view_all). The endpoint is intentionally open to every
 *     project member, not just CLIENT — engineers + PMs can use it
 *     to QA the view they're presenting to a client without role-
 *     switching.
 *
 * No additional permission gate is applied. The service layer
 * already redacts forensic data (IP, UA, snapshot text); what the
 * endpoint returns is safe for any project member to read.
 */
router.get(
  '/projects/:id/compliance',
  authenticate,
  projectAccess,
  handler.getProjectComplianceHandler,
);

export default router;
