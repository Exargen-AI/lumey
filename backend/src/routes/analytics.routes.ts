import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { projectAccess } from '../middleware/projectAccess';
import * as analyticsHandler from '../handlers/analytics.handler';
import * as dailyUpdateHandler from '../handlers/dailyUpdate.handler';

const router = Router();

// Personal productivity (any authenticated user sees their own)
router.get('/my-productivity', authenticate, dailyUpdateHandler.statsHandler);

router.get('/portfolio', authenticate, authorize('analytics.view_portfolio'), analyticsHandler.portfolioHandler);
router.get('/projects/:id', authenticate, projectAccess, authorize('analytics.view_project'), analyticsHandler.projectAnalyticsHandler);
router.get('/team', authenticate, authorize('analytics.view_team'), analyticsHandler.teamHandler);
router.get('/velocity', authenticate, authorize('analytics.view_portfolio'), analyticsHandler.velocityHandler);
router.get('/blockers', authenticate, authorize('analytics.view_portfolio'), analyticsHandler.blockerHandler);
router.get('/task-distribution', authenticate, authorize('analytics.view_portfolio'), analyticsHandler.taskDistributionHandler);
router.get('/pm-dashboard', authenticate, authorize('analytics.view_portfolio'), analyticsHandler.pmDashboardHandler);
router.get('/resource-allocation', authenticate, authorize('analytics.view_team'), analyticsHandler.resourceAllocationHandler);

// Studio Portfolio Home — the four bands of /dashboard.
router.get('/portfolio-grid',  authenticate, authorize('analytics.view_portfolio'), analyticsHandler.portfolioGridHandler);
router.get('/active-stream',   authenticate, authorize('analytics.view_portfolio'), analyticsHandler.activeStreamHandler);
router.get('/capacity',        authenticate, authorize('analytics.view_portfolio'), analyticsHandler.capacitySnapshotHandler);
router.get('/attention',       authenticate, authorize('analytics.view_portfolio'), analyticsHandler.attentionHandler);

export default router;
