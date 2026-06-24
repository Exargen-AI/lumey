import { Request, Response, NextFunction } from 'express';
import * as adminService from '../services/admin.service';

export async function clearSeedDataHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    await adminService.clearSeedData();
    res.json({ success: true, data: { message: 'Seed data cleared' } });
  } catch (err) { next(err); }
}

export async function systemStatsHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const stats = await adminService.getSystemStats();
    res.json({ success: true, data: stats });
  } catch (err) { next(err); }
}

export async function exportDataHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const data = await adminService.exportData();
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
