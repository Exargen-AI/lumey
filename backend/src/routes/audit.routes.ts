import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import * as handler from '../handlers/audit.handler';

const router = Router();

// Compliance audit export — admin only (portfolio view). The service further
// scopes rows to the viewer's projects + agent-visibility.
router.get('/audit/export', authenticate, authorize('analytics.view_portfolio'), handler.exportAuditHandler);

export default router;
