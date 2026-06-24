/**
 * Pulse — Zod validators (2026-05-28).
 *
 * Shared between agent-side ingestion endpoints (heartbeat, snapshot,
 * enroll) and admin-side read/mutate endpoints. Constraints favour
 * cheap rejection at the request edge over per-handler defensive
 * checks: bounded arrays, capped string lengths, enum coercion.
 */

import { z } from 'zod';

const DevicePlatformEnum = z.enum(['WINDOWS', 'MACOS', 'LINUX']);
const DevicePowerStateEnum = z.enum(['ON', 'IDLE', 'LOCKED', 'OFF']);
const DeviceRiskLevelEnum = z.enum(['HEALTHY', 'AT_RISK', 'CRITICAL']);
const DeviceEnrollmentStatusEnum = z.enum([
  'PENDING_ENROLLMENT',
  'ACTIVE',
  'REVOKED',
  'INACTIVE',
]);
const DeviceAlertSeverityEnum = z.enum(['INFO', 'WARNING', 'CRITICAL']);

// ─── Agent-side bodies ─────────────────────────────────────────────────

export const enrollDeviceSchema = z.object({
  body: z.object({
    enrollmentToken: z.string().min(8).max(200),
    fingerprint: z.string().min(8).max(256),
    hostname: z.string().min(1).max(255),
    platform: DevicePlatformEnum,
    osVersion: z.string().max(255).optional(),
    osBuild: z.string().max(64).optional(),
    arch: z.string().max(16).optional(),
    agentVersion: z.string().min(1).max(32),
  }),
});

// We use a permissive `Date.parse()`-based check rather than zod's
// strict `.datetime()` because Windows surfaces dates in three
// different ways (registry yyyymmdd, PowerShell `'o'` DateTime with no
// TZ suffix, PowerShell `'o'` DateTimeOffset with `+00:00`), and zod's
// strict ISO 8601 check rejects two of those three. `Date.parse` is
// lenient enough to handle all of them — and the data is already
// trusted at this point (the device is authenticated via per-device
// API key validated by deviceAuthenticate). Garbage strings still get
// rejected because `Date.parse` returns NaN for unparseable input.
// `.nullish()` so optional fields can be sent as `null` OR omitted.
const isoDateOptional = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), {
    message: 'must be a parseable date string',
  })
  .nullish();

export const heartbeatSchema = z.object({
  body: z.object({
    powerState: DevicePowerStateEnum,
    uptimeSeconds: z.number().int().min(0).max(60 * 60 * 24 * 365 * 5),
    agentVersion: z.string().min(1).max(32),
    // Wave 9 — agent self-health telemetry. All optional so older
    // agents that don't ship these fields still validate.
    cpuPercent: z.number().min(0).max(100).optional(),
    memoryMb: z.number().min(0).max(8192).optional(),
    errorCount: z.number().int().min(0).max(1_000_000).optional(),
    lastErrorAt: isoDateOptional,
    lastErrorMessage: z.string().max(512).nullish(),
  }),
});

export const snapshotSchema = z.object({
  body: z.object({
    powerState: DevicePowerStateEnum,
    uptimeSeconds: z.number().int().min(0).max(60 * 60 * 24 * 365 * 5),
    lastBootAt: isoDateOptional,
    // Nullish on string/bool optional fields too — PowerShell often
    // returns null for "field not present", and we don't want the agent
    // to filter every null before serialising.
    loggedInUserName: z.string().max(255).nullish(),
    defenderEnabled: z.boolean().nullish(),
    firewallEnabled: z.boolean().nullish(),
    bitlockerEnabled: z.boolean().nullish(),
    rebootRequired: z.boolean().nullish(),
    pendingRebootSince: isoDateOptional,
    unsupportedOs: z.boolean().nullish(),
    installedSoftware: z
      .array(
        z.object({
          name: z.string().min(1).max(255),
          version: z.string().max(64).nullish(),
          publisher: z.string().max(255).nullish(),
          installDate: isoDateOptional,
        }),
      )
      // Bounded; the service-layer ingestion also enforces this so the
      // limit is consistent across direct + middleware-bypass paths.
      .max(5_000),
    missingPatches: z
      .array(
        z.object({
          patchId: z.string().min(1).max(64),
          title: z.string().max(512).nullish(),
          classification: z.string().max(64).nullish(),
          severity: z.string().max(32).nullish(),
          releasedAt: isoDateOptional,
        }),
      )
      .max(1_000),
    // 2026-05-28b productivity rollup. Capped at one hour of seconds
    // per bucket — any real agent reporting more should have its
    // accumulator audited (cap = snapshot interval = 1h = 3600s, with
    // a generous 2x cushion to absorb a missed-snapshot interval).
    activeSecondsBucket: z.number().int().min(0).max(7_200).optional(),
    idleSecondsBucket: z.number().int().min(0).max(7_200).optional(),
    lockedSecondsBucket: z.number().int().min(0).max(7_200).optional(),
    // 2026-05-29 — Per-employee activity tracking.
    currentSessionStart: isoDateOptional,
    runningProcessCount: z.number().int().min(0).max(10_000).optional(),
    appBucketStart: isoDateOptional,
    appBucketEnd: isoDateOptional,
    appBuckets: z
      .array(
        z.object({
          appName: z.string().min(1).max(255),
          appDisplayName: z.string().max(255).nullish(),
          lastWindowTitle: z.string().max(512).nullish(),
          foregroundSeconds: z.number().int().min(0).max(7_200),
          category: z.enum([
            'PRODUCTIVE',
            'COMMUNICATION',
            'ENTERTAINMENT',
            'PERSONAL',
            'UNKNOWN',
            'TAMPER',
          ]),
          categoryReason: z.string().max(255).nullish(),
        }),
      )
      // 500 apps in one hour is generous (typical desktop has 5-20
      // foreground swaps per hour).
      .max(500)
      .optional(),
    // ─── Wave 9 — agent resilience signals ─────────────────────────
    // Tamper processes detected via background enumeration (separate
    // from foreground TAMPER detection in appBuckets). Capped at 50;
    // any real machine with more than that has a deeper problem.
    runningTamperProcesses: z
      .array(
        z.object({
          name: z.string().min(1).max(255),
          pid: z.number().int().min(0).max(1_000_000).optional(),
        }),
      )
      .max(50)
      .optional(),
    // Battery (laptops only). All optional — desktops without
    // batteries return all-undefined.
    batteryPercent: z.number().int().min(0).max(100).optional(),
    batteryCharging: z.boolean().optional(),
    batteryHealthPercent: z.number().int().min(0).max(100).optional(),
    // Disk: free percent on the OS volume. Useful for "this laptop is
    // about to die" alerts.
    diskFreePercent: z.number().int().min(0).max(100).optional(),
    diskFreeGb: z.number().min(0).max(100_000).optional(),
    // Network: which kind of connection is the agent on right now?
    // Helps SUPER_ADMIN understand "why is this person's heartbeat lag
    // 4 hours" — answer: they're on a public-wifi flight.
    networkType: z
      .enum(['ETHERNET', 'WIFI', 'CELLULAR', 'VPN', 'UNKNOWN'])
      .optional(),
    networkConnectivity: z
      .enum(['INTERNET', 'LOCAL_ONLY', 'NO_TRAFFIC', 'UNKNOWN'])
      .optional(),
    agentVersion: z.string().min(1).max(32),
  }),
});

// ─── Admin-side bodies (SUPER_ADMIN-only routes) ──────────────────────

export const createEnrollmentTokenSchema = z.object({
  body: z.object({
    assignedUserId: z.string().uuid().optional(),
    note: z.string().max(255).optional(),
    expiresInHours: z.number().int().min(1).max(30 * 24).optional(),
  }),
});

export const enrollmentTokenIdParamSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
});

export const deviceIdParamSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
});

export const revokeDeviceSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    reason: z.string().max(255).optional(),
  }),
});

export const reassignDeviceSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    ownerUserId: z.string().uuid().nullable(),
  }),
});

export const listDevicesQuerySchema = z.object({
  query: z.object({
    riskLevel: DeviceRiskLevelEnum.optional(),
    status: DeviceEnrollmentStatusEnum.optional(),
    search: z.string().max(128).optional(),
  }),
});

export const listAlertsQuerySchema = z.object({
  query: z.object({
    severity: DeviceAlertSeverityEnum.optional(),
    includeResolved: z
      .union([z.literal('true'), z.literal('false')])
      .optional()
      .transform((v) => v === 'true'),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  }),
});

export const resolveAlertSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    resolutionNote: z.string().max(500).optional(),
  }),
});

// ─── Clock In / Clock Out ─────────────────────────────────────────────

export const clockInSchema = z.object({
  body: z.object({
    note: z.string().max(255).optional(),
  }),
});

export const clockOutSchema = z.object({
  body: z.object({
    note: z.string().max(255).optional(),
  }),
});

export const teamClockQuerySchema = z.object({
  query: z.object({
    date: z.string().date().optional(),
  }),
});

export const deviceProductivityQuerySchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  query: z.object({
    days: z.coerce.number().int().min(1).max(30).optional(),
  }),
});
