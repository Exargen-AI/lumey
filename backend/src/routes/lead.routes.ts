import { Router } from 'express';
import { publicCmsLimiter } from '../middleware/rateLimiter';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import * as leadHandlers from '../handlers/leadHandlers';

const router = Router();

// Public ingestion: keyed by :apiKey in the path (matches CMS public style)
router.post('/public/:apiKey/leads', publicCmsLimiter, leadHandlers.ingestPublicLead);

// Admin management
router.get('/leads', authenticate, authorize('leads.view'), leadHandlers.listLeads);
router.get('/leads/:id', authenticate, authorize('leads.view'), leadHandlers.getLead);
router.put('/leads/:id/status', authenticate, authorize('leads.manage'), leadHandlers.updateLeadStatus);

export default router;
