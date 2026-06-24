import { Request, Response, NextFunction } from 'express';
import * as statusUpdateService from '../services/statusUpdate.service';

export async function listStatusUpdatesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const updates = await statusUpdateService.listStatusUpdates(req.params.id);
    res.json({ success: true, data: updates });
  } catch (err) { next(err); }
}

export async function createStatusUpdateHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const update = await statusUpdateService.createStatusUpdate(req.params.id, req.body, req.user!.id);
    res.status(201).json({ success: true, data: update });
  } catch (err) { next(err); }
}
