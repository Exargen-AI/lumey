import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { projectAccess } from '../middleware/projectAccess';
import { taskAccess } from '../middleware/taskAccess';
import { validate } from '../middleware/validate';
import {
  connectGitHubSchema,
  projectIdParamSchema,
  taskIdParamSchema,
} from '../validators/githubIntegration.schema';
import * as handler from '../handlers/githubIntegration.handler';

const router = Router();

// Admin-side configuration. integration.manage is granted to ADMIN +
// SUPER_ADMIN by default; the matrix is editable from the RBAC page.
router.get(
  '/projects/:id/integrations/github',
  authenticate,
  projectAccess,
  authorize('integration.manage'),
  validate(projectIdParamSchema),
  handler.getHandler,
);
router.post(
  '/projects/:id/integrations/github',
  authenticate,
  projectAccess,
  authorize('integration.manage'),
  validate(connectGitHubSchema),
  handler.connectHandler,
);
router.delete(
  '/projects/:id/integrations/github',
  authenticate,
  projectAccess,
  authorize('integration.manage'),
  validate(projectIdParamSchema),
  handler.disconnectHandler,
);

// Task-side read of linked PRs.
router.get(
  '/tasks/:id/external-links',
  authenticate,
  taskAccess,
  validate(taskIdParamSchema),
  handler.listTaskExternalLinksHandler,
);

// Public webhook entry — UNAUTHENTICATED at the bearer-token layer. Trust
// boundary is the HMAC verification inside the handler against the
// per-project secret.
router.post('/integrations/github/webhook', handler.webhookHandler);

export default router;
