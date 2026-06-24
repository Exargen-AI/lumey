/**
 * Pulse — OpenAPI paths (2026-05-28).
 *
 * Documents both the agent-side ingestion surface (heartbeat / snapshot /
 * enroll) and the SUPER_ADMIN-only admin surface (overview / devices /
 * alerts). Registered in the central registry; mounted via the side-
 * effect import in `routes/openapi.routes.ts`.
 *
 * The agent endpoints document `DeviceAuth` as their security scheme so
 * future external integrations know not to send a Bearer JWT here.
 */

import { z } from 'zod';
import { registry, ErrorResponse, successEnvelope } from './registry';

// ─── Auth scheme registration (Device API key) ───────────────────────

registry.registerComponent('securitySchemes', 'DeviceAuth', {
  type: 'apiKey',
  in: 'header',
  name: 'Authorization',
  description:
    'Per-device API key issued at enrollment, presented as `Authorization: Device <api-key>`. Distinct from the human/agent BearerAuth — the Windows agent does not have a user JWT.',
});

// ─── Reusable enums ──────────────────────────────────────────────────

const DevicePlatformSchema = z.enum(['WINDOWS', 'MACOS', 'LINUX']).openapi('DevicePlatform');
const DevicePowerStateSchema = z.enum(['ON', 'IDLE', 'LOCKED', 'OFF']).openapi('DevicePowerState');
const DeviceRiskLevelSchema = z
  .enum(['HEALTHY', 'AT_RISK', 'CRITICAL'])
  .openapi('DeviceRiskLevel');
const DeviceEnrollmentStatusSchema = z
  .enum(['PENDING_ENROLLMENT', 'ACTIVE', 'REVOKED', 'INACTIVE'])
  .openapi('DeviceEnrollmentStatus');
const DeviceAlertTypeSchema = z
  .enum([
    'AGENT_OFFLINE',
    'MISSING_CRITICAL_PATCHES',
    'REBOOT_REQUIRED_OVERDUE',
    'ANTIVIRUS_DISABLED',
    'FIREWALL_DISABLED',
    'BITLOCKER_DISABLED',
    'UNSUPPORTED_OS',
    'RISKY_SOFTWARE_INSTALLED',
    'HIGH_RISK_SCORE',
  ])
  .openapi('DeviceAlertType');
const DeviceAlertSeveritySchema = z
  .enum(['INFO', 'WARNING', 'CRITICAL'])
  .openapi('DeviceAlertSeverity');

// ─── Schemas: agent-side request bodies ──────────────────────────────

const EnrollDeviceRequestSchema = z
  .object({
    enrollmentToken: z.string().min(8).max(200),
    fingerprint: z.string().min(8).max(256),
    hostname: z.string().min(1).max(255),
    platform: DevicePlatformSchema,
    osVersion: z.string().max(255).optional(),
    osBuild: z.string().max(64).optional(),
    arch: z.string().max(16).optional(),
    agentVersion: z.string().min(1).max(32),
  })
  .openapi('EnrollDeviceRequest');

const EnrollDeviceResponseSchema = z
  .object({
    deviceId: z.string().uuid(),
    apiKey: z.string().openapi({
      description:
        'Cleartext API key for `Authorization: Device <apiKey>` on all future calls. Returned ONCE — the server only stores the hash.',
    }),
    ownerUserId: z.string().uuid().nullable(),
    serverTime: z.string().datetime(),
  })
  .openapi('EnrollDeviceResponse');

const HeartbeatRequestSchema = z
  .object({
    powerState: DevicePowerStateSchema,
    uptimeSeconds: z.number().int().min(0),
    agentVersion: z.string().min(1).max(32),
  })
  .openapi('HeartbeatRequest');

const SnapshotInstalledSoftwareSchema = z
  .object({
    name: z.string(),
    version: z.string().optional(),
    publisher: z.string().optional(),
    installDate: z.string().datetime().optional(),
  })
  .openapi('SnapshotInstalledSoftware');

const SnapshotMissingPatchSchema = z
  .object({
    patchId: z.string(),
    title: z.string().optional(),
    classification: z.string().optional(),
    severity: z.string().optional(),
    releasedAt: z.string().datetime().optional(),
  })
  .openapi('SnapshotMissingPatch');

const SnapshotRequestSchema = z
  .object({
    powerState: DevicePowerStateSchema,
    uptimeSeconds: z.number().int().min(0),
    lastBootAt: z.string().datetime().optional(),
    loggedInUserName: z.string().optional(),
    defenderEnabled: z.boolean().optional(),
    firewallEnabled: z.boolean().optional(),
    bitlockerEnabled: z.boolean().optional(),
    rebootRequired: z.boolean().optional(),
    pendingRebootSince: z.string().datetime().optional(),
    unsupportedOs: z.boolean().optional(),
    installedSoftware: z.array(SnapshotInstalledSoftwareSchema).max(5_000),
    missingPatches: z.array(SnapshotMissingPatchSchema).max(1_000),
    agentVersion: z.string().min(1).max(32),
  })
  .openapi('SnapshotRequest');

// ─── Schemas: admin-side responses ───────────────────────────────────

const PulseOverviewSchema = z
  .object({
    totalDevices: z.number().int(),
    byRiskLevel: z.object({
      healthy: z.number().int(),
      atRisk: z.number().int(),
      critical: z.number().int(),
    }),
    byStatus: z.object({
      active: z.number().int(),
      pendingEnrollment: z.number().int(),
      revoked: z.number().int(),
      inactive: z.number().int(),
    }),
    agentsOffline: z.number().int(),
    missingPatchesTotal: z.number().int(),
    rebootRequiredCount: z.number().int(),
    antivirusDisabledCount: z.number().int(),
    firewallDisabledCount: z.number().int(),
    bitlockerDisabledCount: z.number().int(),
    unsupportedOsCount: z.number().int(),
    riskySoftwareDeviceCount: z.number().int(),
    openAlertsBySeverity: z.object({
      info: z.number().int(),
      warning: z.number().int(),
      critical: z.number().int(),
    }),
    lastUpdatedAt: z.string().datetime(),
  })
  .openapi('PulseOverview');

const PulseDeviceSummarySchema = z
  .object({
    id: z.string().uuid(),
    hostname: z.string(),
    platform: DevicePlatformSchema,
    osVersion: z.string().nullable(),
    status: DeviceEnrollmentStatusSchema,
    owner: z
      .object({ id: z.string().uuid(), name: z.string(), email: z.string().email() })
      .nullable(),
    agentVersion: z.string().nullable(),
    lastSeenAt: z.string().datetime().nullable(),
    currentRiskScore: z.number().int().nullable(),
    currentRiskLevel: DeviceRiskLevelSchema.nullable(),
    currentPowerState: DevicePowerStateSchema.nullable(),
    openAlertCount: z.number().int(),
    missingPatchCount: z.number().int(),
    riskySoftwareCount: z.number().int(),
  })
  .openapi('PulseDeviceSummary');

const PulseRiskAlertSchema = z
  .object({
    id: z.string().uuid(),
    deviceId: z.string().uuid(),
    type: DeviceAlertTypeSchema,
    severity: DeviceAlertSeveritySchema,
    message: z.string(),
    openedAt: z.string().datetime(),
    resolvedAt: z.string().datetime().nullable(),
    resolutionNote: z.string().nullable(),
    resolvedBy: z
      .object({ id: z.string().uuid(), name: z.string() })
      .nullable(),
  })
  .openapi('PulseRiskAlert');

// ─── Path registrations: agent surface ───────────────────────────────

registry.registerPath({
  method: 'post',
  path: '/devices/enroll',
  description:
    'First-boot enrollment. The Windows agent presents a SUPER_ADMIN-issued enrollment token and its stable hardware fingerprint. The server creates (or re-activates) a Device row, generates a fresh API key, and returns the cleartext key exactly once. Subsequent requests use `Authorization: Device <apiKey>`.',
  summary: 'Enroll a new device',
  tags: ['Pulse: Agent'],
  security: [],
  request: {
    body: {
      content: { 'application/json': { schema: EnrollDeviceRequestSchema } },
    },
  },
  responses: {
    201: {
      description: 'Device enrolled. The `apiKey` field is shown only here.',
      content: { 'application/json': { schema: successEnvelope(EnrollDeviceResponseSchema) } },
    },
    400: { description: 'Validation failed', content: { 'application/json': { schema: ErrorResponse } } },
    403: { description: 'Token expired or already consumed', content: { 'application/json': { schema: ErrorResponse } } },
    404: { description: 'Token not found', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/devices/me/heartbeat',
  description:
    'Lightweight ping (~every 5 min). Updates `Device.lastSeenAt` and `currentPowerState`. No history row is written.',
  summary: 'Send a heartbeat',
  tags: ['Pulse: Agent'],
  security: [{ DeviceAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: HeartbeatRequestSchema } } },
  },
  responses: {
    200: {
      description: 'Heartbeat accepted',
      content: {
        'application/json': {
          schema: successEnvelope(
            z.object({
              ok: z.literal(true),
              nextHeartbeatInSeconds: z.number().int(),
              // 2026-05-30 — back-channel for the agent's clock-skew
              // check. Optional in the schema so older agents that
              // never read it stay valid.
              serverTime: z.string().datetime().optional(),
              revoked: z.boolean().optional(),
            }),
          ),
        },
      },
    },
    401: { description: 'Invalid or inactive device', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/devices/me/snapshot',
  description:
    'Full snapshot (~every 60 min). Writes a `DeviceHealthSnapshot` row, refreshes installed-software + missing-patch inventories (upsert + prune), runs the risk scorer, and reconciles open `DeviceRiskAlert`s. Returns the new risk score + open alert count.',
  summary: 'Send a full health snapshot',
  tags: ['Pulse: Agent'],
  security: [{ DeviceAuth: [] }],
  request: {
    body: { content: { 'application/json': { schema: SnapshotRequestSchema } } },
  },
  responses: {
    201: {
      description: 'Snapshot ingested',
      content: {
        'application/json': {
          schema: successEnvelope(
            z.object({
              ok: z.literal(true),
              riskScore: z.number().int(),
              riskLevel: DeviceRiskLevelSchema,
              openAlertCount: z.number().int(),
            }),
          ),
        },
      },
    },
    400: { description: 'Validation failed', content: { 'application/json': { schema: ErrorResponse } } },
    401: { description: 'Invalid or inactive device', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

// ─── Path registrations: admin surface ───────────────────────────────

registry.registerPath({
  method: 'get',
  path: '/admin/pulse/overview',
  description:
    'Aggregate counts for the Pulse dashboard: total devices, risk-level distribution, agents offline, missing-patch total, reboot/AV/firewall/BitLocker disabled counts, open alerts by severity.',
  summary: 'Pulse overview cards',
  tags: ['Pulse: Admin'],
  security: [{ BearerAuth: [] }],
  responses: {
    200: {
      description: 'Overview snapshot',
      content: { 'application/json': { schema: successEnvelope(PulseOverviewSchema) } },
    },
    403: { description: 'Caller is not SUPER_ADMIN', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/admin/pulse/devices',
  description: 'List devices with their current rollup, filterable by risk level, status, and search term.',
  summary: 'List devices',
  tags: ['Pulse: Admin'],
  security: [{ BearerAuth: [] }],
  responses: {
    200: {
      description: 'Device list',
      content: {
        'application/json': { schema: successEnvelope(z.array(PulseDeviceSummarySchema)) },
      },
    },
    403: { description: 'Caller is not SUPER_ADMIN', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/admin/pulse/devices/{id}',
  description:
    'Full device detail page: identity, latest health snapshot, installed software, missing patches, open risk alerts.',
  summary: 'Device detail',
  tags: ['Pulse: Admin'],
  security: [{ BearerAuth: [] }],
  responses: {
    200: {
      description: 'Device detail',
      content: { 'application/json': { schema: successEnvelope(z.any()) } },
    },
    403: { description: 'Caller is not SUPER_ADMIN', content: { 'application/json': { schema: ErrorResponse } } },
    404: { description: 'Device not found', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/admin/pulse/enrollment-tokens',
  description:
    'Issue a single-use enrollment token. The returned `token` is shown ONCE — hand it to the employee for the installer. Optional `assignedUserId` pre-binds the device to that user on enrollment.',
  summary: 'Issue an enrollment token',
  tags: ['Pulse: Admin'],
  security: [{ BearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            assignedUserId: z.string().uuid().optional(),
            note: z.string().max(255).optional(),
            expiresInHours: z.number().int().min(1).max(720).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Token issued',
      content: { 'application/json': { schema: successEnvelope(z.any()) } },
    },
    403: { description: 'Caller is not SUPER_ADMIN', content: { 'application/json': { schema: ErrorResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/admin/pulse/alerts',
  description: 'List risk alerts, defaulting to open-only. Sorted by severity, then opened-at desc.',
  summary: 'List risk alerts',
  tags: ['Pulse: Admin'],
  security: [{ BearerAuth: [] }],
  responses: {
    200: {
      description: 'Alert list',
      content: { 'application/json': { schema: successEnvelope(z.array(PulseRiskAlertSchema)) } },
    },
    403: { description: 'Caller is not SUPER_ADMIN', content: { 'application/json': { schema: ErrorResponse } } },
  },
});
