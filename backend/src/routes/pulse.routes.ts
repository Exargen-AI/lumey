/**
 * Pulse routes (2026-05-28).
 *
 * Two stacked surfaces, deliberately kept in the SAME router so the
 * Pulse module is self-contained when read end-to-end:
 *
 *   Agent surface (Authorization: Device <api-key>):
 *     POST   /api/v1/devices/enroll
 *     POST   /api/v1/devices/me/heartbeat
 *     POST   /api/v1/devices/me/snapshot
 *
 *   Admin surface (Authorization: Bearer <jwt> + SUPER_ADMIN):
 *     GET    /api/v1/admin/pulse/overview
 *     GET    /api/v1/admin/pulse/devices
 *     GET    /api/v1/admin/pulse/devices/:id
 *     POST   /api/v1/admin/pulse/devices/:id/revoke
 *     POST   /api/v1/admin/pulse/devices/:id/reassign
 *     POST   /api/v1/admin/pulse/enrollment-tokens
 *     GET    /api/v1/admin/pulse/enrollment-tokens
 *     POST   /api/v1/admin/pulse/enrollment-tokens/:id/revoke
 *     GET    /api/v1/admin/pulse/alerts
 *     POST   /api/v1/admin/pulse/alerts/:id/resolve
 *
 * No cross-surface routes: an admin cannot POST a snapshot, an agent
 * cannot GET the dashboard.
 */

import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { requireRoles } from '../middleware/requireRoles';
import {
  deviceAuthenticate,
  deviceAuthenticateAllowRevoked,
} from '../middleware/deviceAuthenticate';
import { validate } from '../middleware/validate';
import { deviceTelemetryLimiter } from '../middleware/rateLimiter';
import * as handler from '../handlers/pulse.handler';
import * as clockHandler from '../handlers/clock.handler';
import {
  enrollDeviceSchema,
  heartbeatSchema,
  snapshotSchema,
  createEnrollmentTokenSchema,
  enrollmentTokenIdParamSchema,
  deviceIdParamSchema,
  revokeDeviceSchema,
  reassignDeviceSchema,
  listDevicesQuerySchema,
  listAlertsQuerySchema,
  resolveAlertSchema,
  clockInSchema,
  clockOutSchema,
  teamClockQuerySchema,
  deviceProductivityQuerySchema,
} from '../validators/pulse.schema';

const router = Router();

// ─── Agent surface ────────────────────────────────────────────────────

// Enrollment: the only Pulse endpoint NOT behind deviceAuthenticate —
// the agent has no API key yet. Bootstrap secret is the enrollment
// token in the request body.
router.post('/devices/enroll', validate(enrollDeviceSchema), handler.enrollDeviceHandler);

// Wave 9 — heartbeat uses `deviceAuthenticateAllowRevoked` so the
// remote kill-switch works: a revoked device's heartbeat reaches the
// handler, which responds `{revoked: true}` and the agent exits
// cleanly instead of looping forever on 401s.
router.post(
  '/devices/me/heartbeat',
  deviceAuthenticateAllowRevoked,
  // Per-device limiter runs AFTER auth so it keys on req.device.id.
  deviceTelemetryLimiter,
  validate(heartbeatSchema),
  handler.heartbeatHandler,
);

router.post(
  '/devices/me/snapshot',
  deviceAuthenticate,
  deviceTelemetryLimiter,
  validate(snapshotSchema),
  handler.snapshotHandler,
);

// ─── Admin surface ────────────────────────────────────────────────────

const adminGuard = [authenticate, requireRoles('SUPER_ADMIN')] as const;

router.get('/admin/pulse/overview', ...adminGuard, handler.overviewHandler);

router.get(
  '/admin/pulse/devices',
  ...adminGuard,
  validate(listDevicesQuerySchema),
  handler.listDevicesHandler,
);

router.get(
  '/admin/pulse/devices/:id',
  ...adminGuard,
  validate(deviceIdParamSchema),
  handler.getDeviceHandler,
);

router.get(
  '/admin/pulse/devices/:id/productivity',
  ...adminGuard,
  validate(deviceProductivityQuerySchema),
  handler.getDeviceProductivityHandler,
);

// 2026-05-29 — Per-employee activity views.
router.get('/admin/pulse/employees', ...adminGuard, handler.listEmployeesHandler);
router.get(
  '/admin/pulse/employees/:id',
  ...adminGuard,
  validate(deviceIdParamSchema),
  handler.getEmployeeHandler,
);

router.post(
  '/admin/pulse/devices/:id/revoke',
  ...adminGuard,
  validate(revokeDeviceSchema),
  handler.revokeDeviceHandler,
);

router.post(
  '/admin/pulse/devices/:id/reassign',
  ...adminGuard,
  validate(reassignDeviceSchema),
  handler.reassignDeviceHandler,
);

router.post(
  '/admin/pulse/enrollment-tokens',
  ...adminGuard,
  validate(createEnrollmentTokenSchema),
  handler.createEnrollmentTokenHandler,
);

router.get('/admin/pulse/enrollment-tokens', ...adminGuard, handler.listEnrollmentTokensHandler);

router.post(
  '/admin/pulse/enrollment-tokens/:id/revoke',
  ...adminGuard,
  validate(enrollmentTokenIdParamSchema),
  handler.revokeEnrollmentTokenHandler,
);

router.get(
  '/admin/pulse/alerts',
  ...adminGuard,
  validate(listAlertsQuerySchema),
  handler.listAlertsHandler,
);

router.post(
  '/admin/pulse/alerts/:id/resolve',
  ...adminGuard,
  validate(resolveAlertSchema),
  handler.resolveAlertHandler,
);

// ─── Clock In / Clock Out + employee self-pulse view ─────────────────
//
// Wave 13 SECURITY FIX — these routes used to be `authenticate` only.
// That let CLIENT users hit them and even successfully POST /clock/in,
// creating real clock sessions tied to their CLIENT account. Two
// problems:
//   1. CLIENTs are not employees and shouldn't appear on the team
//      clock view at all. Pre-fix, a CLIENT clocking in showed as a
//      working employee in the SUPER_ADMIN clock rollup.
//   2. GET /pulse/me/today returned zero-but-non-empty productivity
//      telemetry data (activeSeconds, productiveSeconds, currentApp,
//      etc.) to CLIENT — leaking the SHAPE of the pulse system to
//      non-employees, which violates the R5 lockdown
//      ("only super admin has access to all these metrics").
//
// Fix: gate every employee-self route to the same role set that can
// reach TodayPage in App.tsx — SUPER_ADMIN, ADMIN, PRODUCT_MANAGER,
// ENGINEER. Explicitly excludes CLIENT.
const employeeRoles = ['SUPER_ADMIN', 'ADMIN', 'PRODUCT_MANAGER', 'ENGINEER'] as const;

router.post(
  '/clock/in',
  authenticate,
  requireRoles(...employeeRoles),
  validate(clockInSchema),
  clockHandler.clockInHandler,
);

router.post(
  '/clock/out',
  authenticate,
  requireRoles(...employeeRoles),
  validate(clockOutSchema),
  clockHandler.clockOutHandler,
);

router.get(
  '/clock/me/today',
  authenticate,
  requireRoles(...employeeRoles),
  clockHandler.getMyClockStatusHandler,
);

// 2026-05-29 — Self-service productivity snapshot for the calling user.
// Powers the TodayPage greeting + vibe card.
//
// Wave 13: gated to employee roles only. CLIENTs would otherwise see
// the response schema (activeSeconds, productiveSeconds, currentApp,
// etc.) even though their numbers are all zero — leaks the existence
// of the pulse module to non-employees per R5 lockdown.
router.get(
  '/pulse/me/today',
  authenticate,
  requireRoles(...employeeRoles),
  handler.getMyTodaySummaryHandler,
);

// SUPER_ADMIN-only team rollup.
router.get(
  '/admin/pulse/clock/team',
  ...adminGuard,
  validate(teamClockQuerySchema),
  clockHandler.getTeamClockStatusHandler,
);

export default router;
