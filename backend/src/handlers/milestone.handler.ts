import { Request, Response, NextFunction } from 'express';
import * as milestoneService from '../services/milestone.service';

export async function listMilestonesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const milestones = await milestoneService.listMilestones(req.params.id, req.user!);
    res.json({ success: true, data: milestones });
  } catch (err) { next(err); }
}

export async function createMilestoneHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const milestone = await milestoneService.createMilestone(req.params.id, req.body, req.user!.id);
    res.status(201).json({ success: true, data: milestone });
  } catch (err) { next(err); }
}

export async function updateMilestoneHandler(req: Request, res: Response, next: NextFunction) {
  try {
    // Split `expectedUpdatedAt` out of the body before forwarding — it's
    // a control field for optimistic locking, not a Milestone column.
    // Same shape as the Task handler.
    const { expectedUpdatedAt, ...data } = req.body ?? {};
    const milestone = await milestoneService.updateMilestone(
      req.params.id,
      data,
      req.user!.id,
      expectedUpdatedAt,
    );
    res.json({ success: true, data: milestone });
  } catch (err) { next(err); }
}

export async function deleteMilestoneHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await milestoneService.deleteMilestone(req.params.id, req.user!.id);
    res.json({ success: true, data: { message: 'Milestone deleted' } });
  } catch (err) { next(err); }
}
