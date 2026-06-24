import { Request, Response, NextFunction } from 'express';
import * as decisionService from '../services/decision.service';

export async function listDecisionsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const decisions = await decisionService.listDecisions(req.params.id, req.query);
    res.json({ success: true, data: decisions });
  } catch (err) { next(err); }
}

export async function createDecisionHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const decision = await decisionService.createDecision(req.params.id, req.body, req.user!.id);
    res.status(201).json({ success: true, data: decision });
  } catch (err) { next(err); }
}

export async function updateDecisionHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const decision = await decisionService.updateDecision(req.params.id, req.body, req.user!.id);
    res.json({ success: true, data: decision });
  } catch (err) { next(err); }
}

export async function deleteDecisionHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await decisionService.deleteDecision(req.params.id, req.user!.id);
    res.json({ success: true, data: { message: 'Decision deleted' } });
  } catch (err) { next(err); }
}
