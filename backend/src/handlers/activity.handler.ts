import { Request, Response, NextFunction } from 'express';
import prisma from '../config/database';
import { checkPermission } from '../services/rbac.service';

export async function portfolioActivityHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { project, user: userId, action, limit = '50' } = req.query;
    const canViewPortfolio = await checkPermission(req.user!.role, 'analytics.view_portfolio');
    const canViewProject = await checkPermission(req.user!.role, 'analytics.view_project');

    if (!canViewPortfolio && !canViewProject) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }

    const where: any = {};
    if (userId) where.userId = userId;
    if (action) where.action = action;

    if (canViewPortfolio) {
      if (project) where.projectId = project;
    } else {
      const memberships = await prisma.projectMember.findMany({
        where: { userId: req.user!.id },
        select: { projectId: true },
      });
      const allowedProjectIds = memberships.map((membership) => membership.projectId);

      if (allowedProjectIds.length === 0) {
        res.json({ success: true, data: [] });
        return;
      }

      if (project) {
        if (!allowedProjectIds.includes(project as string)) {
          res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Project activity is outside your access scope' } });
          return;
        }
        where.projectId = project;
      } else {
        where.projectId = { in: allowedProjectIds };
      }
    }

    const activities = await prisma.activity.findMany({
      where,
      include: {
        user: { select: { id: true, name: true } },
        project: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: 'desc' },
      // Cap user-supplied limit (QA finding #42). Without this, ?limit=999999
      // pulls a million rows; default 50 matches what the activity feed UI
      // actually shows, max 500 covers any "show more" expansion.
      take: Math.min(Math.max(parseInt(limit as string, 10) || 50, 1), 500),
    });

    res.json({ success: true, data: activities });
  } catch (err) { next(err); }
}

export async function projectActivityHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const activities = await prisma.activity.findMany({
      where: { projectId: req.params.id },
      include: {
        user: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    res.json({ success: true, data: activities });
  } catch (err) { next(err); }
}
