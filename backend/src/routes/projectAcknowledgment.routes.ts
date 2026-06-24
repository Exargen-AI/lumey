import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { projectAccess } from '../middleware/projectAccess';
import * as handler from '../handlers/projectAcknowledgment.handler';

const router = Router();

// All routes are project-scoped: caller must be a member (or have project.view_all).
// `projectAccess` enforces that — same gate used everywhere else for project-scoped endpoints.

// "Have I acknowledged this project?" — returns boolean + the boilerplate text
// so the frontend can render the modal without a second call.
router.get('/projects/:id/my-acknowledgment', authenticate, projectAccess, handler.getMyAcknowledgmentHandler);

// Idempotent: re-POSTing returns the existing ack without overwriting the original timestamp.
router.post('/projects/:id/acknowledge', authenticate, projectAccess, handler.acknowledgeHandler);

// Admin audit view — list every user who has acknowledged this project, when, and from where.
router.get('/projects/:id/acknowledgments', authenticate, projectAccess, authorize('rbac.manage'), handler.listAcknowledgmentsHandler);

export default router;
