import { Request, Response, NextFunction } from 'express';
import { checkPermissionForUser } from '../services/rbac.service';

export function authorizeAny(...permissionKeys: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
      return;
    }

    // 2026-05-30: per-user permission check (extended CLIENT access).
    // Same fall-through to role-level grant as the single-permission
    // `authorize()` — only differs when a CLIENT has the per-user flag
    // AND the requested permission is in
    // `EXTENDED_CLIENT_ADDITIONAL_PERMISSIONS`.
    const permissionChecks = await Promise.all(
      permissionKeys.map((permissionKey) => checkPermissionForUser(req.user!, permissionKey)),
    );

    if (!permissionChecks.some(Boolean)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } });
      return;
    }

    next();
  };
}
