import { Request, Response, NextFunction } from 'express';
import * as todayService from '../services/today.service';

/**
 * `GET /today` — combined Today + This-Week activity feed. See
 * todayService.getActivityFeed for the response shape. Same handler
 * powers the internal `/today` route and the client portal's per-
 * project activity view (via the `projectId` query arg).
 */
export async function getActivityFeedHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await todayService.getActivityFeed(
      req.user!.id,
      req.user!.role,
      {
        date: typeof req.query.date === 'string' ? req.query.date : undefined,
        tzOffsetMinutes: typeof req.query.tz === 'string'
          ? Number.parseInt(req.query.tz, 10)
          : undefined,
        mine: req.query.mine === 'true',
        projectId: typeof req.query.projectId === 'string' ? req.query.projectId : undefined,
      },
      // 2026-06-01 — agent visibility: SUPER_ADMIN implicitly sees
      // agents; everyone else needs the allowlist flag.
      req.user!.role === 'SUPER_ADMIN' || req.user!.canViewAgents === true,
    );
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

/** @deprecated alias kept so any external integration callers don't break. */
export const getDoneTodayHandler = getActivityFeedHandler;
