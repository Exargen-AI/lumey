import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { projectAccess } from '../middleware/projectAccess';
import * as activityHandler from '../handlers/activity.handler';

const router = Router();

router.get('/activities', authenticate, activityHandler.portfolioActivityHandler);
router.get('/projects/:id/activities', authenticate, projectAccess, activityHandler.projectActivityHandler);

export default router;
