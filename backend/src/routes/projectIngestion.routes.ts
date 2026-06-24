import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { projectAccess } from '../middleware/projectAccess';
import { ingestLimiter } from '../middleware/rateLimiter';
import { validate } from '../middleware/validate';
import { parsePlanSchema, commitPlanSchema } from '../validators/projectIngestion.schema';
import * as handler from '../handlers/projectIngestion.handler';

const router = Router();

/**
 * Plan ingestion — parse a markdown plan into a structured tree, then
 * atomically commit the tree as Epics / Sprints / Tasks.
 *
 * Both endpoints require `project.edit` on the target project. Parse is
 * gated too (not just "any authenticated") because the parsed tree
 * contains the project's plan content, which can include sensitive
 * roadmap info — non-members shouldn't get a free preview.
 */

router.post(
  '/projects/:id/ingest/parse',
  authenticate,
  ingestLimiter,
  projectAccess,
  authorize('project.edit'),
  validate(parsePlanSchema),
  handler.parsePlanHandler,
);

router.post(
  '/projects/:id/ingest/commit',
  authenticate,
  ingestLimiter,
  projectAccess,
  authorize('project.edit'),
  validate(commitPlanSchema),
  handler.commitPlanHandler,
);

// Server feature-flag probe for the Smart Parse UI toggle. Authenticated
// so anonymous probing can't enumerate env config, but no project context
// needed — it's a global server capability flag.
router.get(
  '/ingest/smart-parse-status',
  authenticate,
  handler.smartParseStatusHandler,
);

export default router;
