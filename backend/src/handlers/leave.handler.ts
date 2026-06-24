import { Request, Response, NextFunction } from 'express';
import { LeaveStatus } from '@prisma/client';
import * as leaveService from '../services/leave.service';

export async function applyLeaveHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const leave = await leaveService.applyLeave(req.user!.id, req.body);
    res.status(201).json({ success: true, data: leave });
  } catch (err) { next(err); }
}

export async function getMyLeavesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await leaveService.getMyLeaves(req.user!.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function listAllLeavesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const status = typeof req.query.status === 'string'
      ? (req.query.status as LeaveStatus)
      : undefined;
    const data = await leaveService.listAllLeaves(req.user!.id, status ? { status } : undefined);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function getLeaveHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await leaveService.getLeave(req.params.id, req.user!.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function approveLeaveHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await leaveService.approveLeave(req.params.id, req.user!.id, req.body || {});
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function rejectLeaveHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await leaveService.rejectLeave(req.params.id, req.user!.id, req.body || {});
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function revokeApprovedLeaveHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await leaveService.revokeApprovedLeave(req.params.id, req.user!.id, req.body?.decisionNote || '');
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function cancelLeaveHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await leaveService.cancelLeave(req.params.id, req.user!.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function pendingLeaveCountHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const count = await leaveService.getPendingLeaveCount(req.user!.id);
    res.json({ success: true, data: { count } });
  } catch (err) { next(err); }
}

export async function leaveCountsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const counts = await leaveService.getLeaveCounts(req.user!.id);
    res.json({ success: true, data: counts });
  } catch (err) { next(err); }
}
