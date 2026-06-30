import type { Request, Response, NextFunction } from 'express';
import { listModelProviders } from './runtime/model/modelProviders';

// GET /api/v1/models/providers — the configured model tiers (local / self-hosted
// / frontier), their status, and which is the default. Redacted: descriptors
// only, never an API key or a credentialed URL.
export async function listModelProvidersHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, data: listModelProviders() });
  } catch (err) {
    next(err);
  }
}
