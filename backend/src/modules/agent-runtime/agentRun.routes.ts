import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { taskAccess } from '../../middleware/taskAccess';
import * as handler from './agentRun.handler';

const router = Router();

// Run visibility is scoped under the task: taskAccess authorises both. Write
// paths (create/transition a run) arrive with the runtime adapter in M2.2.
router.get('/tasks/:id/runs', authenticate, taskAccess, handler.listTaskRunsHandler);
router.get('/tasks/:id/runs/:runId', authenticate, taskAccess, handler.getTaskRunHandler);

export default router;
