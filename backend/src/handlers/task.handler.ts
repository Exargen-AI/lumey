import { Request, Response, NextFunction } from 'express';
import * as taskService from '../services/task.service';
import * as taskSubscriptionService from '../services/taskSubscription.service';

export async function listTasksHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const tasks = await taskService.listTasks(
      req.params.id,
      {
        id: req.user!.id,
        role: req.user!.role,
        canViewAgents: req.user!.canViewAgents,
      },
      req.query,
    );
    res.json({ success: true, data: tasks });
  } catch (err) {
    next(err);
  }
}

// Cheap groupBy — powers the kanban column-header counts and the BoardPage
// status strip. Returns { BACKLOG: n, TODO: n, IN_PROGRESS: n, IN_REVIEW: n,
// DONE: n }. Filters (productId, search, assigneeId, ...) honored so the
// strip stays consistent with the board's current filter view.
export async function taskCountsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const counts = await taskService.countTasksByStatus(
      req.params.id,
      { id: req.user!.id, role: req.user!.role, canViewAgents: req.user!.canViewAgents },
      req.query,
    );
    res.json({ success: true, data: counts });
  } catch (err) { next(err); }
}

// Flat id list for "Select all in column" — bulk ops need to cover unloaded
// pages, so the FE asks for every id matching (status + filters) and feeds
// the result straight into the selection store.
export async function taskIdsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const ids = await taskService.listTaskIds(
      req.params.id,
      { id: req.user!.id, role: req.user!.role, canViewAgents: req.user!.canViewAgents },
      req.query,
    );
    res.json({ success: true, data: ids });
  } catch (err) { next(err); }
}

export async function getTaskHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const task = await taskService.getTask(req.params.id, {
      id: req.user!.id,
      role: req.user!.role,
      canViewAgents: req.user!.canViewAgents,
    });
    res.json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
}

export async function createTaskHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const task = await taskService.createTask(
      req.params.id,
      req.body,
      req.user!.id,
      req.user!.role,
    );
    res.status(201).json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
}

export async function updateTaskHandler(req: Request, res: Response, next: NextFunction) {
  try {
    // 2026-05-15 optimistic-locking audit: pull expectedUpdatedAt
    // out of the body and pass it as a separate arg to the service
    // so the data payload stays clean (the field isn't a column on
    // Task — it's a precondition for the write). Falls back to
    // undefined for older clients that don't send it.
    const { expectedUpdatedAt, ...data } = req.body ?? {};
    const task = await taskService.updateTask(
      req.params.id,
      data,
      req.user!.id,
      req.user!.role,
      req.user!.userType,
      expectedUpdatedAt,
    );
    res.json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
}

export async function deleteTaskHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await taskService.deleteTask(req.params.id, req.user!.id);
    res.json({ success: true, data: { message: 'Task deleted' } });
  } catch (err) {
    next(err);
  }
}

export async function moveTaskHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const task = await taskService.moveTask(
      req.params.id,
      req.body.status,
      req.body.sortOrder,
      req.user!.id,
      { userType: req.user!.userType, role: req.user!.role },
      req.body.expectedUpdatedAt,
    );
    res.json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
}

export async function reorderTaskHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const task = await taskService.reorderTask(req.params.id, req.body.sortOrder);
    res.json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
}

export async function bulkUpdateTasksHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await taskService.bulkUpdateTasks(
      req.body.taskIds,
      req.body.change,
      req.user!.id,
      req.user!.role,
      req.user!.userType,
    );
    // 200 even when some fail — the per-task results telegraph the partial
    // outcome. Caller must inspect `failed` to decide UX.
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function bulkDeleteTasksHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await taskService.bulkDeleteTasks(
      req.body.taskIds,
      req.user!.id,
      req.user!.role,
    );
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

/**
 * Preview-cascade endpoint for the bulk-delete confirm dialog. Returns
 * counts of comments / time entries / linked PRs / etc. that will be
 * affected when the listed tasks are deleted. Read-only; no mutation.
 */
export async function previewBulkDeleteCascadeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    // userId + userRole drive the per-task membership filter — super-
    // admins bypass; everyone else gets their taskIds intersected with
    // their project memberships before the aggregates run.
    const data = await taskService.previewBulkDeleteCascade(
      req.body.taskIds || [],
      req.user!.id,
      req.user!.role,
    );
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function myTasksHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const tasks = await taskService.getMyTasks(req.user!.id, req.user!.role);
    res.json({ success: true, data: tasks });
  } catch (err) {
    next(err);
  }
}

export async function updateSubtasksHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const updated = await taskService.updateSubtasks(req.params.id, req.body.subtasks, req.user!.id);
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function updateAcceptanceCriteriaHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const updated = await taskService.updateAcceptanceCriteria(
      req.params.id,
      req.body.acceptanceCriteria,
      req.user!.id,
    );
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function requestReviewHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const task = await taskService.requestReview(
      req.params.id,
      req.body.reviewerId,
      req.body.note ?? null,
      { id: req.user!.id, role: req.user!.role, userType: req.user!.userType },
    );
    res.json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
}

export async function decideReviewHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const task = await taskService.decideReview(
      req.params.id,
      req.body.decision,
      req.body.comment ?? null,
      { id: req.user!.id, role: req.user!.role, userType: req.user!.userType },
    );
    res.json({ success: true, data: task });
  } catch (err) {
    next(err);
  }
}

// ─── Subscriptions + nudge (CC feature PR 2026-05-20) ──────────────

/**
 * POST /tasks/:id/subscribe — caller follows the task. Idempotent;
 * re-subscribing is a no-op at the service layer.
 */
export async function subscribeToTaskHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await taskSubscriptionService.subscribeToTask(req.params.id, req.user!.id, 'MANUAL');
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /tasks/:id/subscribe — caller unfollows. Idempotent;
 * unsubscribe when not subscribed is a no-op.
 */
export async function unsubscribeFromTaskHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await taskSubscriptionService.unsubscribeFromTask(req.params.id, req.user!.id);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /tasks/:id/subscribers — list everyone subscribed (with their
 * `source` so the FE can render the "why" badge).
 */
export async function listTaskSubscribersHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const subscribers = await taskSubscriptionService.listTaskSubscribers(req.params.id);
    res.json({ success: true, data: subscribers });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /tasks/:id/nudge — politely poke the task's assignee. Body
 * may include an optional `message`. Service applies the 24h
 * cooldown (per task/sender pair) + self-nudge refusal.
 */
export async function nudgeTaskHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const message = req.body?.message ? String(req.body.message).trim() : null;
    await taskService.nudgeTask(req.params.id, req.user!.id, message);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}
