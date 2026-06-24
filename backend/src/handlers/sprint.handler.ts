import { Request, Response, NextFunction } from 'express';
import { UserRole } from '@prisma/client';
import prisma from '../config/database';
import * as sprintService from '../services/sprint.service';

// Helper to verify user has access to a sprint's project
async function verifySprintAccess(sprintId: string, userId: string, userRole: string) {
  const sprint = await prisma.sprint.findUnique({ where: { id: sprintId }, select: { projectId: true } });
  if (!sprint) throw new Error('Sprint not found');
  if (userRole === 'SUPER_ADMIN' || userRole === 'ADMIN') return sprint;
  const member = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId, projectId: sprint.projectId } },
  });
  if (!member) throw new Error('Access denied — not a member of this project');
  return sprint;
}

export async function createSprintHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await sprintService.createSprint(req.params.id, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
}

export async function listSprintsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await sprintService.getProjectSprints(req.params.id, req.user!);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function sprintDetailHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await verifySprintAccess(req.params.sprintId, req.user!.id, req.user!.role);
    const data = await sprintService.getSprintDetail(req.params.sprintId);
    if (!data) return res.status(404).json({ success: false, error: { message: 'Sprint not found' } });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function activeSprintHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await sprintService.getActiveSprint(req.params.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function updateSprintHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await verifySprintAccess(req.params.sprintId, req.user!.id, req.user!.role);
    const { expectedUpdatedAt, ...body } = req.body ?? {};
    const data = await sprintService.updateSprint(req.params.sprintId, body, expectedUpdatedAt);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function deleteSprintHandler(req: Request, res: Response, next: NextFunction) {
  try {
    // verifySprintAccess admits the SUPER_ADMIN/ADMIN bypass and
    // membership; the route layer ALSO requires `project.edit` so a CLIENT
    // member can't slip through.
    await verifySprintAccess(req.params.sprintId, req.user!.id, req.user!.role);
    const data = await sprintService.deleteSprint(req.params.sprintId);
    // Audit fire-and-forget — the service rolled the FK rebind into the
    // same tx, so the audit being best-effort is OK (failure leaves the
    // delete intact, which is the operator's intent anyway).
    const { logActivity } = await import('../services/activity.service');
    logActivity({
      userId: req.user!.id,
      projectId: data.projectId,
      action: 'deleted_sprint',
      targetType: 'sprint',
      targetId: req.params.sprintId,
      details: { name: data.name, unparkedTasks: data.unparkedTasks },
    }).catch(() => { /* non-blocking */ });
    res.json({ success: true, data: { message: 'Sprint deleted', unparkedTasks: data.unparkedTasks } });
  } catch (err) { next(err); }
}

export async function startSprintHandler(req: Request, res: Response, next: NextFunction) {
  try {
    // userId is forwarded so the service can write the `started_sprint`
    // audit row + fire the project-wide notification. Pre-2026-05-15
    // this handler called startSprint with just (sprintId, projectId)
    // — no actor identity, so the activity stream had a hole.
    const data = await sprintService.startSprint(req.params.sprintId, req.params.id, req.user!.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function completeSprintHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await verifySprintAccess(req.params.sprintId, req.user!.id, req.user!.role);
    // Backwards-compat: legacy callers send `{ moveToBacklog: boolean }`. The
    // new shape is `{ retro, carryOver, carryOverTaskIds, carryOverToSprintId }`.
    const body = req.body ?? {};
    const legacyMoveToBacklog = body.moveToBacklog;
    const data = await sprintService.completeSprint(
      req.params.sprintId,
      {
        retro: body.retro,
        carryOver: body.carryOver ?? (legacyMoveToBacklog === false ? 'none' : 'all'),
        carryOverTaskIds: body.carryOverTaskIds,
        carryOverToSprintId: body.carryOverToSprintId ?? null,
      },
      req.user!.id,
    );
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function sprintBurnupHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await verifySprintAccess(req.params.sprintId, req.user!.id, req.user!.role);
    const data = await sprintService.getSprintBurnup(req.params.sprintId);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function backlogHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await sprintService.getBacklog(req.params.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function assignToSprintHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await sprintService.assignTaskToSprint(req.params.taskId, req.body.sprintId, req.user!.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
