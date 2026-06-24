import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { projectAccess } from '../middleware/projectAccess';
import { projectScopedResourceAccess } from '../middleware/projectScopedResourceAccess';
import * as handler from '../handlers/deliverable.handler';

const router = Router();

// Project-scoped: list + create
// `projectAccess` enforces project membership (or project.view_all permission).
router.get('/projects/:id/deliverables', authenticate, projectAccess, handler.listHandler);
router.post('/projects/:id/deliverables', authenticate, projectAccess, authorize('deliverable.create'), handler.createHandler);

// Single-deliverable routes — every one runs `projectScopedResourceAccess` to
// look up the deliverable's projectId and verify the user is a member (or has
// project.view_all). This prevents a CLIENT in project A from acting on a
// deliverable in project B, even if they have the relevant permission.
router.get('/deliverables/:id', authenticate, projectScopedResourceAccess('deliverable', 'id'), handler.getHandler);
router.put('/deliverables/:id', authenticate, projectScopedResourceAccess('deliverable', 'id'), authorize('deliverable.edit'), handler.updateHandler);
router.delete('/deliverables/:id', authenticate, projectScopedResourceAccess('deliverable', 'id'), authorize('deliverable.delete'), handler.deleteHandler);

// State-transition actions (cleaner API than coercing the client to PUT a status field)
router.post('/deliverables/:id/mark-delivered', authenticate, projectScopedResourceAccess('deliverable', 'id'), authorize('deliverable.edit'), handler.markDeliveredHandler);
router.post('/deliverables/:id/sign-off', authenticate, projectScopedResourceAccess('deliverable', 'id'), authorize('deliverable.sign_off'), handler.signOffHandler);
router.post('/deliverables/:id/reject', authenticate, projectScopedResourceAccess('deliverable', 'id'), authorize('deliverable.sign_off'), handler.rejectHandler);

export default router;
