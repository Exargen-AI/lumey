import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { projectAccess } from '../middleware/projectAccess';
import { projectScopedResourceAccess } from '../middleware/projectScopedResourceAccess';
import { validate } from '../middleware/validate';
import { createMilestoneSchema, updateMilestoneSchema } from '../validators/milestone.schema';
import * as milestoneHandler from '../handlers/milestone.handler';

const router = Router();

router.get('/projects/:id/milestones', authenticate, projectAccess, milestoneHandler.listMilestonesHandler);
router.post('/projects/:id/milestones', authenticate, projectAccess, authorize('milestone.create'), validate(createMilestoneSchema), milestoneHandler.createMilestoneHandler);
router.put('/milestones/:id', authenticate, projectScopedResourceAccess('milestone', 'id'), authorize('milestone.edit'), validate(updateMilestoneSchema), milestoneHandler.updateMilestoneHandler);
router.delete('/milestones/:id', authenticate, projectScopedResourceAccess('milestone', 'id'), authorize('milestone.edit'), milestoneHandler.deleteMilestoneHandler);

export default router;
