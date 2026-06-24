/**
 * Pulse — Admin read aggregations (2026-05-28).
 *
 * SUPER_ADMIN-only read surface. Every function here is called from a
 * route already gated by requireRoles('SUPER_ADMIN'); we double-gate at
 * the service layer (defence in depth, matches the pattern in
 * agentKnowledgePack.service.ts) so the function refuses if a future
 * route forgets the middleware.
 */

import {
  DeviceAlertSeverity,
  DeviceEnrollmentStatus,
  DeviceRiskLevel,
} from '@prisma/client';
import prisma from '../config/database';
import { ForbiddenError, NotFoundError } from '../utils/errors';
import { UserRole } from '@exargen/shared';

const OFFLINE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * UTC midnight for today. The productivity buckets are reported by the
 * agent in 1-hour cadence; "today" is therefore a clean UTC day window.
 * (Per-employee timezone display happens on the frontend.)
 */
function todayUtcStart(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function assertSuperAdmin(role: string | undefined) {
  if (role !== UserRole.SUPER_ADMIN) {
    throw new ForbiddenError('Pulse is restricted to SUPER_ADMIN');
  }
}

// ─── Overview cards ───────────────────────────────────────────────────

export async function getPulseOverview(callerRole: string | undefined) {
  assertSuperAdmin(callerRole);

  const now = new Date();
  const offlineCutoff = new Date(now.getTime() - OFFLINE_THRESHOLD_MS);

  const [
    totalDevices,
    healthyCount,
    atRiskCount,
    criticalCount,
    activeCount,
    pendingCount,
    revokedCount,
    inactiveCount,
    agentsOffline,
    missingPatchesTotal,
    latestSnapshots,
    openAlertsBySeverity,
    riskySoftwareDeviceCount,
    todayProductivity,
  ] = await Promise.all([
    prisma.device.count(),
    prisma.device.count({ where: { currentRiskLevel: DeviceRiskLevel.HEALTHY } }),
    prisma.device.count({ where: { currentRiskLevel: DeviceRiskLevel.AT_RISK } }),
    prisma.device.count({ where: { currentRiskLevel: DeviceRiskLevel.CRITICAL } }),
    prisma.device.count({ where: { status: DeviceEnrollmentStatus.ACTIVE } }),
    prisma.device.count({
      where: { status: DeviceEnrollmentStatus.PENDING_ENROLLMENT },
    }),
    prisma.device.count({ where: { status: DeviceEnrollmentStatus.REVOKED } }),
    prisma.device.count({ where: { status: DeviceEnrollmentStatus.INACTIVE } }),
    prisma.device.count({
      where: {
        status: DeviceEnrollmentStatus.ACTIVE,
        OR: [
          { lastSeenAt: null },
          { lastSeenAt: { lt: offlineCutoff } },
        ],
      },
    }),
    prisma.deviceMissingPatch.count(),
    // We compute reboot / antivirus / firewall / bitlocker / unsupported-os
    // counts from the latest snapshot per device — denormalising those
    // five booleans onto Device would be a future optimisation if this
    // call ever gets hot.
    // 2026-06-01 hardening — `distinct: ['deviceId']` pushes the
    // latest-per-device reduction into Postgres. Previously this pulled
    // EVERY snapshot ever recorded across ALL devices (hourly × fleet ×
    // forever) into memory just to keep the newest row per device in the
    // JS loop below. With distinct + the (deviceId asc, capturedAt desc)
    // order, the DB returns exactly one row — the latest — per device, so
    // the result is bounded to the device count. The downstream reduce is
    // now a no-op dedupe but kept for clarity/safety.
    prisma.deviceHealthSnapshot.findMany({
      where: {},
      distinct: ['deviceId'],
      select: {
        deviceId: true,
        capturedAt: true,
        rebootRequired: true,
        defenderEnabled: true,
        firewallEnabled: true,
        bitlockerEnabled: true,
        unsupportedOs: true,
      },
      orderBy: [{ deviceId: 'asc' }, { capturedAt: 'desc' }],
    }),
    prisma.deviceRiskAlert.groupBy({
      by: ['severity'],
      where: { resolvedAt: null },
      _count: { _all: true },
    }),
    prisma.deviceInstalledSoftware
      .findMany({
        where: { isRisky: true },
        select: { deviceId: true },
        distinct: ['deviceId'],
      })
      .then((rows) => rows.length),
    // 2026-05-28c — Team-wide productivity for today (UTC day). Sums
    // bucket fields across every snapshot since UTC midnight.
    prisma.deviceHealthSnapshot.groupBy({
      by: ['deviceId'],
      where: { capturedAt: { gte: todayUtcStart() } },
      _sum: {
        activeSecondsBucket: true,
        idleSecondsBucket: true,
        lockedSecondsBucket: true,
      },
    }),
  ]);

  // Reduce snapshots to the latest-per-device set, then count flags.
  const latestByDevice = new Map<string, (typeof latestSnapshots)[number]>();
  for (const s of latestSnapshots) {
    if (!latestByDevice.has(s.deviceId)) latestByDevice.set(s.deviceId, s);
  }
  let rebootRequiredCount = 0;
  let antivirusDisabledCount = 0;
  let firewallDisabledCount = 0;
  let bitlockerDisabledCount = 0;
  let unsupportedOsCount = 0;
  for (const s of latestByDevice.values()) {
    if (s.rebootRequired === true) rebootRequiredCount++;
    if (s.defenderEnabled === false) antivirusDisabledCount++;
    if (s.firewallEnabled === false) firewallDisabledCount++;
    if (s.bitlockerEnabled === false) bitlockerDisabledCount++;
    if (s.unsupportedOs === true) unsupportedOsCount++;
  }

  const alertsBySeverity = { info: 0, warning: 0, critical: 0 };
  for (const row of openAlertsBySeverity) {
    if (row.severity === DeviceAlertSeverity.INFO) alertsBySeverity.info = row._count._all;
    else if (row.severity === DeviceAlertSeverity.WARNING) alertsBySeverity.warning = row._count._all;
    else if (row.severity === DeviceAlertSeverity.CRITICAL) alertsBySeverity.critical = row._count._all;
  }

  let teamActiveSecondsToday = 0;
  let teamIdleSecondsToday = 0;
  let teamLockedSecondsToday = 0;
  for (const row of todayProductivity) {
    teamActiveSecondsToday += row._sum.activeSecondsBucket ?? 0;
    teamIdleSecondsToday += row._sum.idleSecondsBucket ?? 0;
    teamLockedSecondsToday += row._sum.lockedSecondsBucket ?? 0;
  }
  const reportingDevicesToday = todayProductivity.length;

  return {
    totalDevices,
    byRiskLevel: {
      healthy: healthyCount,
      atRisk: atRiskCount,
      critical: criticalCount,
    },
    byStatus: {
      active: activeCount,
      pendingEnrollment: pendingCount,
      revoked: revokedCount,
      inactive: inactiveCount,
    },
    agentsOffline,
    missingPatchesTotal,
    rebootRequiredCount,
    antivirusDisabledCount,
    firewallDisabledCount,
    bitlockerDisabledCount,
    unsupportedOsCount,
    riskySoftwareDeviceCount,
    openAlertsBySeverity: alertsBySeverity,
    teamActiveSecondsToday,
    teamIdleSecondsToday,
    teamLockedSecondsToday,
    reportingDevicesToday,
    lastUpdatedAt: now.toISOString(),
  };
}

// ─── Device list (admin table) ─────────────────────────────────────────

export interface ListDevicesFilter {
  riskLevel?: DeviceRiskLevel;
  status?: DeviceEnrollmentStatus;
  search?: string;
}

export async function listDevices(
  callerRole: string | undefined,
  filter: ListDevicesFilter = {},
) {
  assertSuperAdmin(callerRole);

  // Run the device list query and today's-productivity rollup in
  // parallel. The productivity rollup groups today's snapshots by
  // deviceId and sums the bucket fields — one extra round-trip but
  // GROUP BY on an indexed (deviceId, capturedAt) is cheap.
  const todayStart = todayUtcStart();
  const [devices, productivity] = await Promise.all([
    prisma.device.findMany({
      where: {
        ...(filter.riskLevel ? { currentRiskLevel: filter.riskLevel } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.search
          ? {
              OR: [
                { hostname: { contains: filter.search, mode: 'insensitive' as const } },
                { owner: { name: { contains: filter.search, mode: 'insensitive' as const } } },
                { owner: { email: { contains: filter.search, mode: 'insensitive' as const } } },
              ],
            }
          : {}),
      },
      orderBy: [{ currentRiskLevel: 'desc' }, { lastSeenAt: 'desc' }],
      include: {
        owner: { select: { id: true, name: true, email: true } },
        _count: {
          select: {
            missingPatches: true,
            installedSoftware: { where: { isRisky: true } },
            riskAlerts: { where: { resolvedAt: null } },
          },
        },
      },
    }),
    prisma.deviceHealthSnapshot.groupBy({
      by: ['deviceId'],
      where: { capturedAt: { gte: todayStart } },
      _sum: {
        activeSecondsBucket: true,
        idleSecondsBucket: true,
        lockedSecondsBucket: true,
      },
    }),
  ]);

  const productivityByDevice = new Map(
    productivity.map((p) => [
      p.deviceId,
      {
        active: p._sum.activeSecondsBucket ?? 0,
        idle: p._sum.idleSecondsBucket ?? 0,
        locked: p._sum.lockedSecondsBucket ?? 0,
      },
    ]),
  );

  return devices.map((d) => {
    const prod = productivityByDevice.get(d.id) ?? { active: 0, idle: 0, locked: 0 };
    return {
      id: d.id,
      hostname: d.hostname,
      platform: d.platform,
      osVersion: d.osVersion,
      status: d.status,
      owner: d.owner,
      agentVersion: d.agentVersion,
      lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
      currentRiskScore: d.currentRiskScore,
      currentRiskLevel: d.currentRiskLevel,
      currentPowerState: d.currentPowerState,
      openAlertCount: d._count.riskAlerts,
      missingPatchCount: d._count.missingPatches,
      riskySoftwareCount: d._count.installedSoftware,
      todayActiveSeconds: prod.active,
      todayIdleSeconds: prod.idle,
      todayLockedSeconds: prod.locked,
    };
  });
}

// ─── Device detail ────────────────────────────────────────────────────

export async function getDeviceDetail(
  callerRole: string | undefined,
  deviceId: string,
) {
  assertSuperAdmin(callerRole);

  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      snapshots: { orderBy: { capturedAt: 'desc' }, take: 1 },
      installedSoftware: { orderBy: [{ isRisky: 'desc' }, { name: 'asc' }] },
      missingPatches: { orderBy: [{ severity: 'asc' }, { releasedAt: 'desc' }] },
      riskAlerts: {
        where: { resolvedAt: null },
        orderBy: { openedAt: 'desc' },
        include: { resolvedBy: { select: { id: true, name: true } } },
      },
    },
  });
  if (!device) throw new NotFoundError('Device');

  const latest = device.snapshots[0];

  return {
    id: device.id,
    hostname: device.hostname,
    platform: device.platform,
    osVersion: device.osVersion,
    osBuild: device.osBuild,
    arch: device.arch,
    fingerprint: device.fingerprint,
    apiKeyPrefix: device.apiKeyPrefix,
    status: device.status,
    revokedAt: device.revokedAt ? device.revokedAt.toISOString() : null,
    revokedReason: device.revokedReason,
    owner: device.owner,
    agentVersion: device.agentVersion,
    lastSeenAt: device.lastSeenAt ? device.lastSeenAt.toISOString() : null,
    currentRiskScore: device.currentRiskScore,
    currentRiskLevel: device.currentRiskLevel,
    currentPowerState: device.currentPowerState,
    openAlertCount: device.riskAlerts.length,
    missingPatchCount: device.missingPatches.length,
    riskySoftwareCount: device.installedSoftware.filter((s) => s.isRisky).length,
    createdAt: device.createdAt.toISOString(),
    updatedAt: device.updatedAt.toISOString(),
    latestSnapshot: latest
      ? {
          id: latest.id,
          capturedAt: latest.capturedAt.toISOString(),
          powerState: latest.powerState,
          uptimeSeconds: latest.uptimeSeconds,
          lastBootAt: latest.lastBootAt ? latest.lastBootAt.toISOString() : null,
          defenderEnabled: latest.defenderEnabled,
          firewallEnabled: latest.firewallEnabled,
          bitlockerEnabled: latest.bitlockerEnabled,
          rebootRequired: latest.rebootRequired,
          pendingRebootSince: latest.pendingRebootSince
            ? latest.pendingRebootSince.toISOString()
            : null,
          unsupportedOs: latest.unsupportedOs,
          riskScore: latest.riskScore,
          riskLevel: latest.riskLevel,
          missingPatchCount: latest.missingPatchCount,
          criticalPatchCount: latest.criticalPatchCount,
          riskySoftwareCount: latest.riskySoftwareCount,
          // 2026-05-31 — device-health visibility fix. These columns
          // were being WRITTEN by ingestSnapshot but never read back
          // here, so the agent collected battery / disk / network /
          // session / process-count / tamper signals that the
          // SUPER_ADMIN dashboard could never display. Surfacing them
          // now closes the "collected but not visible" gap.
          loggedInUserName: latest.loggedInUserName,
          currentSessionStart: latest.currentSessionStart
            ? latest.currentSessionStart.toISOString()
            : null,
          runningProcessCount: latest.runningProcessCount,
          batteryPercent: latest.batteryPercent,
          batteryCharging: latest.batteryCharging,
          batteryHealthPercent: latest.batteryHealthPercent,
          diskFreePercent: latest.diskFreePercent,
          diskFreeGb: latest.diskFreeGb,
          networkType: latest.networkType,
          networkConnectivity: latest.networkConnectivity,
          tamperProcessCount: latest.tamperProcessCount,
          runningTamperProcesses: Array.isArray(latest.runningTamperProcesses)
            ? (latest.runningTamperProcesses as { name: string; pid?: number }[])
            : [],
        }
      : null,
    installedSoftware: device.installedSoftware.map((s) => ({
      id: s.id,
      name: s.name,
      version: s.version,
      publisher: s.publisher,
      installDate: s.installDate ? s.installDate.toISOString() : null,
      isRisky: s.isRisky,
      riskReason: s.riskReason,
      lastSeenAt: s.lastSeenAt.toISOString(),
    })),
    missingPatches: device.missingPatches.map((p) => ({
      id: p.id,
      patchId: p.patchId,
      title: p.title,
      classification: p.classification,
      severity: p.severity,
      releasedAt: p.releasedAt ? p.releasedAt.toISOString() : null,
      firstSeenAt: p.firstSeenAt.toISOString(),
    })),
    openAlerts: device.riskAlerts.map((a) => ({
      id: a.id,
      deviceId: a.deviceId,
      type: a.type,
      severity: a.severity,
      message: a.message,
      openedAt: a.openedAt.toISOString(),
      resolvedAt: a.resolvedAt ? a.resolvedAt.toISOString() : null,
      resolutionNote: a.resolutionNote,
      resolvedBy: a.resolvedBy,
    })),
  };
}

// ─── Alerts list (across all devices) ─────────────────────────────────

export interface ListAlertsFilter {
  severity?: DeviceAlertSeverity;
  includeResolved?: boolean;
  limit?: number;
}

export async function listAlerts(
  callerRole: string | undefined,
  filter: ListAlertsFilter = {},
) {
  assertSuperAdmin(callerRole);
  const limit = Math.min(500, filter.limit ?? 100);

  const rows = await prisma.deviceRiskAlert.findMany({
    where: {
      ...(filter.severity ? { severity: filter.severity } : {}),
      ...(filter.includeResolved ? {} : { resolvedAt: null }),
    },
    orderBy: [{ severity: 'asc' }, { openedAt: 'desc' }],
    take: limit,
    include: {
      device: {
        select: {
          id: true,
          hostname: true,
          owner: { select: { id: true, name: true } },
        },
      },
      resolvedBy: { select: { id: true, name: true } },
    },
  });

  return rows.map((a) => ({
    id: a.id,
    deviceId: a.deviceId,
    type: a.type,
    severity: a.severity,
    message: a.message,
    openedAt: a.openedAt.toISOString(),
    resolvedAt: a.resolvedAt ? a.resolvedAt.toISOString() : null,
    resolutionNote: a.resolutionNote,
    resolvedBy: a.resolvedBy,
    device: {
      id: a.device.id,
      hostname: a.device.hostname,
      ownerName: a.device.owner?.name ?? null,
    },
  }));
}

export async function resolveAlert(
  callerRole: string | undefined,
  callerUserId: string,
  alertId: string,
  resolutionNote?: string,
) {
  assertSuperAdmin(callerRole);

  const alert = await prisma.deviceRiskAlert.findUnique({
    where: { id: alertId },
  });
  if (!alert) throw new NotFoundError('DeviceRiskAlert');
  if (alert.resolvedAt) return alert;

  return prisma.deviceRiskAlert.update({
    where: { id: alertId },
    data: {
      resolvedAt: new Date(),
      resolvedByUserId: callerUserId,
      resolutionNote: resolutionNote ?? 'Manually resolved',
    },
  });
}

// ─── Productivity rollup (2026-05-28b) ────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

function ymdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Aggregate DeviceHealthSnapshot.{active,idle,locked}SecondsBucket per
 * day for the last `days` days (UTC). "off" seconds for each day are
 * inferred: `expected = 86400`; `off = max(0, expected - active - idle
 * - locked)`. Rough but useful — gives the admin a sense of how much
 * of the day the agent was even running.
 */
export async function getDeviceProductivity(
  callerRole: string | undefined,
  deviceId: string,
  days: number = 7,
) {
  assertSuperAdmin(callerRole);
  const clamped = Math.max(1, Math.min(30, days));

  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: { id: true },
  });
  if (!device) throw new NotFoundError('Device');

  const now = new Date();
  const sinceDay = new Date(now.getTime() - clamped * DAY_MS);
  // Anchor "since" to the start of the day in UTC for clean buckets.
  sinceDay.setUTCHours(0, 0, 0, 0);

  const snapshots = await prisma.deviceHealthSnapshot.findMany({
    where: { deviceId, capturedAt: { gte: sinceDay } },
    select: {
      capturedAt: true,
      activeSecondsBucket: true,
      idleSecondsBucket: true,
      lockedSecondsBucket: true,
    },
    orderBy: { capturedAt: 'asc' },
  });

  type DayRow = {
    activeSeconds: number;
    idleSeconds: number;
    lockedSeconds: number;
    snapshotCount: number;
  };
  const byDay = new Map<string, DayRow>();
  for (const s of snapshots) {
    const key = ymdUtc(s.capturedAt);
    const row = byDay.get(key) ?? {
      activeSeconds: 0,
      idleSeconds: 0,
      lockedSeconds: 0,
      snapshotCount: 0,
    };
    row.activeSeconds += s.activeSecondsBucket;
    row.idleSeconds += s.idleSecondsBucket;
    row.lockedSeconds += s.lockedSecondsBucket;
    row.snapshotCount += 1;
    byDay.set(key, row);
  }

  // Fill in zero-rows for days with no snapshots so the chart has a
  // contiguous x-axis.
  const out: {
    date: string;
    activeSeconds: number;
    idleSeconds: number;
    lockedSeconds: number;
    offSeconds: number;
    snapshotCount: number;
  }[] = [];
  for (let i = clamped - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * DAY_MS);
    d.setUTCHours(0, 0, 0, 0);
    const key = ymdUtc(d);
    const row = byDay.get(key) ?? {
      activeSeconds: 0,
      idleSeconds: 0,
      lockedSeconds: 0,
      snapshotCount: 0,
    };
    const expected = 24 * 60 * 60;
    const accounted = row.activeSeconds + row.idleSeconds + row.lockedSeconds;
    const offSeconds = Math.max(0, expected - accounted);
    out.push({
      date: key,
      activeSeconds: row.activeSeconds,
      idleSeconds: row.idleSeconds,
      lockedSeconds: row.lockedSeconds,
      offSeconds,
      snapshotCount: row.snapshotCount,
    });
  }
  return { deviceId, days: out };
}
