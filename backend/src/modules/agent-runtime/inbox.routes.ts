import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import * as handler from './inbox.handler';

const router = Router();

// Cross-task HITL inbox. No taskAccess gate (it isn't scoped to one task); the
// service scopes results to what the viewer may see.
router.get('/inbox', authenticate, handler.listInboxHandler);

export default router;
