import { Request, Response, NextFunction } from 'express';
import * as epicService from '../services/epic.service';

export async function createEpicHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await epicService.createEpic(req.params.id, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
}

export async function listEpicsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await epicService.getProjectEpics(req.params.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function getEpicDetailHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await epicService.getEpicDetail(req.params.epicId);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function updateEpicHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await epicService.updateEpic(req.params.epicId, req.body);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function deleteEpicHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await epicService.deleteEpic(req.params.epicId);
    res.json({ success: true });
  } catch (err) { next(err); }
}
