import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { taskAccess } from '../../middleware/taskAccess';
import { authorizeAny } from '../../middleware/authorizeAny';
import * as handler from './agentRun.handler';

const router = Router();

// Read: run visibility, scoped under the task (taskAccess authorises).
router.get('/tasks/:id/runs', authenticate, taskAccess, handler.listTaskRunsHandler);
router.get('/tasks/:id/runs/:runId', authenticate, taskAccess, handler.getTaskRunHandler);

// Write: dispatching / cancelling an agent run is a task action — anyone who
// can edit the task may dispatch an agent on it.
router.post(
  '/tasks/:id/runs',
  authenticate,
  taskAccess,
  authorizeAny('task.edit_any', 'task.edit_own'),
  handler.startTaskRunHandler,
);
router.post(
  '/tasks/:id/runs/:runId/cancel',
  authenticate,
  taskAccess,
  authorizeAny('task.edit_any', 'task.edit_own'),
  handler.cancelTaskRunHandler,
);

export default router;
