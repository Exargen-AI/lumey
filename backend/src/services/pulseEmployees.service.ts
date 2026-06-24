/**
 * Pulse — Per-employee admin views (2026-05-29).
 *
 * Pivot from the device-centric Pulse views to a person-centric one.
 * Each employee can own multiple devices; this service aggregates
 * across all of them.
 *
 * SUPER_ADMIN-only — `assertSuperAdmin` defends in depth on top of
 * the route-layer `requireRoles` middleware.
 *
 * Data sources:
 *   - User row (identity)
 *   - Device rows owned by the user (status, lastSeenAt, powerState,
 *     riskLevel, alert/patch/risky counts)
 *   - DeviceHealthSnapshot today (active/idle/locked buckets)
 *   - DeviceAppActivity today (per-app foreground time, categorised)
 *
 * Performance: each call is one round-trip per data source via
 * `Promise.all`. The team list is bounded by # of employees (small at
 * Exargen scale); the detail view is bounded by # of devices per
 * employee (typically 1-2).
 */

import {
  AppCategory,
  DeviceEnrollmentStatus,
  DeviceRiskLevel,
} from '@prisma/client';
import prisma from '../config/database';
import { ForbiddenError, NotFoundError } from '../utils/errors';
import { UserRole } from '@exargen/shared';
import { computeProductivityScore } from './pulseEmployeeScore.service';

function assertSuperAdmin(role: string | undefined) {
  if (role !== UserRole.SUPER_ADMIN) {
    throw new ForbiddenError('Pulse is restricted to SUPER_ADMIN');
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ONLINE_WINDOW_MS = 5 * 60 * 1000; // device counts as online if heartbeat within 5 min
const OFFLINE_WINDOW_MS = 30 * 60 * 1000; // no heartbeat for 30 min → offline

function todayUtcStart(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function ymdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── Presence derivation ──────────────────────────────────────────────
//
// Pure function — given a device's lastSeen / powerState, what's the
// employee's presence right now? Used by both the list + detail views.

type PresenceInput = {
  lastSeenAt: Date | null;
  powerState: 'ON' | 'IDLE' | 'LOCKED' | 'OFF' | null;
};

export type EmployeePresence = 'ONLINE' | 'AWAY' | 'LOCKED' | 'OFFLINE';

export function derivePresence(input: PresenceInput): EmployeePresence {
  if (!input.lastSeenAt) return 'OFFLINE';
  const ageMs = Date.now() - input.lastSeenAt.getTime();
  if (ageMs > OFFLINE_WINDOW_MS) return 'OFFLINE';
  if (input.powerState === 'LOCKED') return 'LOCKED';
  if (input.powerState === 'IDLE') return 'AWAY';
  if (input.powerState === 'ON' && ageMs <= ONLINE_WINDOW_MS) return 'ONLINE';
  // ON but heartbeat is stale-ish (5–30 min) → treat as AWAY (laptop
  // didn't lock yet but the user hasn't touched it).
  return 'AWAY';
}

function pickWorstRisk(levels: (DeviceRiskLevel | null)[]): DeviceRiskLevel | null {
  if (levels.includes('CRITICAL')) return 'CRITICAL';
  if (levels.includes('AT_RISK')) return 'AT_RISK';
  if (levels.includes('HEALTHY')) return 'HEALTHY';
  return null;
}

// ─── listEmployees — for the Employees tab ─────────────────────────────

export async function listEmployees(callerRole: string | undefined) {
  assertSuperAdmin(callerRole);

  const todayStart = todayUtcStart();

  // Only HUMAN + ACTIVE users (AGENT users don't have devices in v1).
  const [users, productivityRows, appRows, openAlertsByDevice, currentAppRows] = await Promise.all([
    prisma.user.findMany({
      where: { userType: 'HUMAN', isActive: true },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        ownedDevices: {
          select: {
            id: true,
            hostname: true,
            status: true,
            lastSeenAt: true,
            currentPowerState: true,
            currentRiskLevel: true,
          },
          where: { status: DeviceEnrollmentStatus.ACTIVE },
        },
      },
      orderBy: { name: 'asc' },
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
    prisma.deviceAppActivity.groupBy({
      by: ['deviceId', 'category'],
      where: { bucketStart: { gte: todayStart } },
      _sum: { foregroundSeconds: true },
    }),
    prisma.deviceRiskAlert.groupBy({
      by: ['deviceId'],
      where: { resolvedAt: null },
      _count: { _all: true },
    }),
    // "Current app" is whichever device's most-recent snapshot reported
    // app activity. Pull the freshest few rows; we'll match per-user.
    prisma.deviceAppActivity.findMany({
      where: { bucketStart: { gte: todayStart } },
      orderBy: [{ deviceId: 'asc' }, { bucketStart: 'desc' }],
      take: 1_000,
    }),
  ]);

  const productivityByDevice = new Map(
    productivityRows.map((r) => [
      r.deviceId,
      {
        active: r._sum.activeSecondsBucket ?? 0,
        idle: r._sum.idleSecondsBucket ?? 0,
        locked: r._sum.lockedSecondsBucket ?? 0,
      },
    ]),
  );
  const alertsByDevice = new Map(
    openAlertsByDevice.map((r) => [r.deviceId, r._count._all]),
  );
  // category sum per device
  const appByDevice = new Map<string, Record<AppCategory, number>>();
  for (const r of appRows) {
    const m = appByDevice.get(r.deviceId) ?? {
      PRODUCTIVE: 0,
      COMMUNICATION: 0,
      ENTERTAINMENT: 0,
      PERSONAL: 0,
      UNKNOWN: 0,
      TAMPER: 0,
    };
    m[r.category] = (m[r.category] ?? 0) + (r._sum.foregroundSeconds ?? 0);
    appByDevice.set(r.deviceId, m);
  }
  // first row per device = freshest app activity (because we sorted desc)
  const currentAppByDevice = new Map<string, (typeof currentAppRows)[number]>();
  for (const row of currentAppRows) {
    if (!currentAppByDevice.has(row.deviceId)) {
      currentAppByDevice.set(row.deviceId, row);
    }
  }

  // top 3 apps per device (used to roll up "top apps" per employee)
  const topAppsRaw = await prisma.deviceAppActivity.findMany({
    where: { bucketStart: { gte: todayStart } },
    orderBy: { foregroundSeconds: 'desc' },
    take: 5_000,
  });

  return users.map((u) => {
    if (u.ownedDevices.length === 0) {
      return {
        user: { id: u.id, name: u.name, email: u.email, role: u.role },
        presence: 'OFFLINE' as EmployeePresence,
        lastSeenAt: null,
        todayActiveSeconds: 0,
        todayIdleSeconds: 0,
        todayLockedSeconds: 0,
        todayProductiveSeconds: 0,
        todayEntertainmentSeconds: 0,
        todayPersonalSeconds: 0,
        todayCommunicationSeconds: 0,
        todayUnknownSeconds: 0,
        todayTamperSeconds: 0,
        productivityScore: 0,
        productivityBand: 'LOW' as const,
        productivitySummary: 'No devices enrolled',
        currentApp: null,
        topApps: [],
        currentSessionStart: null,
        deviceCount: 0,
        worstRiskLevel: null,
        openAlertCount: 0,
      };
    }

    // Aggregate across all devices owned by this employee.
    let active = 0;
    let idle = 0;
    let locked = 0;
    const catSum: Record<AppCategory, number> = {
      PRODUCTIVE: 0,
      COMMUNICATION: 0,
      ENTERTAINMENT: 0,
      PERSONAL: 0,
      UNKNOWN: 0,
      TAMPER: 0,
    };
    let openAlerts = 0;
    let latestLastSeen: Date | null = null;
    let latestPowerState: 'ON' | 'IDLE' | 'LOCKED' | 'OFF' | null = null;
    let currentAppRow: (typeof currentAppRows)[number] | null = null;

    for (const d of u.ownedDevices) {
      const prod = productivityByDevice.get(d.id);
      if (prod) {
        active += prod.active;
        idle += prod.idle;
        locked += prod.locked;
      }
      const cats = appByDevice.get(d.id);
      if (cats) {
        for (const k of Object.keys(cats) as AppCategory[]) catSum[k] += cats[k];
      }
      openAlerts += alertsByDevice.get(d.id) ?? 0;
      if (d.lastSeenAt && (!latestLastSeen || d.lastSeenAt > latestLastSeen)) {
        latestLastSeen = d.lastSeenAt;
        latestPowerState = d.currentPowerState;
        currentAppRow = currentAppByDevice.get(d.id) ?? null;
      }
    }

    const presence = derivePresence({
      lastSeenAt: latestLastSeen,
      powerState: latestPowerState,
    });

    // Top apps for this employee — sum across all their devices, then
    // sort. Tiny set so we can do it in JS.
    const deviceIds = new Set(u.ownedDevices.map((d) => d.id));
    const userApps = new Map<string, {
      appName: string;
      appDisplayName: string | null;
      category: AppCategory;
      categoryReason: string | null;
      lastWindowTitle: string | null;
      foregroundSeconds: number;
    }>();
    for (const row of topAppsRaw) {
      if (!deviceIds.has(row.deviceId)) continue;
      const existing = userApps.get(row.appName);
      if (existing) {
        existing.foregroundSeconds += row.foregroundSeconds;
        if (row.lastWindowTitle) existing.lastWindowTitle = row.lastWindowTitle;
      } else {
        userApps.set(row.appName, {
          appName: row.appName,
          appDisplayName: row.appDisplayName,
          category: row.category,
          categoryReason: row.categoryReason,
          lastWindowTitle: row.lastWindowTitle,
          foregroundSeconds: row.foregroundSeconds,
        });
      }
    }
    const topApps = Array.from(userApps.values())
      .sort((a, b) => b.foregroundSeconds - a.foregroundSeconds)
      .slice(0, 3);

    const score = computeProductivityScore({
      productiveSeconds: catSum.PRODUCTIVE,
      communicationSeconds: catSum.COMMUNICATION,
      entertainmentSeconds: catSum.ENTERTAINMENT,
      personalSeconds: catSum.PERSONAL,
      unknownSeconds: catSum.UNKNOWN,
      tamperSeconds: catSum.TAMPER,
      activeSeconds: active,
    });

    return {
      user: { id: u.id, name: u.name, email: u.email, role: u.role },
      presence,
      lastSeenAt: latestLastSeen ? latestLastSeen.toISOString() : null,
      todayActiveSeconds: active,
      todayIdleSeconds: idle,
      todayLockedSeconds: locked,
      todayProductiveSeconds: catSum.PRODUCTIVE,
      todayCommunicationSeconds: catSum.COMMUNICATION,
      todayEntertainmentSeconds: catSum.ENTERTAINMENT,
      todayPersonalSeconds: catSum.PERSONAL,
      todayUnknownSeconds: catSum.UNKNOWN,
      todayTamperSeconds: catSum.TAMPER,
      productivityScore: score.score,
      productivityBand: score.band,
      productivitySummary: score.summary,
      currentApp: currentAppRow
        ? {
            appName: currentAppRow.appName,
            appDisplayName: currentAppRow.appDisplayName,
            windowTitle: currentAppRow.lastWindowTitle,
            category: currentAppRow.category,
            asOf: currentAppRow.bucketEnd.toISOString(),
          }
        : null,
      topApps,
      currentSessionStart: null, // backfilled from latest snapshot below
      deviceCount: u.ownedDevices.length,
      worstRiskLevel: pickWorstRisk(u.ownedDevices.map((d) => d.currentRiskLevel)),
      openAlertCount: openAlerts,
    };
  });
}

// ─── Employee detail ─────────────────────────────────────────────────

export async function getEmployeeDetail(callerRole: string | undefined, userId: string) {
  assertSuperAdmin(callerRole);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, userType: true, isActive: true },
  });
  if (!user) throw new NotFoundError('User');

  const todayStart = todayUtcStart();
  const sevenDaysAgo = new Date(todayStart.getTime() - 6 * DAY_MS);

  const [devices, todayApps, weekActive, latestSnapshots] = await Promise.all([
    prisma.device.findMany({
      where: { ownerUserId: userId, status: DeviceEnrollmentStatus.ACTIVE },
      include: {
        _count: {
          select: {
            missingPatches: true,
            installedSoftware: { where: { isRisky: true } },
            riskAlerts: { where: { resolvedAt: null } },
          },
        },
      },
    }),
    prisma.deviceAppActivity.findMany({
      where: {
        bucketStart: { gte: todayStart },
        device: { ownerUserId: userId },
      },
      orderBy: { foregroundSeconds: 'desc' },
    }),
    prisma.deviceHealthSnapshot.findMany({
      where: {
        capturedAt: { gte: sevenDaysAgo },
        device: { ownerUserId: userId },
      },
      select: {
        capturedAt: true,
        activeSecondsBucket: true,
        idleSecondsBucket: true,
        lockedSecondsBucket: true,
      },
    }),
    prisma.deviceHealthSnapshot.findMany({
      where: {
        device: { ownerUserId: userId },
      },
      orderBy: { capturedAt: 'desc' },
      take: 1,
    }),
  ]);

  // Roll up devices into summary shape (matches PulseDeviceSummary).
  const deviceProd = new Map<string, { active: number; idle: number; locked: number }>();
  for (const s of weekActive) {
    if (s.capturedAt < todayStart) continue;
    // We don't have deviceId on the select above — but we have device through the where filter.
    // Instead, we'll compute per-device today from a separate quick query:
  }
  // Quick per-device today summary (one extra cheap call for clean code path).
  const perDeviceToday = await prisma.deviceHealthSnapshot.groupBy({
    by: ['deviceId'],
    where: {
      capturedAt: { gte: todayStart },
      device: { ownerUserId: userId },
    },
    _sum: {
      activeSecondsBucket: true,
      idleSecondsBucket: true,
      lockedSecondsBucket: true,
    },
  });
  for (const r of perDeviceToday) {
    deviceProd.set(r.deviceId, {
      active: r._sum.activeSecondsBucket ?? 0,
      idle: r._sum.idleSecondsBucket ?? 0,
      locked: r._sum.lockedSecondsBucket ?? 0,
    });
  }

  const devicesSummary = devices.map((d) => {
    const prod = deviceProd.get(d.id) ?? { active: 0, idle: 0, locked: 0 };
    return {
      id: d.id,
      hostname: d.hostname,
      platform: d.platform,
      osVersion: d.osVersion,
      status: d.status,
      owner: { id: user.id, name: user.name, email: user.email },
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

  // Today's app split + cat sums.
  const catSum: Record<AppCategory, number> = {
    PRODUCTIVE: 0,
    COMMUNICATION: 0,
    ENTERTAINMENT: 0,
    PERSONAL: 0,
    UNKNOWN: 0,
    TAMPER: 0,
  };
  const mergedApps = new Map<string, {
    appName: string;
    appDisplayName: string | null;
    category: AppCategory;
    categoryReason: string | null;
    lastWindowTitle: string | null;
    foregroundSeconds: number;
  }>();
  for (const row of todayApps) {
    catSum[row.category] += row.foregroundSeconds;
    const existing = mergedApps.get(row.appName);
    if (existing) {
      existing.foregroundSeconds += row.foregroundSeconds;
      if (row.lastWindowTitle) existing.lastWindowTitle = row.lastWindowTitle;
    } else {
      mergedApps.set(row.appName, {
        appName: row.appName,
        appDisplayName: row.appDisplayName,
        category: row.category,
        categoryReason: row.categoryReason,
        lastWindowTitle: row.lastWindowTitle,
        foregroundSeconds: row.foregroundSeconds,
      });
    }
  }
  const allAppsToday = Array.from(mergedApps.values()).sort(
    (a, b) => b.foregroundSeconds - a.foregroundSeconds,
  );

  // Today's totals across all devices.
  let active = 0;
  let idle = 0;
  let locked = 0;
  for (const r of perDeviceToday) {
    active += r._sum.activeSecondsBucket ?? 0;
    idle += r._sum.idleSecondsBucket ?? 0;
    locked += r._sum.lockedSecondsBucket ?? 0;
  }

  // Presence — same logic as listEmployees.
  let latestLastSeen: Date | null = null;
  let latestPowerState: 'ON' | 'IDLE' | 'LOCKED' | 'OFF' | null = null;
  let openAlertCount = 0;
  for (const d of devices) {
    if (d.lastSeenAt && (!latestLastSeen || d.lastSeenAt > latestLastSeen)) {
      latestLastSeen = d.lastSeenAt;
      latestPowerState = d.currentPowerState;
    }
    openAlertCount += d._count.riskAlerts;
  }
  const presence = derivePresence({
    lastSeenAt: latestLastSeen,
    powerState: latestPowerState,
  });

  // 7-day per-day breakdown by category (one extra grouped query).
  const weekCategoryRows = await prisma.deviceAppActivity.findMany({
    where: {
      bucketStart: { gte: sevenDaysAgo },
      device: { ownerUserId: userId },
    },
    select: { bucketStart: true, category: true, foregroundSeconds: true },
  });
  // Also per-day active/idle/locked totals.
  const weekActivityByDay = new Map<
    string,
    { active: number; idle: number; locked: number }
  >();
  for (const s of weekActive) {
    const k = ymdUtc(s.capturedAt);
    const row = weekActivityByDay.get(k) ?? { active: 0, idle: 0, locked: 0 };
    row.active += s.activeSecondsBucket;
    row.idle += s.idleSecondsBucket;
    row.locked += s.lockedSecondsBucket;
    weekActivityByDay.set(k, row);
  }
  const weekCatByDay = new Map<string, Record<AppCategory, number>>();
  for (const r of weekCategoryRows) {
    const k = ymdUtc(r.bucketStart);
    const row = weekCatByDay.get(k) ?? {
      PRODUCTIVE: 0,
      COMMUNICATION: 0,
      ENTERTAINMENT: 0,
      PERSONAL: 0,
      UNKNOWN: 0,
      TAMPER: 0,
    };
    row[r.category] += r.foregroundSeconds;
    weekCatByDay.set(k, row);
  }
  const now = new Date();
  const weekHistory: {
    date: string;
    activeSeconds: number;
    productiveSeconds: number;
    communicationSeconds: number;
    entertainmentSeconds: number;
    personalSeconds: number;
    unknownSeconds: number;
    tamperSeconds: number;
  }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * DAY_MS);
    d.setUTCHours(0, 0, 0, 0);
    const k = ymdUtc(d);
    const activity = weekActivityByDay.get(k) ?? { active: 0, idle: 0, locked: 0 };
    const cats = weekCatByDay.get(k) ?? {
      PRODUCTIVE: 0,
      COMMUNICATION: 0,
      ENTERTAINMENT: 0,
      PERSONAL: 0,
      UNKNOWN: 0,
      TAMPER: 0,
    };
    weekHistory.push({
      date: k,
      activeSeconds: activity.active,
      productiveSeconds: cats.PRODUCTIVE,
      communicationSeconds: cats.COMMUNICATION,
      entertainmentSeconds: cats.ENTERTAINMENT,
      personalSeconds: cats.PERSONAL,
      unknownSeconds: cats.UNKNOWN,
      tamperSeconds: cats.TAMPER,
    });
  }

  const latestSnapshot = latestSnapshots[0] ?? null;

  const detailScore = computeProductivityScore({
    productiveSeconds: catSum.PRODUCTIVE,
    communicationSeconds: catSum.COMMUNICATION,
    entertainmentSeconds: catSum.ENTERTAINMENT,
    personalSeconds: catSum.PERSONAL,
    unknownSeconds: catSum.UNKNOWN,
    tamperSeconds: catSum.TAMPER,
    activeSeconds: active,
  });

  return {
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    presence,
    lastSeenAt: latestLastSeen ? latestLastSeen.toISOString() : null,
    todayActiveSeconds: active,
    todayIdleSeconds: idle,
    todayLockedSeconds: locked,
    todayProductiveSeconds: catSum.PRODUCTIVE,
    todayCommunicationSeconds: catSum.COMMUNICATION,
    todayEntertainmentSeconds: catSum.ENTERTAINMENT,
    todayPersonalSeconds: catSum.PERSONAL,
    todayUnknownSeconds: catSum.UNKNOWN,
    todayTamperSeconds: catSum.TAMPER,
    productivityScore: detailScore.score,
    productivityBand: detailScore.band,
    productivitySummary: detailScore.summary,
    productivityBreakdown: detailScore.breakdown,
    productivityScoringVersion: detailScore.scoringVersion,
    currentApp:
      todayApps.length > 0
        ? {
            appName: todayApps[0]!.appName,
            appDisplayName: todayApps[0]!.appDisplayName,
            windowTitle: todayApps[0]!.lastWindowTitle,
            category: todayApps[0]!.category,
            asOf: todayApps[0]!.bucketEnd.toISOString(),
          }
        : null,
    topApps: allAppsToday.slice(0, 3),
    currentSessionStart: latestSnapshot?.currentSessionStart
      ? latestSnapshot.currentSessionStart.toISOString()
      : null,
    deviceCount: devices.length,
    worstRiskLevel: pickWorstRisk(devices.map((d) => d.currentRiskLevel)),
    openAlertCount,
    devices: devicesSummary,
    allAppsToday,
    weekHistory,
  };
}


// ─── Self-service today summary (2026-05-29) ─────────────────────────
//
// Employee-facing endpoint — no SUPER_ADMIN gate. Returns the calling
// user's own activity for today: active/idle/locked seconds, productive
// app time, and a "productivity score" derived from the same rubric
// the admin dashboard uses. Powers the TodayVibeCard component.

export interface MyTodaySummary {
  activeSeconds: number;
  idleSeconds: number;
  lockedSeconds: number;
  productiveSeconds: number;
  entertainmentSeconds: number;
  // Devices the user owns that reported anything today.
  reportingDeviceCount: number;
  // Has the user submitted a standup today?
  standupSubmittedToday: boolean;
  // Are they currently clocked in?
  currentlyClockedIn: boolean;
  // Stable per-day, used by the frontend to drive a "today's quote"
  // selection without needing a server round-trip.
  dateKey: string;
}

export async function getMyTodaySummary(userId: string): Promise<MyTodaySummary> {
  const todayStart = todayUtcStart();

  const [productivity, apps, devices, latestDailyUpdate, openClockSession] = await Promise.all([
    prisma.deviceHealthSnapshot.groupBy({
      by: ['deviceId'],
      where: {
        capturedAt: { gte: todayStart },
        device: { ownerUserId: userId },
      },
      _sum: {
        activeSecondsBucket: true,
        idleSecondsBucket: true,
        lockedSecondsBucket: true,
      },
    }),
    prisma.deviceAppActivity.groupBy({
      by: ['category'],
      where: {
        bucketStart: { gte: todayStart },
        device: { ownerUserId: userId },
      },
      _sum: { foregroundSeconds: true },
    }),
    prisma.device.count({
      where: {
        ownerUserId: userId,
        status: 'ACTIVE',
        lastSeenAt: { gte: todayStart },
      },
    }),
    prisma.dailyUpdate.findFirst({
      where: { userId, date: { gte: todayStart } },
      select: { id: true },
    }),
    prisma.clockSession.findFirst({
      where: { userId, clockedOutAt: null, autoClosedAt: null },
      select: { id: true },
    }),
  ]);

  let activeSeconds = 0;
  let idleSeconds = 0;
  let lockedSeconds = 0;
  for (const p of productivity) {
    activeSeconds += p._sum.activeSecondsBucket ?? 0;
    idleSeconds += p._sum.idleSecondsBucket ?? 0;
    lockedSeconds += p._sum.lockedSecondsBucket ?? 0;
  }

  let productiveSeconds = 0;
  let entertainmentSeconds = 0;
  for (const a of apps) {
    if (a.category === 'PRODUCTIVE') productiveSeconds += a._sum.foregroundSeconds ?? 0;
    if (a.category === 'ENTERTAINMENT') entertainmentSeconds += a._sum.foregroundSeconds ?? 0;
  }

  return {
    activeSeconds,
    idleSeconds,
    lockedSeconds,
    productiveSeconds,
    entertainmentSeconds,
    reportingDeviceCount: devices,
    standupSubmittedToday: !!latestDailyUpdate,
    currentlyClockedIn: !!openClockSession,
    dateKey: todayStart.toISOString().slice(0, 10),
  };
}
