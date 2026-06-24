import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { requireRoles } from '../middleware/requireRoles';
import { validate } from '../middleware/validate';
import {
  createUserSchema,
  updateUserSchema,
  resetPasswordSchema,
  setAgentViewersSchema,
} from '../validators/user.schema';
import * as userHandler from '../handlers/user.handler';

const router = Router();

router.get('/', authenticate, authorize('user.view'), userHandler.listUsersHandler);
router.post('/', authenticate, authorize('user.create'), validate(createUserSchema), userHandler.createUserHandler);
// 2026-06-01 — agent-visibility allowlist (SUPER_ADMIN-only). Registered
// BEFORE the `/:id` routes so the literal path isn't captured as an id.
router.put(
  '/agent-viewers',
  authenticate,
  requireRoles('SUPER_ADMIN'),
  validate(setAgentViewersSchema),
  userHandler.setAgentViewersHandler,
);
router.get('/:id', authenticate, authorize('user.view'), userHandler.getUserHandler);
router.put('/:id', authenticate, authorize('user.edit'), validate(updateUserSchema), userHandler.updateUserHandler);
router.put('/:id/reset-password', authenticate, authorize('user.edit'), validate(resetPasswordSchema), userHandler.resetPasswordHandler);
router.delete('/:id', authenticate, authorize('user.deactivate'), userHandler.deactivateUserHandler);

export default router;
