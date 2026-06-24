import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { projectAccess } from '../middleware/projectAccess';
import * as handler from '../handlers/recentProgress.handler';

const router = Router();

router.get(
  '/projects/:id/recent-progress',
  authenticate,
  projectAccess,
  handler.recentProgressHandler,
);

export default router;
