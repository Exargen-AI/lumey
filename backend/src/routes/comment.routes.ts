import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { projectAccess } from '../middleware/projectAccess';
import { taskAccess } from '../middleware/taskAccess';
import { validate } from '../middleware/validate';
import { createCommentSchema, commentIdParamSchema, updateCommentSchema } from '../validators/comment.schema';
import * as commentHandler from '../handlers/comment.handler';

const router = Router();

router.get('/projects/:id/comments', authenticate, projectAccess, commentHandler.listProjectCommentsHandler);
router.post('/projects/:id/comments', authenticate, projectAccess, authorize('comment.create'), validate(createCommentSchema), commentHandler.createProjectCommentHandler);
router.get('/tasks/:id/comments', authenticate, taskAccess, commentHandler.listTaskCommentsHandler);
router.post('/tasks/:id/comments', authenticate, taskAccess, authorize('comment.create'), validate(createCommentSchema), commentHandler.createTaskCommentHandler);
// UUID guard short-circuits malformed ids before they hit the DB; the service
// then re-checks project membership for the actor (see comment.service).
// PATCH = author-only edit (Round 2 follow-up R2). DELETE = author OR admin.
// Same UUID guard for both; service does the rest of the authz.
router.patch('/comments/:id', authenticate, validate(updateCommentSchema), commentHandler.updateCommentHandler);
router.delete('/comments/:id', authenticate, validate(commentIdParamSchema), commentHandler.deleteCommentHandler);

export default router;
