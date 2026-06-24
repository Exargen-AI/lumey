import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requireRoles } from '../middleware/requireRoles';
import { validate } from '../middleware/validate';
import {
  applyLeaveSchema,
  decideLeaveSchema,
  leaveIdParamSchema,
  listAllLeavesSchema,
} from '../validators/leave.schema';
import * as leaveHandler from '../handlers/leave.handler';

const router = Router();

/**
 * Approval policy: SUPER_ADMIN-only for the queue + decision routes.
 * The service layer enforces this too (defense in depth).
 *
 * Apply / list-mine / cancel-mine are open to any authenticated user —
 * everyone is entitled to apply for leave and see their own history.
 */

// Wave 13 SECURITY FIX — apply / list-mine are EMPLOYEE-only. The
// pre-fix `authenticate` gate let CLIENTs successfully POST a leave
// application, polluting the SUPER_ADMIN approval queue (and the
// daily-totals math). CLIENT users are not employees and have no
// reason to apply for company leave.
const employeeRoles = ['SUPER_ADMIN', 'ADMIN', 'PRODUCT_MANAGER', 'ENGINEER'] as const;

router.post(
  '/leaves',
  authenticate,
  requireRoles(...employeeRoles),
  validate(applyLeaveSchema),
  leaveHandler.applyLeaveHandler,
);
router.get(
  '/leaves/my',
  authenticate,
  requireRoles(...employeeRoles),
  leaveHandler.getMyLeavesHandler,
);

// Approver queue + decisions — SUPER_ADMIN only.
router.get(
  '/leaves',
  authenticate,
  requireRoles('SUPER_ADMIN'),
  validate(listAllLeavesSchema),
  leaveHandler.listAllLeavesHandler,
);
router.get(
  '/leaves/pending/count',
  authenticate,
  requireRoles('SUPER_ADMIN'),
  leaveHandler.pendingLeaveCountHandler,
);
router.post(
  '/leaves/:id/approve',
  authenticate,
  requireRoles('SUPER_ADMIN'),
  validate(decideLeaveSchema),
  leaveHandler.approveLeaveHandler,
);
router.post(
  '/leaves/:id/reject',
  authenticate,
  requireRoles('SUPER_ADMIN'),
  validate(decideLeaveSchema),
  leaveHandler.rejectLeaveHandler,
);
// Revoke an APPROVED leave — distinct from applicant cancel. SUPER_ADMIN
// only; reuses the decideLeaveSchema (note required at service level).
// QA L-H2.
router.post(
  '/leaves/:id/revoke',
  authenticate,
  requireRoles('SUPER_ADMIN'),
  validate(decideLeaveSchema),
  leaveHandler.revokeApprovedLeaveHandler,
);
// Counts per status for the approvals page tabs (QA L-H1).
router.get(
  '/leaves/counts',
  authenticate,
  requireRoles('SUPER_ADMIN'),
  leaveHandler.leaveCountsHandler,
);

// Single record — applicant or SUPER_ADMIN. Service layer disambiguates.
// Wave 13 — also gated by employee roles so a CLIENT can't probe leave
// IDs (the service layer would 403 them anyway but the gate makes it
// explicit at the route level).
router.get(
  '/leaves/:id',
  authenticate,
  requireRoles(...employeeRoles),
  validate(leaveIdParamSchema),
  leaveHandler.getLeaveHandler,
);

// Cancel — applicant only. Service layer enforces; route gate keeps
// CLIENTs out for consistency.
router.post(
  '/leaves/:id/cancel',
  authenticate,
  requireRoles(...employeeRoles),
  validate(leaveIdParamSchema),
  leaveHandler.cancelLeaveHandler,
);

export default router;
