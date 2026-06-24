import { Request, Response, NextFunction } from 'express';
import * as dailyUpdateService from '../services/dailyUpdate.service';
import { toDateOnlyString } from '../utils/date';

export async function submitHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await dailyUpdateService.submitDailyUpdate(req.user!.id, req.body);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function myUpdatesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const data = await dailyUpdateService.getMyDailyUpdates(req.user!.id, page, limit);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function streakHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await dailyUpdateService.getMyStreak(req.user!.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function statsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const daysBack = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 7));
    const data = await dailyUpdateService.getMyProductivityStats(req.user!.id, daysBack);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function teamHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const date = req.query.date as string || toDateOnlyString(new Date());
    const projectId = req.query.projectId as string | undefined;
    const data = await dailyUpdateService.getTeamDailyUpdates(date, projectId);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function todayStatusHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await dailyUpdateService.getTodayStatus(req.user!.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
