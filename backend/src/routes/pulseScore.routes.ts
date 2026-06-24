/**
 * Pulse productivity score — SUPER_ADMIN API surface (Wave 5).
 *
 * Six endpoints, all triple-gated:
 *
 *   1. `authenticate`                      — must have a valid JWT.
 *   2. `requireRoles('SUPER_ADMIN')`       — generic SUPER_ADMIN check.
 *   3. `requireProductivityScoreAccess`    — named, audit-grade gate
 *      whose distinct error code (`PRODUCTIVITY_SCORE_FORBIDDEN`) makes
 *      attempted cross-employee score peeks visible in log search.
 *
 * The triple-gate is belt-and-braces by design (founder directive
 * 2026-05-29 — "remember only super admin has access to all these
 * metrics right?, make sure only super admin is allowed"). Even if a
 * future refactor accidentally drops `requireRoles`, the named
 * `requireProductivityScoreAccess` gate still holds. Even if THAT is
 * dropped, `authenticate` at least keeps anonymous traffic out and the
 * tripwire tests will fail loudly in CI.
 *
 * The breakdown endpoint reads up to 500 productivity_events rows for
 * the audit drawer — a hard cap, not paginated, because the UI shows a
 * fixed-height scroll list. If a single (user, window, cadence)
 * actually produces > 500 events, that's a flag-worthy outlier and
 * we'd rather truncate visibly than paginate silently.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requireRoles } from '../middleware/requireRoles';
import { requireProductivityScoreAccess } from '../middleware/requireProductivityScoreAccess';
import * as handler from '../handlers/pulseScore.handler';

const router = Router();

// Triple-gate every single endpoint in this router. SUPER_ADMIN-only,
// with a named guard whose distinct 403 code (`PRODUCTIVITY_SCORE_FORBIDDEN`)
// makes attempted access show up clearly in log search.
const scoreGuard = [
  authenticate,
  requireRoles('SUPER_ADMIN'),
  requireProductivityScoreAccess,
] as const;

router.get('/admin/pulse/scores', ...scoreGuard, handler.listScoresHandler);

// Team-wide rollup for the Reports hero (Wave 7). Aggregates the same
// scores `/admin/pulse/scores` returns so the FE doesn't re-compute
// distribution + averages from a 200-row payload.
router.get(
  '/admin/pulse/scores/summary',
  ...scoreGuard,
  handler.getScoresSummaryHandler,
);

// IMPORTANT: this route must come BEFORE `/admin/pulse/scores/:userId`
// in Express, otherwise the colon-param matches the literal string
// "recompute-all" as a userId. The router walks routes in declaration
// order; literal paths must register first.
router.post(
  '/admin/pulse/scores/recompute-all',
  ...scoreGuard,
  handler.recomputeAllScoresHandler,
);

router.get('/admin/pulse/scores/:userId', ...scoreGuard, handler.getScoresForUserHandler);

router.get(
  '/admin/pulse/scores/:userId/breakdown',
  ...scoreGuard,
  handler.getScoreBreakdownHandler,
);

router.get('/admin/pulse/weights', ...scoreGuard, handler.getWeightsHandler);

router.get('/admin/pulse/observability', ...scoreGuard, handler.getObservabilityHandler);

router.post(
  '/admin/pulse/scores/:userId/recompute',
  ...scoreGuard,
  handler.recomputeScoresForUserHandler,
);

export default router;
