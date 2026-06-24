import { Request, Response, NextFunction } from 'express';
import * as service from '../services/clientCompliance.service';

export async function getProjectComplianceHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await service.getProjectCompliance(req.params.id);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}
