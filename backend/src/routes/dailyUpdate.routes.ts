import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { requireRoles } from '../middleware/requireRoles';
import { validate } from '../middleware/validate';
import { submitDailyUpdateSchema, teamDailyUpdatesQuerySchema } from '../validators/dailyUpdate.schema';
import * as handler from '../handlers/dailyUpdate.handler';

const router = Router();

// Wave 13 SECURITY FIX — daily updates (standups) are an EMPLOYEE
// surface. Pre-fix, every `mine` route was `authenticate` only, which
// let CLIENT users:
//   - Successfully POST a standup (creating a real daily_updates row
//     for the CLIENT user, polluting the team standup table AND
//     emitting a STANDUP productivity event tied to the CLIENT — the
//     scoring worker would then compute a STANDUP sub-score for a
//     CLIENT user, which violates the R5 lockdown's intent).
//   - Hit the streak / stats / today endpoints and see the schema
//     of the standup system.
//
// Gate all five to the employee role set (matches App.tsx's TodayPage
// gate). CLIENT and any future external roles get 403.
const employeeRoles = ['SUPER_ADMIN', 'ADMIN', 'PRODUCT_MANAGER', 'ENGINEER'] as const;

router.post(
  '/daily-updates',
  authenticate,
  requireRoles(...employeeRoles),
  validate(submitDailyUpdateSchema),
  handler.submitHandler,
);
router.get('/daily-updates/mine', authenticate, requireRoles(...employeeRoles), handler.myUpdatesHandler);
router.get('/daily-updates/mine/streak', authenticate, requireRoles(...employeeRoles), handler.streakHandler);
router.get('/daily-updates/mine/stats', authenticate, requireRoles(...employeeRoles), handler.statsHandler);
router.get('/daily-updates/mine/today', authenticate, requireRoles(...employeeRoles), handler.todayStatusHandler);

// Team daily updates (admin/PM only) — already gated by the
// `analytics.view_team` permission, which CLIENTs don't have.
router.get('/daily-updates/team', authenticate, authorize('analytics.view_team'), validate(teamDailyUpdatesQuerySchema), handler.teamHandler);

export default router;
