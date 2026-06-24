import { Request, Response, NextFunction } from 'express';
import * as service from '../services/projectAcknowledgment.service';
import { captureIp, captureUserAgent } from '../utils/request';

export async function getMyAcknowledgmentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const ack = await service.getMyAcknowledgment(req.user!.id, req.params.id);
    res.json({
      success: true,
      data: {
        acknowledged: !!ack,
        acknowledgedAt: ack?.acknowledgedAt ?? null,
        text: service.CONFIDENTIALITY_TEXT,
      },
    });
  } catch (err) { next(err); }
}

export async function acknowledgeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const ack = await service.acknowledgeProject(req.user!.id, req.params.id, {
      ipAddress: captureIp(req),
      userAgent: captureUserAgent(req),
    });
    res.status(201).json({
      success: true,
      data: {
        acknowledged: true,
        acknowledgedAt: ack.acknowledgedAt,
      },
    });
  } catch (err) { next(err); }
}

export async function listAcknowledgmentsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await service.listAcknowledgmentsForProject(req.params.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
