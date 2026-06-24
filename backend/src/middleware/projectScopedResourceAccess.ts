import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import { checkPermission } from '../services/rbac.service';

type ResourceModel = 'sprint' | 'epic' | 'milestone' | 'decision' | 'deliverable' | 'customFieldDefinition' | 'projectDocument';

export function projectScopedResourceAccess(model: ResourceModel, paramName: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
      return;
    }

    const resourceId = req.params[paramName];
    if (!resourceId) {
      return next();
    }

    const delegate = (prisma as any)[model];
    const resource = await delegate.findUnique({
      where: { id: resourceId },
      select: { projectId: true },
    });

    if (!resource) {
      res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `${model} not found` } });
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
          projectId: resource.projectId,
        },
      },
    });

    if (!membership) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Not a member of this project' } });
      return;
    }

    next();
  };
}
