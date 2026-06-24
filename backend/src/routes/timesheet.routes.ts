import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { validate } from '../middleware/validate';
import {
  logTimeSchema,
  bulkLogTimeSchema,
  submitTimesheetSchema,
  reopenTimesheetSchema,
  rejectTimesheetSchema,
  weeklyTimesheetQuerySchema,
  listApprovalsQuerySchema,
} from '../validators/timesheet.schema';
import * as handler from '../handlers/timesheet.handler';

const router = Router();

// Personal timesheet — every body/query is now schema-checked (QA findings #20-#22).
router.post('/timesheet/log', authenticate, validate(logTimeSchema), handler.logTimeHandler);
router.post('/timesheet/bulk', authenticate, validate(bulkLogTimeSchema), handler.bulkLogTimeHandler);
router.get('/timesheet/weekly', authenticate, validate(weeklyTimesheetQuerySchema), handler.weeklyTimesheetHandler);
router.get('/timesheet/status', authenticate, validate(weeklyTimesheetQuerySchema), handler.timesheetStatusHandler);
router.post('/timesheet/submit', authenticate, validate(submitTimesheetSchema), handler.submitTimesheetHandler);
router.post('/timesheet/reopen', authenticate, validate(reopenTimesheetSchema), handler.reopenTimesheetHandler);
router.delete('/timesheet/:id', authenticate, handler.deleteTimeEntryHandler);

// Approval endpoints (admin/PM).
//
// `/timesheet/pending` is intentionally NOT renamed to `/timesheet/approvals`
// even though it now serves the history tabs too — keeping the path stable
// avoids breaking any in-flight clients. The optional `?status=` query
// driver is what makes this an approval queue + history view at once.
router.get(
  '/timesheet/pending',
  authenticate,
  authorize('analytics.view_team'),
  validate(listApprovalsQuerySchema),
  handler.pendingApprovalsHandler,
);
router.get(
  '/timesheet/approvals/counts',
  authenticate,
  authorize('analytics.view_team'),
  handler.approvalCountsHandler,
);
router.patch('/timesheet/:id/approve', authenticate, authorize('analytics.view_team'), handler.approveTimesheetHandler);
router.patch('/timesheet/:id/reject', authenticate, authorize('analytics.view_team'), validate(rejectTimesheetSchema), handler.rejectTimesheetHandler);

export default router;
