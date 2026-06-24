import { Request, Response, NextFunction } from 'express';
import * as analyticsService from '../services/analytics.service';

export async function portfolioHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const [metrics, healthOverview, phaseDistribution] = await Promise.all([
      analyticsService.getPortfolioMetrics(),
      analyticsService.getHealthOverview(),
      analyticsService.getPhaseDistribution(),
    ]);
    res.json({ success: true, data: { metrics, healthDistribution: healthOverview, phaseDistribution } });
  } catch (err) { next(err); }
}

export async function projectAnalyticsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await analyticsService.getProjectAnalytics(req.params.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function teamHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const data = await analyticsService.getTeamUtilization();
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function velocityHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const weeks = parseInt(req.query.weeks as string) || 8;
    const data = await analyticsService.getVelocityData(weeks);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function blockerHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const data = await analyticsService.getBlockerAging();
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function taskDistributionHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const data = await analyticsService.getTaskDistribution();
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function pmDashboardHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const data = await analyticsService.getPMDashboard();
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function resourceAllocationHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const data = await analyticsService.getResourceAllocation();
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function portfolioGridHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const data = await analyticsService.getProductHealthGrid();
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function activeStreamHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const data = await analyticsService.getActiveSprintStream();
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function capacitySnapshotHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const data = await analyticsService.getCapacitySnapshot();
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function attentionHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    const data = await analyticsService.getAttentionItems();
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
