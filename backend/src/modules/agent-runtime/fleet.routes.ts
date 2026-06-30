import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import * as handler from './fleet.handler';

const router = Router();

// Cross-system fleet console. No taskAccess gate (it isn't scoped to one task);
// the service scopes results to what the viewer may see (agent-visibility +
// project membership), so an unauthorised caller just gets an empty fleet.
router.get('/fleet/overview', authenticate, handler.fleetOverviewHandler);
router.get('/fleet/runs', authenticate, handler.fleetRunsHandler);

export default router;
