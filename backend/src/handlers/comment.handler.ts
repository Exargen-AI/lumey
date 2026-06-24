import { Request, Response, NextFunction } from 'express';
import * as commentService from '../services/comment.service';

export async function listProjectCommentsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const comments = await commentService.listProjectComments(req.params.id, {
      id: req.user!.id,
      role: req.user!.role,
      canViewAgents: req.user!.canViewAgents,
    });
    res.json({ success: true, data: comments });
  } catch (err) { next(err); }
}

export async function listTaskCommentsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const comments = await commentService.listTaskComments(req.params.id, {
      role: req.user!.role,
      canViewAgents: req.user!.canViewAgents,
    });
    res.json({ success: true, data: comments });
  } catch (err) { next(err); }
}

export async function createProjectCommentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const comment = await commentService.createComment(req.params.id, req.body, req.user!.id);
    res.status(201).json({ success: true, data: comment });
  } catch (err) { next(err); }
}

export async function createTaskCommentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    // Get the task to find projectId
    const task = await (await import('../config/database')).default.task.findUnique({ where: { id: req.params.id } });
    if (!task) { res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Task not found' } }); return; }
    const comment = await commentService.createComment(task.projectId, { ...req.body, taskId: req.params.id }, req.user!.id);
    res.status(201).json({ success: true, data: comment });
  } catch (err) { next(err); }
}

export async function updateCommentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const updated = await commentService.updateComment(
      req.params.id,
      { content: req.body.content, storyData: req.body.storyData },
      req.user!.id,
      req.body.expectedUpdatedAt,
    );
    res.json({ success: true, data: updated });
  } catch (err) { next(err); }
}

export async function deleteCommentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await commentService.deleteComment(req.params.id, req.user!.id);
    res.json({ success: true, data: { message: 'Comment deleted' } });
  } catch (err) { next(err); }
}
