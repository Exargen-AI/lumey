import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { authorizeAny } from '../middleware/authorizeAny';
import { projectAccess } from '../middleware/projectAccess';
import { taskAccess } from '../middleware/taskAccess';
import { validate } from '../middleware/validate';
import {
  createTaskSchema,
  updateTaskSchema,
  moveTaskSchema,
  reorderTaskSchema,
  updateSubtasksSchema,
  updateAcceptanceCriteriaSchema,
  bulkUpdateTasksSchema,
  bulkDeleteTasksSchema,
  requestReviewSchema,
  decideReviewSchema,
  nudgeTaskSchema,
} from '../validators/task.schema';
import { createTaskLinkSchema, deleteTaskLinkSchema, spawnSubtaskSchema } from '../validators/taskLink.schema';
import * as taskHandler from '../handlers/task.handler';
import * as linkHandler from '../handlers/taskLink.handler';

const router = Router();

// Project-scoped task routes
router.get('/projects/:id/tasks', authenticate, projectAccess, taskHandler.listTasksHandler);
// Per-status counts (kanban headers + BoardPage strip). Cheap groupBy; honors
// the same filters as the listing so the numbers match what scrolls in.
router.get('/projects/:id/tasks/counts', authenticate, projectAccess, taskHandler.taskCountsHandler);
// Flat id list for "Select all in column" so bulk ops cover unloaded pages.
router.get('/projects/:id/tasks/ids', authenticate, projectAccess, taskHandler.taskIdsHandler);
// Either permission lets you POST: `task.create` for full task creation (the
// internal path), `task.create_request` for the narrower client-request path.
// The service re-derives the final shape from the actor's role so the
// permission can't be used to elevate (a CLIENT carrying task.create still
// has client-only restrictions applied at the service layer).
router.post('/projects/:id/tasks', authenticate, projectAccess, authorizeAny('task.create', 'task.create_request'), validate(createTaskSchema), taskHandler.createTaskHandler);

// Task-specific routes
router.get('/tasks/:id', authenticate, taskAccess, taskHandler.getTaskHandler);
router.put('/tasks/:id', authenticate, taskAccess, authorizeAny('task.edit_any', 'task.edit_own'), validate(updateTaskSchema), taskHandler.updateTaskHandler);
router.delete('/tasks/:id', authenticate, taskAccess, authorize('task.delete'), taskHandler.deleteTaskHandler);
router.patch('/tasks/:id/status', authenticate, taskAccess, authorize('task.move_status'), validate(moveTaskSchema), taskHandler.moveTaskHandler);
router.patch('/tasks/:id/reorder', authenticate, taskAccess, authorize('task.move_status'), validate(reorderTaskSchema), taskHandler.reorderTaskHandler);

// Sub-task + acceptance-criteria bulk replace. Same RBAC as updateTask
// (assigned engineer can edit own; PM/admin can edit any).
router.patch('/tasks/:id/subtasks',           authenticate, taskAccess, authorizeAny('task.edit_any', 'task.edit_own'), validate(updateSubtasksSchema),           taskHandler.updateSubtasksHandler);
router.patch('/tasks/:id/acceptance-criteria', authenticate, taskAccess, authorizeAny('task.edit_any', 'task.edit_own'), validate(updateAcceptanceCriteriaSchema), taskHandler.updateAcceptanceCriteriaHandler);

// ─── Review workflow ───────────────────────────────────────────────
//
// `request-review` is the explicit "tag someone (incl. the client) to
// review this" action. Gated by either the `task.request_review` role
// permission OR ownership of the task (assignee/creator) — the service
// layer enforces both, so the route just needs the actor to be the task's
// project member.
//
// `review-decision` is intentionally NOT gated by a role permission —
// the service does row-level auth (`task.reviewerId === actor.id` OR
// actor is admin/super_admin). That keeps the gate correct even if a
// role permission is later granted to an unexpected role.
router.post('/tasks/:id/request-review',  authenticate, taskAccess, validate(requestReviewSchema), taskHandler.requestReviewHandler);
router.post('/tasks/:id/review-decision', authenticate, taskAccess, validate(decideReviewSchema),  taskHandler.decideReviewHandler);

// Linked Issues — within-project relationships (BLOCKS / RELATES_TO / DUPLICATES / SPAWNED_FROM).
// Reads share the same access gate as the parent task; writes need edit perms.
router.get('/tasks/:id/links',     authenticate, taskAccess, linkHandler.getTaskLinksHandler);
router.post('/tasks/:id/links',    authenticate, taskAccess, authorizeAny('task.edit_any', 'task.edit_own'), validate(createTaskLinkSchema), linkHandler.createTaskLinkHandler);
router.delete('/links/:linkId',    authenticate, authorizeAny('task.edit_any', 'task.edit_own'), validate(deleteTaskLinkSchema), linkHandler.deleteTaskLinkHandler);
// Spin off a child task atomically (creates the new task + SPAWNED_FROM
// link in one transaction). Gated by task.create OR task.create_request
// so clients can spawn from their own bug submissions.
router.post(
  '/tasks/:id/spawn',
  authenticate,
  taskAccess,
  authorizeAny('task.create', 'task.create_request'),
  validate(spawnSubtaskSchema),
  linkHandler.spawnSubtaskHandler,
);
// Search-for-linking — runs inside the project so projectAccess gates it.
// Query: ?q=<text>&exclude=<sourceTaskId>. Returns up to 20 matches.
router.get('/projects/:id/task-link-search', authenticate, projectAccess, linkHandler.searchTasksForLinkingHandler);

// Bulk ops on a list of task ids. Per-task auth runs in the service so we
// can return granular per-task results (vs. all-or-nothing) — partial
// failure shows up as e.g. "21 succeeded, 2 not authorized". Both routes
// take `taskIds: string[]` (capped at 200 by the validator); update takes
// a `change` patch, delete takes nothing else.
router.patch(
  '/tasks/bulk',
  authenticate,
  authorizeAny('task.edit_any', 'task.edit_own'),
  validate(bulkUpdateTasksSchema),
  taskHandler.bulkUpdateTasksHandler,
);
router.post(
  '/tasks/bulk-delete',
  authenticate,
  authorize('task.delete'),
  validate(bulkDeleteTasksSchema),
  taskHandler.bulkDeleteTasksHandler,
);
// Preview cascade BEFORE the delete fires. Same body shape (`taskIds`).
// QA finding K-C2 — the confirm dialog now surfaces "12 comments,
// 3.5h logged, 2 linked PRs will be affected" so a 50-task delete can't
// silently destroy time-entry attribution.
router.post(
  '/tasks/bulk-delete/preview',
  authenticate,
  authorize('task.delete'),
  validate(bulkDeleteTasksSchema),
  taskHandler.previewBulkDeleteCascadeHandler,
);

// My tasks
router.get('/my-tasks', authenticate, taskHandler.myTasksHandler);

// ─── Subscriptions ─────────────────────────────────────────────────
//
// CC feature PR 2026-05-20. Users follow a task to receive
// notifications on new comments + significant edits. Auto-subscribed
// when they become assignee / reviewer / creator (or @-mentioned in
// a comment); also manually subscribable from the task detail panel.
//
// All three routes gate by `taskAccess` — must be able to read the
// task to subscribe to it.
router.post('/tasks/:id/subscribe', authenticate, taskAccess, taskHandler.subscribeToTaskHandler);
router.delete('/tasks/:id/subscribe', authenticate, taskAccess, taskHandler.unsubscribeFromTaskHandler);
router.get('/tasks/:id/subscribers', authenticate, taskAccess, taskHandler.listTaskSubscribersHandler);

// ─── Nudge ─────────────────────────────────────────────────────────
//
// "Politely poke the assignee about this task." 24h cooldown per
// (task, sender) — anti-spam. Body: optional message. Activity log
// row written per nudge. taskAccess gates project membership; the
// service refuses self-nudge + applies the cooldown.
router.post('/tasks/:id/nudge', authenticate, taskAccess, validate(nudgeTaskSchema), taskHandler.nudgeTaskHandler);

export default router;
