import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { projectAccess } from '../middleware/projectAccess';
import { projectScopedResourceAccess } from '../middleware/projectScopedResourceAccess';
import { requireProjectInternalAccess } from '../middleware/projectInternalAccess';
import { validate } from '../middleware/validate';
import { createDecisionSchema, updateDecisionSchema } from '../validators/decision.schema';
import * as decisionHandler from '../handlers/decision.handler';

const router = Router();

// 2026-06-02: decisions are part of the "full internal project" view. Gate
// the read on per-project internal access (staff, legacy global client
// flag, or a per-project full-access CLIENT member) rather than the global
// `decision.view` permission — so a Furix client granted full access to
// their project sees its decisions, while a base client still gets 403.
// `decision.view` is kept as a fallback for any role that holds it.
router.get('/projects/:id/decisions', authenticate, projectAccess, requireProjectInternalAccess('decision.view'), decisionHandler.listDecisionsHandler);
router.post('/projects/:id/decisions', authenticate, projectAccess, authorize('decision.create'), validate(createDecisionSchema), decisionHandler.createDecisionHandler);
router.put('/decisions/:id', authenticate, projectScopedResourceAccess('decision', 'id'), authorize('decision.edit'), validate(updateDecisionSchema), decisionHandler.updateDecisionHandler);
router.delete('/decisions/:id', authenticate, projectScopedResourceAccess('decision', 'id'), authorize('decision.edit'), decisionHandler.deleteDecisionHandler);

export default router;
