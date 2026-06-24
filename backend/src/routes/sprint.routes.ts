import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { authorizeAny } from '../middleware/authorizeAny';
import { projectAccess } from '../middleware/projectAccess';
import { taskAccess } from '../middleware/taskAccess';
import { projectScopedResourceAccess } from '../middleware/projectScopedResourceAccess';
import { validate } from '../middleware/validate';
import { createSprintSchema, updateSprintSchema, completeSprintSchema, createEpicSchema, updateEpicSchema, assignTaskToSprintSchema } from '../validators/sprint.schema';
import * as sprintHandler from '../handlers/sprint.handler';
import * as epicHandler from '../handlers/epic.handler';

const router = Router();

// Sprint endpoints (project-scoped)
router.get('/projects/:id/sprints', authenticate, projectAccess, sprintHandler.listSprintsHandler);
router.post('/projects/:id/sprints', authenticate, projectAccess, authorize('project.edit'), validate(createSprintSchema), sprintHandler.createSprintHandler);
router.get('/projects/:id/sprints/active', authenticate, projectAccess, sprintHandler.activeSprintHandler);
router.get('/projects/:id/backlog', authenticate, projectAccess, sprintHandler.backlogHandler);

// Sprint-specific (verify project access in handler)
router.get('/sprints/:sprintId', authenticate, projectScopedResourceAccess('sprint', 'sprintId'), sprintHandler.sprintDetailHandler);
router.put('/sprints/:sprintId', authenticate, projectScopedResourceAccess('sprint', 'sprintId'), authorize('project.edit'), validate(updateSprintSchema), sprintHandler.updateSprintHandler);
// DELETE refuses ACTIVE/COMPLETED sprints in the service layer (Round 2
// follow-up R5). Same projectScopedResourceAccess + project.edit gate as
// PUT — only project editors can delete planning artifacts.
router.delete('/sprints/:sprintId', authenticate, projectScopedResourceAccess('sprint', 'sprintId'), authorize('project.edit'), sprintHandler.deleteSprintHandler);
router.post('/projects/:id/sprints/:sprintId/start', authenticate, projectAccess, authorize('project.edit'), sprintHandler.startSprintHandler);
router.post('/sprints/:sprintId/complete', authenticate, projectScopedResourceAccess('sprint', 'sprintId'), authorize('project.edit'), validate(completeSprintSchema), sprintHandler.completeSprintHandler);
router.get('/sprints/:sprintId/burnup',    authenticate, projectScopedResourceAccess('sprint', 'sprintId'), sprintHandler.sprintBurnupHandler);

// Task-sprint assignment
router.patch('/tasks/:taskId/sprint', authenticate, taskAccess, authorizeAny('task.edit_any', 'task.edit_own'), validate(assignTaskToSprintSchema), sprintHandler.assignToSprintHandler);

// Epic endpoints (project-scoped)
router.get('/projects/:id/epics', authenticate, projectAccess, epicHandler.listEpicsHandler);
router.post('/projects/:id/epics', authenticate, projectAccess, authorize('project.edit'), validate(createEpicSchema), epicHandler.createEpicHandler);
router.get('/epics/:epicId', authenticate, projectScopedResourceAccess('epic', 'epicId'), epicHandler.getEpicDetailHandler);
router.put('/epics/:epicId', authenticate, projectScopedResourceAccess('epic', 'epicId'), authorize('project.edit'), validate(updateEpicSchema), epicHandler.updateEpicHandler);
router.delete('/epics/:epicId', authenticate, projectScopedResourceAccess('epic', 'epicId'), authorize('project.edit'), epicHandler.deleteEpicHandler);

export default router;
