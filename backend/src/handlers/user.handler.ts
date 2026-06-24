import { Request, Response, NextFunction } from 'express';
import * as userService from '../services/user.service';

export async function listUsersHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const users = await userService.listUsers(req.query, {
      role: req.user!.role,
      canViewAgents: req.user!.canViewAgents,
    });
    res.json({ success: true, data: users });
  } catch (err) { next(err); }
}

export async function getUserHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await userService.getUser(req.params.id);
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
}

export async function createUserHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await userService.createUser(req.body, req.user!.id);
    res.status(201).json({ success: true, data: user });
  } catch (err) { next(err); }
}

export async function updateUserHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await userService.updateUser(req.params.id, req.body, req.user!.id);
    res.json({ success: true, data: user });
  } catch (err) { next(err); }
}

export async function resetPasswordHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await userService.resetUserPassword(req.params.id, req.body.newPassword, req.user!.id);
    res.json({ success: true, data: { message: 'Password reset successfully' } });
  } catch (err) { next(err); }
}

export async function deactivateUserHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await userService.deactivateUser(req.params.id, req.user!.id);
    res.json({ success: true, data: { message: 'User deactivated' } });
  } catch (err) { next(err); }
}

/**
 * PUT /users/agent-viewers — replace the agent-visibility allowlist.
 * Body: { userIds: string[] }. SUPER_ADMIN-only (service enforces).
 */
export async function setAgentViewersHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await userService.setAgentViewers(req.body.userIds ?? [], req.user!.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}
