import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { projectAccess } from '../middleware/projectAccess';
import * as handler from '../handlers/currentSprint.handler';

const router = Router();

router.get(
  '/projects/:id/current-sprint',
  authenticate,
  projectAccess,
  handler.currentSprintHandler,
);

export default router;
