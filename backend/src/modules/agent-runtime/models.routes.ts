import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import * as handler from './models.handler';

const router = Router();

// Model provider config is deployment infra — admin-only (portfolio view). The
// payload carries no secrets, so a read is safe for any admin.
router.get('/models/providers', authenticate, authorize('analytics.view_portfolio'), handler.listModelProvidersHandler);

export default router;
