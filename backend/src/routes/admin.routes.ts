import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { requireRoles } from '../middleware/requireRoles';
import * as adminHandler from '../handlers/admin.handler';

const router = Router();

router.post('/clear-seed-data', authenticate, requireRoles('SUPER_ADMIN'), authorize('rbac.manage'), adminHandler.clearSeedDataHandler);
router.post('/export', authenticate, requireRoles('SUPER_ADMIN'), authorize('rbac.manage'), adminHandler.exportDataHandler);
router.get('/system-stats', authenticate, requireRoles('SUPER_ADMIN'), authorize('analytics.view_portfolio'), adminHandler.systemStatsHandler);

export default router;
