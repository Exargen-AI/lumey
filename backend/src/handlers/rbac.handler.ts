import { Request, Response, NextFunction } from 'express';
import * as rbacService from '../services/rbac.service';

export async function getPermissionsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const permissions = await rbacService.getAllPermissions();
    res.json({ success: true, data: permissions });
  } catch (err) {
    next(err);
  }
}

export async function getRolesHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const roles = await rbacService.getRolesWithPermissions();
    res.json({ success: true, data: roles });
  } catch (err) {
    next(err);
  }
}

export async function updateRoleHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { role } = req.params as any;
    const { permissions } = req.body;
    await rbacService.updateRolePermissions(role, permissions, req.user?.id);
    res.json({ success: true, data: { message: 'Role permissions updated' } });
  } catch (err) {
    next(err);
  }
}

