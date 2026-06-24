import { Request, Response, NextFunction } from 'express';
import * as service from '../services/taskLink.service';

export async function getTaskLinksHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await service.getTaskLinks(req.params.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function createTaskLinkHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await service.createTaskLink(req.params.id, req.body, req.user!.id);
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
}

export async function deleteTaskLinkHandler(req: Request, res: Response, next: NextFunction) {
  try {
    // userRole drives the membership-bypass check on `project.view_all`;
    // the service enforces the membership gate that the route can't
    // (linkId-keyed routes can't be guarded by taskAccess middleware).
    await service.deleteTaskLink(req.params.linkId, req.user!.id, req.user!.role);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function spawnSubtaskHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const child = await service.spawnSubtask(req.params.id, req.body, req.user!.id);
    res.status(201).json({ success: true, data: child });
  } catch (err) { next(err); }
}

export async function searchTasksForLinkingHandler(req: Request, res: Response, next: NextFunction) {
  try {
    // projectId comes from the path (`projects/:id/...`); projectAccess middleware
    // already verified the caller can read it. exclude is the source taskId so
    // we don't suggest the task as a link to itself.
    const projectId = req.params.id;
    const query     = String(req.query.q ?? '');
    const excludeId = String(req.query.exclude ?? '');
    if (!excludeId) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'exclude is required' } });
      return;
    }
    // userRole drives the clientVisible filter — CLIENT viewers don't
    // see internal task titles in the link-search autocomplete.
    const data = await service.searchTasksForLinking(projectId, query, excludeId, req.user!.role);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
