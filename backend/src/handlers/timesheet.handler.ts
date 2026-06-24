import { Request, Response, NextFunction } from 'express';
import * as timesheetService from '../services/timesheet.service';
import { toDateOnlyString } from '../utils/date';

export async function logTimeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await timesheetService.logTime(req.user!.id, req.body);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function bulkLogTimeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    if (!Array.isArray(req.body.entries) || req.body.entries.length > 50) {
      return res.status(400).json({ success: false, error: { message: 'entries must be an array (max 50)' } });
    }
    const data = await timesheetService.bulkLogTime(req.user!.id, req.body.entries);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function weeklyTimesheetHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const weekStart = req.query.weekStart as string || toDateOnlyString(getMonday(new Date()));
    const data = await timesheetService.getMyWeeklyTimesheet(req.user!.id, weekStart);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function deleteTimeEntryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await timesheetService.deleteTimeEntry(req.params.id, req.user!.id);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function timesheetStatusHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const weekStart = req.query.weekStart as string || toDateOnlyString(getMonday(new Date()));
    const data = await timesheetService.getTimesheetStatus(req.user!.id, weekStart);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function submitTimesheetHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await timesheetService.submitTimesheet(req.user!.id, req.body.weekStart);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function approveTimesheetHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await timesheetService.approveTimesheet(req.params.id, req.user!.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function rejectTimesheetHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const reason = req.body.reason || '';
    const data = await timesheetService.rejectTimesheet(req.params.id, req.user!.id, reason);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function pendingApprovalsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    // Status filter for the history tabs. Validator already restricts to the
    // four allowed values; default of SUBMITTED keeps backward compat for
    // any caller hitting `/timesheet/pending` without the param.
    const status = (req.query.status as timesheetService.ApprovalStatusFilter | undefined) ?? 'SUBMITTED';
    const data = await timesheetService.listApprovals({ status });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function approvalCountsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const data = await timesheetService.getApprovalCounts();
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function reopenTimesheetHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await timesheetService.reopenTimesheet(req.user!.id, req.body.weekStart);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}
