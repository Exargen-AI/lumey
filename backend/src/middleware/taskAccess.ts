import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import { checkPermission, canViewProjectInternal } from '../services/rbac.service';

export async function taskAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
    return;
  }

  const taskId = req.params.id || req.params.taskId;
  if (!taskId) {
    return next();
  }

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { id: true, projectId: true, clientVisible: true },
  });

  if (!task) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Task not found' } });
    return;
  }

  // 2026-06-02: per-PROJECT check so a CLIENT granted full access on this
  // task's project (ProjectMember.fullAccess) — or the legacy global
  // extendedClientAccess flag — can open its internal-only tasks. Scoped to
  // task.projectId so the grant on one project doesn't leak another.
  const canViewInternal = await canViewProjectInternal(req.user, task.projectId);
  if (!canViewInternal && !task.clientVisible) {
    res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } });
    return;
  }

  const canViewAllProjects = await checkPermission(req.user.role, 'project.view_all');
  if (canViewAllProjects) {
    return next();
  }

  const membership = await prisma.projectMember.findUnique({
    where: {
      userId_projectId: {
        userId: req.user.id,
        projectId: task.projectId,
      },
    },
  });

  if (!membership) {
    res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not a member of this project' } });
    return;
  }

  next();
}
