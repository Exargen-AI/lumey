import type { Request, Response, NextFunction } from 'express';
import { RunStatus } from '@prisma/client';
import { getFleetOverview, listFleetRuns } from '../../services/fleet.service';

function viewer(req: Request) {
  return { id: req.user!.id, role: req.user!.role, canViewAgents: req.user!.canViewAgents };
}

// GET /api/v1/fleet/overview — lifecycle distribution, 24h throughput, per-agent
// rollup. Empty for a viewer who can't see the fleet (scoped in the service).
export async function fleetOverviewHandler(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, data: await getFleetOverview(viewer(req)) });
  } catch (err) {
    next(err);
  }
}

// GET /api/v1/fleet/runs?status=&limit=&offset= — recent runs across the visible fleet.
export async function fleetRunsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const statusRaw = String(req.query.status ?? '');
    const status = (Object.values(RunStatus) as string[]).includes(statusRaw) ? (statusRaw as RunStatus) : undefined;
    const runs = await listFleetRuns(viewer(req), {
      status,
      limit: Number(req.query.limit) || undefined,
      offset: Number(req.query.offset) || undefined,
    });
    res.json({ success: true, data: runs });
  } catch (err) {
    next(err);
  }
}
