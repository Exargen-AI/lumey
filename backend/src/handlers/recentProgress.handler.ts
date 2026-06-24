import { Request, Response, NextFunction } from 'express';
import * as service from '../services/recentProgress.service';

/**
 * GET /projects/:id/recent-progress
 *
 * Query string:
 *   ?days={N}  — window in days (default 7, clamped to 1..90)
 *   ?limit={N} — top-N items (default 3, clamped to 1..20)
 *
 * Access: `projectAccess` middleware gates this to project members
 * including CLIENT-role users (the primary audience).
 */
export async function recentProgressHandler(req: Request, res: Response, next: NextFunction) {
  try {
    // Parse + sanitize query string. Service clamps too — defense in depth.
    const days = req.query.days ? Number(req.query.days) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const result = await service.getRecentProgress(
      req.params.id,
      Number.isFinite(days) ? (days as number) : undefined,
      Number.isFinite(limit) ? (limit as number) : undefined,
    );
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}
