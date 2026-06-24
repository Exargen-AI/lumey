import { Request, Response, NextFunction } from 'express';
import { checkPermissionForUser } from '../services/rbac.service';
import { securityLogger } from '../lib/logger';

export function authorize(permissionKey: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
      return;
    }

    // 2026-05-30: switched from `checkPermission(role, key)` to
    // `checkPermissionForUser(user, key)` so per-user additive grants
    // (extended CLIENT access) are honoured. The function falls back to
    // the same role-level check when no per-user grant applies, so
    // every existing gate behaves identically for every existing role.
    const hasPermission = await checkPermissionForUser(req.user, permissionKey);
    if (!hasPermission) {
      // 2026-06-01 hardening — log authZ denials so a privilege-
      // escalation probe leaves a trace. The 403 BODY stays generic
      // (no permission name leaked to the client); the detail goes to
      // the security log only.
      securityLogger.warn(
        { event: 'authz_denied', userId: req.user.id, role: req.user.role, permission: permissionKey, method: req.method, path: req.originalUrl },
        'permission denied',
      );
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }

    next();
  };
}
