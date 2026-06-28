import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { taskAccess } from '../../middleware/taskAccess';
import { authorizeAny } from '../../middleware/authorizeAny';
import * as handler from './agentRun.handler';
import * as stream from './runStream/runStream.handler';

const router = Router();

// Read: run visibility, scoped under the task (taskAccess authorises).
router.get('/tasks/:id/runs', authenticate, taskAccess, handler.listTaskRunsHandler);
router.get('/tasks/:id/runs/:runId', authenticate, taskAccess, handler.getTaskRunHandler);

// Live trace (SSE). The ticket POST is Bearer-authenticated + taskAccess-gated;
// the GET stream is authenticated by *consuming* that single-use ticket, since a
// browser EventSource cannot send an Authorization header. See runStream/.
router.post(
  '/tasks/:id/runs/:runId/stream-ticket',
  authenticate,
  taskAccess,
  stream.issueStreamTicketHandler,
);
router.get('/tasks/:id/runs/:runId/stream', stream.streamRunHandler);

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
router.post(
  '/tasks/:id/runs/:runId/pause',
  authenticate,
  taskAccess,
  authorizeAny('task.edit_any', 'task.edit_own'),
  handler.pauseTaskRunHandler,
);
router.post(
  '/tasks/:id/runs/:runId/resume',
  authenticate,
  taskAccess,
  authorizeAny('task.edit_any', 'task.edit_own'),
  handler.resumeTaskRunHandler,
);

// HITL clarifications: read the agent's questions (visibility), and answer one
// (a task action — same authz as dispatch/cancel).
router.get(
  '/tasks/:id/runs/:runId/clarifications',
  authenticate,
  taskAccess,
  handler.listRunClarificationsHandler,
);
router.post(
  '/tasks/:id/runs/:runId/clarifications/:clarificationId/answer',
  authenticate,
  taskAccess,
  authorizeAny('task.edit_any', 'task.edit_own'),
  handler.answerClarificationHandler,
);

export default router;
