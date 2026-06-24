import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import { checkPermission } from '../services/rbac.service';
import { logger } from '../lib/logger';

/**
 * Enforces "must be a project member" for routes that operate on a single
 * project. Reads the project id from `req.params.id` or `req.params.projectId`.
 *
 * Hardened (QA finding #7): if neither param is present, the request is
 * REJECTED with 500 — previously it silently called `next()` and let a future
 * route with a different param name bypass membership entirely.
 */
export async function projectAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
    return;
  }

  // Permission `project.view_all` (super admins) bypasses membership.
  const canViewAllProjects = await checkPermission(req.user.role, 'project.view_all');
  if (canViewAllProjects) {
    return next();
  }

  const projectId = req.params.id || req.params.projectId;
  if (!projectId) {
    // This is a configuration bug — the middleware was mounted on a route
    // whose param doesn't fit the convention. Fail loudly so QA catches it
    // in dev rather than silently letting all auth'd users through in prod.
    logger.error({ method: req.method, path: req.originalUrl }, '[projectAccess] missing :id/:projectId param');
    res.status(500).json({ success: false, error: { code: 'CONFIG_ERROR', message: 'Project access misconfigured' } });
    return;
  }

  const membership = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId: req.user.id, projectId } },
  });

  if (!membership) {
    res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not a member of this project' } });
    return;
  }

  next();
}
