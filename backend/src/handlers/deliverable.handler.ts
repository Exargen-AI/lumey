import { Request, Response, NextFunction } from 'express';
import * as deliverableService from '../services/deliverable.service';

export async function listHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await deliverableService.listDeliverables(req.params.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function getHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await deliverableService.getDeliverable(req.params.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function createHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await deliverableService.createDeliverable(req.params.id, req.body, req.user!.id);
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
}

export async function updateHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await deliverableService.updateDeliverable(req.params.id, req.body, req.user!.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function deleteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await deliverableService.deleteDeliverable(req.params.id, req.user!.id);
    res.json({ success: true, data: { message: 'Deliverable deleted' } });
  } catch (err) { next(err); }
}

export async function markDeliveredHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await deliverableService.markDelivered(req.params.id, req.user!.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function signOffHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await deliverableService.signOffDeliverable(req.params.id, req.user!.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function rejectHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await deliverableService.rejectDeliverable(req.params.id, req.body?.note || '', req.user!.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
