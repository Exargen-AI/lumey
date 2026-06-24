import { Request, Response, NextFunction } from 'express';
import { canViewProjectInternal, checkPermission } from '../services/rbac.service';

/**
 * Gate a project-scoped read on "can this user see the FULL internal
 * project". Run it AFTER `projectAccess` (which proves membership).
 *
 * Allows:
 *   - staff (role-level `task.view_internal`),
 *   - the legacy global client flag (`User.extendedClientAccess`),
 *   - per-project full-access clients (`ProjectMember.fullAccess`).
 *
 * The optional `fallbackPermission` lets a role that holds it through even
 * if it lacks `task.view_internal` — e.g. `decision.view` on the decisions
 * read — which defends against a runtime RBAC-matrix edit that grants the
 * read permission to a role without the internal-task one.
 *
 * Expects the project id at `req.params.id` (the `/projects/:id/...` shape).
 */
export function requireProjectInternalAccess(fallbackPermission?: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
      return;
    }
    const projectId = req.params.id;
    if (await canViewProjectInternal(req.user, projectId)) {
      next();
      return;
    }
    if (fallbackPermission && (await checkPermission(req.user.role, fallbackPermission))) {
      next();
      return;
    }
    res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Access denied' } });
  };
}
