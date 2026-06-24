import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { projectAccess } from '../middleware/projectAccess';
import { validate } from '../middleware/validate';
import { createStatusUpdateSchema } from '../validators/statusUpdate.schema';
import * as statusUpdateHandler from '../handlers/statusUpdate.handler';

const router = Router();

router.get('/projects/:id/status-updates', authenticate, projectAccess, statusUpdateHandler.listStatusUpdatesHandler);
router.post('/projects/:id/status-updates', authenticate, projectAccess, authorize('project.set_health'), validate(createStatusUpdateSchema), statusUpdateHandler.createStatusUpdateHandler);

export default router;
