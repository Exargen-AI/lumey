/**
 * Pulse — Telemetry ingestion (heartbeats + full snapshots).
 *
 * The Windows agent calls one of two endpoints:
 *
 *   • heartbeat (≈every 5 min): cheap. Updates Device.lastSeenAt,
 *     currentPowerState, currentRiskScore stays as-is. No history.
 *
 *   • snapshot (≈every 60 min): heavy. Writes a DeviceHealthSnapshot,
 *     replaces installed-software inventory (upsert + prune), replaces
 *     missing-patch list (upsert + prune), runs the risk scorer, opens
 *     or resolves DeviceRiskAlerts to match the current state.
 *
 * Both run after deviceAuthenticate has set req.device. The service
 * functions take the device row by id and trust it (no further auth
 * check needed — the middleware boundary is the privilege gate).
 */

import {
  DeviceAlertSeverity,
  DeviceAlertType,
  DevicePowerState,
  Prisma,
} from '@prisma/client';
import prisma from '../config/database';
import { ValidationError } from '../utils/errors';
import {
  computeDeviceRisk,
  RiskInputs,
  RiskPenalty,
} from './deviceRisk.service';
import { emitProductivityEvents } from '../lib/productivityOutbox';
import { toDateOnlyString } from '../utils/date';

// Block list of known-risky software, name-substring matched (case-
// insensitive). Tiny v1 list; future SUPER_ADMIN UI can edit + back-apply.
const RISKY_SOFTWARE_PATTERNS: { match: RegExp; reason: string }[] = [
  { match: /utorrent/i, reason: 'BitTorrent client' },
  { match: /bittorrent/i, reason: 'BitTorrent client' },
  { match: /teamviewer/i, reason: 'Remote-access tool' },
  { match: /anydesk/i, reason: 'Remote-access tool' },
  { match: /\bvnc\b/i, reason: 'Remote-access tool' },
  { match: /keylogger/i, reason: 'Keylogger' },
  { match: /coinminer/i, reason: 'Crypto miner' },
  { match: /xmrig/i, reason: 'Crypto miner' },
];

function classifyRiskySoftware(name: string): { isRisky: boolean; reason: string | null } {
  for (const rule of RISKY_SOFTWARE_PATTERNS) {
    if (rule.match.test(name)) return { isRisky: true, reason: rule.reason };
  }
  return { isRisky: false, reason: null };
}

function severityIsCritical(severity: string | null | undefined): boolean {
  if (!severity) return false;
  return severity.trim().toLowerCase() === 'critical';
}

// ─── Heartbeat (cheap, frequent) ──────────────────────────────────────

export interface HeartbeatInput {
  deviceId: string;
  powerState: DevicePowerState;
  uptimeSeconds: number;
  agentVersion: string;
  ip?: string | null;
  // Wave 9 — agent self-health.
  cpuPercent?: number | null;
  memoryMb?: number | null;
  errorCount?: number | null;
  lastErrorAt?: Date | null;
  lastErrorMessage?: string | null;
  // Wave 9 — kill-switch state passed from the route layer. If the
  // device's status isn't ACTIVE, we still record the heartbeat (so
  // logs show the agent is alive) and the handler returns
  // `revoked: true` so the agent can exit cleanly.
  isRevoked?: boolean;
}

export interface HeartbeatResult {
  ok: true;
  nextHeartbeatInSeconds: number;
  // Wave 9 — when the device has been revoked. Agent reads this and
  // shuts down cleanly instead of looping on 401s forever.
  revoked: boolean;
}

export async function ingestHeartbeat(input: HeartbeatInput): Promise<HeartbeatResult> {
  if (input.uptimeSeconds < 0 || !Number.isFinite(input.uptimeSeconds)) {
    throw new ValidationError('uptimeSeconds must be a non-negative finite number');
  }

  await prisma.device.update({
    where: { id: input.deviceId },
    data: {
      lastSeenAt: new Date(),
      currentPowerState: input.powerState,
      agentVersion: input.agentVersion,
      lastHeartbeatIp: input.ip ?? null,
      // Wave 9 — agent self-health. Stored on Device (gauge style)
      // rather than per-heartbeat — we only need the latest value
      // to decide if an agent's bleeding memory / throwing errors.
      // errorCount uses `set` (not `increment`) because the agent
      // reports its OWN running counter; we mirror it. The reset
      // case ("we cleared the counter") still works that way.
      ...(input.cpuPercent != null ? { lastCpuPercent: input.cpuPercent } : {}),
      ...(input.memoryMb != null ? { lastMemoryMb: input.memoryMb } : {}),
      ...(input.errorCount != null ? { agentErrorCount: input.errorCount } : {}),
      ...(input.lastErrorAt != null ? { agentLastErrorAt: input.lastErrorAt } : {}),
      ...(input.lastErrorMessage !== undefined
        ? { agentLastErrorMessage: input.lastErrorMessage }
        : {}),
    },
  });

  // Opportunistically sweep the fleet for heartbeat gaps. Throttled
  // module-side to once per 5 min — even with 100 devices heartbeating,
  // we only run this 12 times/hour total, not 100 × 12.
  void detectHeartbeatGaps();

  return {
    ok: true as const,
    nextHeartbeatInSeconds: 300,
    revoked: input.isRevoked === true,
  };
}

// ─── Heartbeat-gap detection (anti-tamper, 2026-05-29) ───────────────
//
// A device that hasn't reported within HEARTBEAT_GAP_THRESHOLD_MS while
// in ACTIVE status is suspicious. Could be:
//   • Laptop legitimately off (lunch / overnight) — handled by quiet
//     hours
//   • Network outage (wifi dropped) — temporary, resolves on its own
//   • Agent service was killed / config tampered — what we want to
//     catch
//
// We open a HEARTBEAT_GAP_DETECTED alert at WARNING severity. The
// alert auto-resolves on the next snapshot/heartbeat from that
// device — same lifecycle as other risk alerts.

const HEARTBEAT_GAP_THRESHOLD_MS = 30 * 60 * 1000; // 30 min
const GAP_SWEEP_THROTTLE_MS = 5 * 60 * 1000; // 5 min
const QUIET_HOURS_START = 22; // 10pm UTC — adjust per deployment timezone
const QUIET_HOURS_END = 6; //   6am UTC

let lastGapSweepAt = 0;

function inQuietHours(now: Date): boolean {
  const h = now.getUTCHours();
  return QUIET_HOURS_START < QUIET_HOURS_END
    ? h >= QUIET_HOURS_START && h < QUIET_HOURS_END
    : h >= QUIET_HOURS_START || h < QUIET_HOURS_END;
}

export async function detectHeartbeatGaps(force = false): Promise<{
  opened: number;
  resolved: number;
  skipped?: 'throttled' | 'quiet-hours';
}> {
  const now = new Date();
  if (!force && now.getTime() - lastGapSweepAt < GAP_SWEEP_THROTTLE_MS) {
    return { opened: 0, resolved: 0, skipped: 'throttled' };
  }
  if (!force && inQuietHours(now)) {
    // Skip during quiet hours — most laptops are legitimately off.
    return { opened: 0, resolved: 0, skipped: 'quiet-hours' };
  }
  lastGapSweepAt = now.getTime();

  const cutoff = new Date(now.getTime() - HEARTBEAT_GAP_THRESHOLD_MS);

  // Devices that are ACTIVE + have gone quiet — open a gap alert.
  const stale = await prisma.device.findMany({
    where: {
      status: 'ACTIVE',
      OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: cutoff } }],
    },
    select: { id: true, hostname: true, lastSeenAt: true },
  });

  // Existing open gap alerts → we'll auto-resolve any whose device is
  // now fresh.
  const openGapAlerts = await prisma.deviceRiskAlert.findMany({
    where: { type: 'HEARTBEAT_GAP_DETECTED', resolvedAt: null },
    select: { id: true, deviceId: true },
  });
  const staleIds = new Set(stale.map((d) => d.id));
  const openByDevice = new Map(openGapAlerts.map((a) => [a.deviceId, a.id]));

  // Resolve alerts for devices that are no longer stale.
  const toResolveIds: string[] = [];
  for (const [deviceId, alertId] of openByDevice) {
    if (!staleIds.has(deviceId)) toResolveIds.push(alertId);
  }
  if (toResolveIds.length > 0) {
    await prisma.deviceRiskAlert.updateMany({
      where: { id: { in: toResolveIds } },
      data: {
        resolvedAt: new Date(),
        resolutionNote: 'Auto-resolved: device heartbeat restored',
      },
    });
  }

  // Open new alerts for newly-stale devices.
  let opened = 0;
  for (const d of stale) {
    if (openByDevice.has(d.id)) continue;
    const lastSeenMin = d.lastSeenAt
      ? Math.floor((now.getTime() - d.lastSeenAt.getTime()) / 60_000)
      : null;
    await prisma.deviceRiskAlert.create({
      data: {
        deviceId: d.id,
        type: 'HEARTBEAT_GAP_DETECTED',
        severity: 'WARNING',
        message: lastSeenMin
          ? `Agent has been silent for ${lastSeenMin} min — service may have been stopped or config tampered with`
          : 'Agent has never reported — service may not be running',
      },
    });
    opened++;
  }

  return { opened, resolved: toResolveIds.length };
}

// ─── Full snapshot ingestion ──────────────────────────────────────────

export interface SnapshotSoftwareEntry {
  name: string;
  version?: string;
  publisher?: string;
  installDate?: Date | null;
}

export interface SnapshotPatchEntry {
  patchId: string;
  title?: string;
  classification?: string;
  severity?: string;
  releasedAt?: Date | null;
}

export interface SnapshotAppBucketEntry {
  appName: string;
  appDisplayName?: string | null;
  lastWindowTitle?: string | null;
  foregroundSeconds: number;
  category: 'PRODUCTIVE' | 'COMMUNICATION' | 'ENTERTAINMENT' | 'PERSONAL' | 'UNKNOWN' | 'TAMPER';
  categoryReason?: string | null;
}

export interface SnapshotInput {
  deviceId: string;
  powerState: DevicePowerState;
  uptimeSeconds: number;
  lastBootAt?: Date | null;
  loggedInUserName?: string;
  defenderEnabled?: boolean | null;
  firewallEnabled?: boolean | null;
  bitlockerEnabled?: boolean | null;
  rebootRequired?: boolean | null;
  pendingRebootSince?: Date | null;
  unsupportedOs?: boolean | null;
  installedSoftware: SnapshotSoftwareEntry[];
  missingPatches: SnapshotPatchEntry[];
  // 2026-05-28b — Productivity time buckets (agent-side accumulators
  // since the previous snapshot). Optional — older agents that don't
  // ship this slot in with 0s and the dashboard treats them as "no
  // productivity data yet".
  activeSecondsBucket?: number;
  idleSecondsBucket?: number;
  lockedSecondsBucket?: number;
  // 2026-05-29 — Per-employee activity tracking
  currentSessionStart?: Date | null;
  runningProcessCount?: number | null;
  appBucketStart?: Date | null;
  appBucketEnd?: Date | null;
  appBuckets?: SnapshotAppBucketEntry[];
  // ─── Wave 9 — agent resilience signals (2026-05-30) ─────────────
  runningTamperProcesses?: Array<{ name: string; pid?: number }>;
  batteryPercent?: number | null;
  batteryCharging?: boolean | null;
  batteryHealthPercent?: number | null;
  diskFreePercent?: number | null;
  diskFreeGb?: number | null;
  networkType?: 'ETHERNET' | 'WIFI' | 'CELLULAR' | 'VPN' | 'UNKNOWN' | null;
  networkConnectivity?: 'INTERNET' | 'LOCAL_ONLY' | 'NO_TRAFFIC' | 'UNKNOWN' | null;
  agentVersion: string;
  ip?: string | null;
}

export interface SnapshotResult {
  snapshotId: string;
  riskScore: number;
  riskLevel: 'HEALTHY' | 'AT_RISK' | 'CRITICAL';
  openAlertCount: number;
}

const MAX_SOFTWARE_ROWS = 5_000;

/**
 * Round a date down to the start of its UTC hour. The app-activity
 * upsert key uses this so two consecutive snapshots within the same
 * hour merge into one row instead of creating per-snapshot duplicates.
 */
function hourFloor(d: Date): Date {
  const out = new Date(d);
  out.setUTCMinutes(0, 0, 0);
  return out;
}
const MAX_PATCH_ROWS = 1_000;

export async function ingestSnapshot(input: SnapshotInput): Promise<SnapshotResult> {
  if (input.uptimeSeconds < 0 || !Number.isFinite(input.uptimeSeconds)) {
    throw new ValidationError('uptimeSeconds must be a non-negative finite number');
  }
  if (input.installedSoftware.length > MAX_SOFTWARE_ROWS) {
    throw new ValidationError(
      `Too many installed-software entries (max ${MAX_SOFTWARE_ROWS})`,
    );
  }
  if (input.missingPatches.length > MAX_PATCH_ROWS) {
    throw new ValidationError(
      `Too many missing-patch entries (max ${MAX_PATCH_ROWS})`,
    );
  }

  const now = new Date();
  const classifiedSoftware = input.installedSoftware.map((s) => {
    const { isRisky, reason } = classifyRiskySoftware(s.name);
    return { ...s, isRisky, reason };
  });
  const riskySoftwareCount = classifiedSoftware.filter((s) => s.isRisky).length;
  const criticalPatchCount = input.missingPatches.filter((p) =>
    severityIsCritical(p.severity),
  ).length;

  const risk = computeDeviceRisk({
    defenderEnabled: input.defenderEnabled ?? null,
    firewallEnabled: input.firewallEnabled ?? null,
    bitlockerEnabled: input.bitlockerEnabled ?? null,
    rebootRequired: input.rebootRequired ?? null,
    pendingRebootSince: input.pendingRebootSince ?? null,
    unsupportedOs: input.unsupportedOs ?? null,
    missingPatchCount: input.missingPatches.length,
    criticalPatchCount,
    riskySoftwareCount,
    // The just-ingested snapshot IS the heartbeat — so the agent is
    // by definition not offline at this instant.
    secondsSinceLastSeen: 0,
    now,
  });

  // The whole ingestion runs in one transaction so a mid-write crash
  // doesn't leave half-ingested inventory + a stale risk score.
  const result = await prisma.$transaction(
    async (tx) => {
      // Snapshot row (history).
      const tamperProcs = input.runningTamperProcesses ?? [];
      const snapshot = await tx.deviceHealthSnapshot.create({
        data: {
          deviceId: input.deviceId,
          powerState: input.powerState,
          uptimeSeconds: input.uptimeSeconds,
          lastBootAt: input.lastBootAt ?? null,
          loggedInUserName: input.loggedInUserName ?? null,
          defenderEnabled: input.defenderEnabled ?? null,
          firewallEnabled: input.firewallEnabled ?? null,
          bitlockerEnabled: input.bitlockerEnabled ?? null,
          rebootRequired: input.rebootRequired ?? null,
          pendingRebootSince: input.pendingRebootSince ?? null,
          unsupportedOs: input.unsupportedOs ?? null,
          riskScore: risk.score,
          riskLevel: risk.level,
          missingPatchCount: input.missingPatches.length,
          criticalPatchCount,
          riskySoftwareCount,
          activeSecondsBucket: Math.max(0, Math.floor(input.activeSecondsBucket ?? 0)),
          idleSecondsBucket: Math.max(0, Math.floor(input.idleSecondsBucket ?? 0)),
          lockedSecondsBucket: Math.max(0, Math.floor(input.lockedSecondsBucket ?? 0)),
          currentSessionStart: input.currentSessionStart ?? null,
          runningProcessCount:
            input.runningProcessCount != null
              ? Math.max(0, Math.floor(input.runningProcessCount))
              : null,
          // ─── Wave 9 — agent resilience signals ──────────────────
          batteryPercent: input.batteryPercent ?? null,
          batteryCharging: input.batteryCharging ?? null,
          batteryHealthPercent: input.batteryHealthPercent ?? null,
          diskFreePercent: input.diskFreePercent ?? null,
          diskFreeGb: input.diskFreeGb ?? null,
          networkType: input.networkType ?? null,
          networkConnectivity: input.networkConnectivity ?? null,
          runningTamperProcesses: tamperProcs.length > 0
            ? (tamperProcs as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
          tamperProcessCount: tamperProcs.length,
          agentVersion: input.agentVersion,
        },
      });

      // 2026-05-29 — Upsert per-app foreground buckets for this
      // snapshot window. Key = (deviceId, bucketStart, appName) so
      // a retry of the same snapshot merges rather than duplicating.
      // We bucket-round the start to the UTC hour boundary so the
      // dashboard "Top apps today" view groups cleanly.
      if (input.appBuckets && input.appBuckets.length > 0 && input.appBucketStart) {
        const bucketStart = hourFloor(input.appBucketStart);
        const bucketEnd = input.appBucketEnd ?? now;
        for (const app of input.appBuckets) {
          const seconds = Math.max(0, Math.floor(app.foregroundSeconds));
          if (seconds === 0) continue;
          const appName = (app.appName ?? '').toLowerCase().slice(0, 255);
          if (!appName) continue;
          await tx.deviceAppActivity.upsert({
            where: {
              deviceId_bucketStart_appName: {
                deviceId: input.deviceId,
                bucketStart,
                appName,
              },
            },
            create: {
              deviceId: input.deviceId,
              bucketStart,
              bucketEnd,
              appName,
              appDisplayName: app.appDisplayName ?? null,
              lastWindowTitle: app.lastWindowTitle?.slice(0, 512) ?? null,
              category: app.category,
              categoryReason: app.categoryReason ?? null,
              foregroundSeconds: seconds,
            },
            update: {
              // Same-bucket retry: increment the seconds, refresh the
              // window title + display name + category if changed.
              foregroundSeconds: { increment: seconds },
              appDisplayName: app.appDisplayName ?? null,
              lastWindowTitle: app.lastWindowTitle?.slice(0, 512) ?? null,
              category: app.category,
              categoryReason: app.categoryReason ?? null,
              bucketEnd,
            },
          });
        }
      }

      // Denormalised "current" rollup on the device row.
      await tx.device.update({
        where: { id: input.deviceId },
        data: {
          lastSeenAt: now,
          currentPowerState: input.powerState,
          currentRiskScore: risk.score,
          currentRiskLevel: risk.level,
          agentVersion: input.agentVersion,
          lastHeartbeatIp: input.ip ?? null,
        },
      });

      // ─── Pulse productivity score outbox (Wave 2) ──────────────────
      // Emit PRESENCE + DEEP_WORK + DEVICE_HYGIENE events for the
      // device owner, if any. Skipped for orphan devices (no owner =
      // no one to credit). Per-snapshot granularity; the
      // scoreRecomputeWorker (wave 5) rolls multiple snapshots up to
      // per-day aggregates before handing them to the scorers.
      await emitPulseProductivityEvents(tx, {
        deviceId: input.deviceId,
        snapshotId: snapshot.id,
        now,
        bucketStart: input.appBucketStart ?? null,
        bucketEnd: input.appBucketEnd ?? null,
        activeSecondsBucket: input.activeSecondsBucket ?? 0,
        idleSecondsBucket: input.idleSecondsBucket ?? 0,
        lockedSecondsBucket: input.lockedSecondsBucket ?? 0,
        currentSessionStart: input.currentSessionStart ?? null,
        appBuckets: input.appBuckets ?? [],
        defenderEnabled: input.defenderEnabled ?? null,
        firewallEnabled: input.firewallEnabled ?? null,
        bitlockerEnabled: input.bitlockerEnabled ?? null,
        rebootRequired: input.rebootRequired ?? null,
        pendingRebootSince: input.pendingRebootSince ?? null,
        unsupportedOs: input.unsupportedOs ?? null,
        criticalPatchCount,
        missingPatchCount: input.missingPatches.length,
        riskySoftwareCount,
      });

      // Installed software — upsert each, then prune rows the snapshot
      // didn't mention (apps the user uninstalled).
      const softwareKeys = new Set<string>();
      for (const s of classifiedSoftware) {
        const version = s.version ?? '';
        softwareKeys.add(`${s.name}::${version}`);
        await tx.deviceInstalledSoftware.upsert({
          where: {
            deviceId_name_version: {
              deviceId: input.deviceId,
              name: s.name,
              version,
            },
          },
          create: {
            deviceId: input.deviceId,
            name: s.name,
            version,
            publisher: s.publisher ?? null,
            installDate: s.installDate ?? null,
            isRisky: s.isRisky,
            riskReason: s.reason,
            firstSeenAt: now,
            lastSeenAt: now,
          },
          update: {
            publisher: s.publisher ?? null,
            installDate: s.installDate ?? null,
            isRisky: s.isRisky,
            riskReason: s.reason,
            lastSeenAt: now,
          },
        });
      }
      // Prune software not present in this snapshot.
      const allSoftware = await tx.deviceInstalledSoftware.findMany({
        where: { deviceId: input.deviceId },
        select: { id: true, name: true, version: true },
      });
      const removedIds = allSoftware
        .filter((row) => !softwareKeys.has(`${row.name}::${row.version ?? ''}`))
        .map((row) => row.id);
      if (removedIds.length > 0) {
        await tx.deviceInstalledSoftware.deleteMany({
          where: { id: { in: removedIds } },
        });
      }

      // Missing patches — upsert + prune in the same shape.
      const patchKeys = new Set<string>();
      for (const p of input.missingPatches) {
        patchKeys.add(p.patchId);
        await tx.deviceMissingPatch.upsert({
          where: {
            deviceId_patchId: { deviceId: input.deviceId, patchId: p.patchId },
          },
          create: {
            deviceId: input.deviceId,
            patchId: p.patchId,
            title: p.title ?? null,
            classification: p.classification ?? null,
            severity: p.severity ?? null,
            releasedAt: p.releasedAt ?? null,
            firstSeenAt: now,
            lastSeenAt: now,
          },
          update: {
            title: p.title ?? null,
            classification: p.classification ?? null,
            severity: p.severity ?? null,
            releasedAt: p.releasedAt ?? null,
            lastSeenAt: now,
          },
        });
      }
      const allPatches = await tx.deviceMissingPatch.findMany({
        where: { deviceId: input.deviceId },
        select: { id: true, patchId: true },
      });
      const removedPatchIds = allPatches
        .filter((row) => !patchKeys.has(row.patchId))
        .map((row) => row.id);
      if (removedPatchIds.length > 0) {
        await tx.deviceMissingPatch.deleteMany({
          where: { id: { in: removedPatchIds } },
        });
      }

      // Reconcile risk alerts. Open new ones for active penalties, auto-
      // resolve any open alerts whose triggers are no longer firing.
      const openAlertCount = await reconcileAlerts(
        tx,
        input.deviceId,
        risk.penalties,
      );

      // 2026-05-29 — Activity-derived alerts. Tamper-tool foreground
      // time fires TAMPER_TOOL_DETECTED at WARNING. Entertainment time
      // exceeding the work-hour threshold fires EXCESSIVE_DISTRACTION
      // at INFO (we don't want to scream — it's a signal, not a crime).
      const tamperSeconds = (input.appBuckets ?? [])
        .filter((a) => a.category === 'TAMPER')
        .reduce((s, a) => s + Math.max(0, a.foregroundSeconds), 0);
      const entertainmentSeconds = (input.appBuckets ?? [])
        .filter((a) => a.category === 'ENTERTAINMENT')
        .reduce((s, a) => s + Math.max(0, a.foregroundSeconds), 0);

      const activityAlertCount = await reconcileActivityAlerts(tx, input.deviceId, {
        tamperSeconds,
        entertainmentSeconds,
        // "Excessive" = >30 min in a single hour-bucket. Aggressive
        // enough to catch real distraction, lenient enough not to fire
        // on a quick lunch-time YouTube break.
        entertainmentThresholdSeconds: 30 * 60,
        tamperReason: (input.appBuckets ?? [])
          .filter((a) => a.category === 'TAMPER')
          .map((a) => a.categoryReason ?? a.appName)
          .filter((v): v is string => Boolean(v))[0] ?? null,
      });

      return { snapshotId: snapshot.id, openAlertCount: openAlertCount + activityAlertCount };
    },
    { timeout: 30_000 },
  );

  return {
    snapshotId: result.snapshotId,
    riskScore: risk.score,
    riskLevel: risk.level,
    openAlertCount: result.openAlertCount,
  };
}

type TxClient = Prisma.TransactionClient;

// Penalty kind → (alert type, severity). Keep in sync with the risk
// rubric in deviceRisk.service.ts.
const PENALTY_TO_ALERT: Record<
  string,
  { type: DeviceAlertType; severity: DeviceAlertSeverity }
> = {
  AGENT_OFFLINE: {
    type: DeviceAlertType.AGENT_OFFLINE,
    severity: DeviceAlertSeverity.WARNING,
  },
  ANTIVIRUS_DISABLED: {
    type: DeviceAlertType.ANTIVIRUS_DISABLED,
    severity: DeviceAlertSeverity.CRITICAL,
  },
  FIREWALL_DISABLED: {
    type: DeviceAlertType.FIREWALL_DISABLED,
    severity: DeviceAlertSeverity.WARNING,
  },
  BITLOCKER_DISABLED: {
    type: DeviceAlertType.BITLOCKER_DISABLED,
    severity: DeviceAlertSeverity.WARNING,
  },
  UNSUPPORTED_OS: {
    type: DeviceAlertType.UNSUPPORTED_OS,
    severity: DeviceAlertSeverity.WARNING,
  },
  REBOOT_REQUIRED: {
    type: DeviceAlertType.REBOOT_REQUIRED_OVERDUE,
    severity: DeviceAlertSeverity.INFO,
  },
  MISSING_CRITICAL_PATCHES: {
    type: DeviceAlertType.MISSING_CRITICAL_PATCHES,
    severity: DeviceAlertSeverity.WARNING,
  },
  RISKY_SOFTWARE_INSTALLED: {
    type: DeviceAlertType.RISKY_SOFTWARE_INSTALLED,
    severity: DeviceAlertSeverity.WARNING,
  },
};

async function reconcileAlerts(
  tx: TxClient,
  deviceId: string,
  penalties: RiskPenalty[],
): Promise<number> {
  const activeByType = new Map<DeviceAlertType, RiskPenalty>();
  for (const p of penalties) {
    const mapped = PENALTY_TO_ALERT[p.kind];
    if (mapped) activeByType.set(mapped.type, p);
  }

  const openAlerts = await tx.deviceRiskAlert.findMany({
    where: { deviceId, resolvedAt: null },
  });
  const openByType = new Map<DeviceAlertType, (typeof openAlerts)[number]>();
  for (const a of openAlerts) openByType.set(a.type, a);

  // Resolve alerts no longer active.
  const toResolveIds: string[] = [];
  for (const [type, alert] of openByType) {
    if (!activeByType.has(type)) toResolveIds.push(alert.id);
  }
  if (toResolveIds.length > 0) {
    await tx.deviceRiskAlert.updateMany({
      where: { id: { in: toResolveIds } },
      data: {
        resolvedAt: new Date(),
        resolutionNote: 'Auto-resolved: condition no longer firing',
      },
    });
  }

  // Open or refresh alerts for active penalties.
  for (const [type, penalty] of activeByType) {
    const mapped = PENALTY_TO_ALERT[penalty.kind]!;
    const existing = openByType.get(type);
    if (existing) {
      // Refresh the message (penalty may have escalated, e.g. reboot
      // age crossing the 30-day threshold).
      if (existing.message !== penalty.message) {
        await tx.deviceRiskAlert.update({
          where: { id: existing.id },
          data: { message: penalty.message, severity: mapped.severity },
        });
      }
    } else {
      await tx.deviceRiskAlert.create({
        data: {
          deviceId,
          type,
          severity: mapped.severity,
          message: penalty.message,
        },
      });
    }
  }

  return activeByType.size;
}

// ─── Activity-derived alerts (2026-05-29) ────────────────────────────
//
// Two new alert types fed by app activity rather than the risk scorer:
//
//   TAMPER_TOOL_DETECTED   — any tamper-tool (mouse jiggler / Caffeine)
//                            had foreground time in the snapshot window
//   EXCESSIVE_DISTRACTION  — entertainment apps held foreground for
//                            more than the threshold seconds in the
//                            snapshot window
//
// Both follow the same auto-resolve pattern as risk alerts: condition
// no longer firing → next snapshot closes the alert.

interface ActivityAlertInputs {
  tamperSeconds: number;
  entertainmentSeconds: number;
  entertainmentThresholdSeconds: number;
  tamperReason: string | null;
}

async function reconcileActivityAlerts(
  tx: TxClient,
  deviceId: string,
  input: ActivityAlertInputs,
): Promise<number> {
  const activeByType = new Map<DeviceAlertType, { severity: DeviceAlertSeverity; message: string }>();

  if (input.tamperSeconds > 0) {
    activeByType.set(DeviceAlertType.TAMPER_TOOL_DETECTED, {
      severity: DeviceAlertSeverity.WARNING,
      message: input.tamperReason
        ? `Tamper tool detected: ${input.tamperReason} (${Math.round(input.tamperSeconds / 60)} min)`
        : `Tamper tool detected (${Math.round(input.tamperSeconds / 60)} min)`,
    });
  }
  if (input.entertainmentSeconds > input.entertainmentThresholdSeconds) {
    activeByType.set(DeviceAlertType.EXCESSIVE_DISTRACTION, {
      severity: DeviceAlertSeverity.INFO,
      message: `Excessive entertainment use: ${Math.round(input.entertainmentSeconds / 60)} min of streaming/gaming in last bucket`,
    });
  }

  const ACTIVITY_TYPES = [
    DeviceAlertType.TAMPER_TOOL_DETECTED,
    DeviceAlertType.EXCESSIVE_DISTRACTION,
  ];
  const openAlerts = await tx.deviceRiskAlert.findMany({
    where: { deviceId, type: { in: ACTIVITY_TYPES }, resolvedAt: null },
  });
  const openByType = new Map<DeviceAlertType, (typeof openAlerts)[number]>();
  for (const a of openAlerts) openByType.set(a.type, a);

  // Resolve any not active this snapshot.
  const toResolveIds: string[] = [];
  for (const [type, alert] of openByType) {
    if (!activeByType.has(type)) toResolveIds.push(alert.id);
  }
  if (toResolveIds.length > 0) {
    await tx.deviceRiskAlert.updateMany({
      where: { id: { in: toResolveIds } },
      data: {
        resolvedAt: new Date(),
        resolutionNote: 'Auto-resolved: activity signal no longer firing',
      },
    });
  }

  // Open / refresh active ones.
  for (const [type, payload] of activeByType) {
    const existing = openByType.get(type);
    if (existing) {
      if (existing.message !== payload.message) {
        await tx.deviceRiskAlert.update({
          where: { id: existing.id },
          data: { message: payload.message, severity: payload.severity },
        });
      }
    } else {
      await tx.deviceRiskAlert.create({
        data: {
          deviceId,
          type,
          severity: payload.severity,
          message: payload.message,
        },
      });
    }
  }

  return activeByType.size;
}

// ─── Pulse productivity score outbox emitter (Wave 2) ─────────────────
//
// Inside the ingestSnapshot transaction, derive per-snapshot
// productivity events for PRESENCE + DEEP_WORK + DEVICE_HYGIENE and
// emit them via the outbox. The events cover a single snapshot window
// (≈60 min of agent activity); the scoreRecomputeWorker rolls these
// up into per-day aggregates before handing them to the scorers.
//
// Skipped for orphan devices (no owner = no one to credit).

interface PulseEmitInput {
  deviceId: string;
  snapshotId: string;
  now: Date;
  bucketStart: Date | null;
  bucketEnd: Date | null;
  activeSecondsBucket: number;
  idleSecondsBucket: number;
  lockedSecondsBucket: number;
  currentSessionStart: Date | null;
  appBuckets: NonNullable<SnapshotInput['appBuckets']>;
  defenderEnabled: boolean | null;
  firewallEnabled: boolean | null;
  bitlockerEnabled: boolean | null;
  rebootRequired: boolean | null;
  pendingRebootSince: Date | null;
  unsupportedOs: boolean | null;
  criticalPatchCount: number;
  missingPatchCount: number;
  riskySoftwareCount: number;
}

const FOCUS_BLOCK_MIN_SECONDS = 25 * 60;

async function emitPulseProductivityEvents(
  tx: Prisma.TransactionClient,
  inp: PulseEmitInput,
): Promise<void> {
  // Look up the device owner inside the same tx. Skip orphan devices.
  const device = await tx.device.findUnique({
    where: { id: inp.deviceId },
    select: { ownerUserId: true },
  });
  const userId = device?.ownerUserId;
  if (!userId) return;

  // Date string for per-day bucketing on the worker side. UTC for v1
  // (per-user-TZ rebucket is a wave-5 enhancement once user.timezone
  // is wired up).
  const date = toDateOnlyString(inp.now);

  // Aggregate appBuckets for DEEP_WORK + tamper detection.
  let productiveSeconds = 0;
  let distractionSeconds = 0;
  let tamperSeconds = 0;
  let focusBlocks = 0;
  const distinctApps = new Set<string>();
  for (const b of inp.appBuckets) {
    const sec = Math.max(0, Math.floor(b.foregroundSeconds));
    if (sec === 0) continue;
    distinctApps.add((b.appName ?? '').toLowerCase());
    switch (b.category) {
      case 'PRODUCTIVE':
        productiveSeconds += sec;
        if (sec >= FOCUS_BLOCK_MIN_SECONDS) focusBlocks += 1;
        break;
      case 'ENTERTAINMENT':
      case 'PERSONAL':
        distractionSeconds += sec;
        break;
      case 'TAMPER':
        tamperSeconds += sec;
        break;
      // COMMUNICATION / UNKNOWN don't fall into productive or
      // distraction; they pass through neutrally for DEEP_WORK.
    }
  }
  const hasTamper = tamperSeconds > 0;

  // Login-session start hour (0-23) — input for PRESENCE consistency
  // bonus. Use the agent's `currentSessionStart`; null when the agent
  // can't probe it (Session 0, edge case).
  const loginSessionStartHour =
    inp.currentSessionStart instanceof Date
      ? inp.currentSessionStart.getUTCHours()
      : null;

  // Device-hygiene snapshot values. `*EnabledRatio` is 1 or 0 per
  // snapshot; the scorer will average across the window's events.
  // `agentOfflineHours` is 0 here (the just-arrived snapshot proves
  // the agent is online); the worker computes gap-based offline time.
  const rebootPendingDays =
    inp.pendingRebootSince instanceof Date
      ? Math.floor(
          (inp.now.getTime() - inp.pendingRebootSince.getTime()) / (24 * 60 * 60 * 1000),
        )
      : 0;
  const importantPatchCount = Math.max(0, inp.missingPatchCount - inp.criticalPatchCount);

  await emitProductivityEvents(tx, [
    {
      userId,
      signal: 'PRESENCE',
      eventType: 'pulse.daily_presence',
      occurredAt: inp.now,
      rawPayload: {
        date,
        activeSeconds: Math.max(0, Math.floor(inp.activeSecondsBucket)),
        idleSeconds: Math.max(0, Math.floor(inp.idleSecondsBucket)),
        lockedSeconds: Math.max(0, Math.floor(inp.lockedSecondsBucket)),
        hasTamper,
        loginSessionStartHour,
        snapshotId: inp.snapshotId,
      },
      source: 'device_snapshots',
      sourceId: `${inp.snapshotId}::presence`,
    },
    {
      userId,
      signal: 'DEEP_WORK',
      eventType: 'pulse.daily_focus',
      occurredAt: inp.now,
      rawPayload: {
        date,
        productiveSeconds,
        activeSeconds: Math.max(0, Math.floor(inp.activeSecondsBucket)),
        focusBlocks,
        contextSwitches: distinctApps.size, // proxy: # distinct foreground apps
        distractionBurstMinutes: Math.floor(distractionSeconds / 60),
        tamperMinutes: Math.floor(tamperSeconds / 60),
        // Wave 8: denser focus signal. `productiveRatio` is the share
        // of active time spent on productive-category apps (0..1).
        // Useful when an employee's focus is short bursts (lots of
        // tiny PRs / quick code reviews) and never accumulates into a
        // ≥25-min same-app block but is still real work. The scorer
        // uses it as a fallback when discrete focus blocks are 0.
        productiveRatio:
          inp.activeSecondsBucket > 0
            ? Math.min(1, productiveSeconds / inp.activeSecondsBucket)
            : 0,
        // Wave 8: tamper as a ratio so a 30-min meeting with one
        // legitimate keep-awake spike doesn't trash the same window
        // as a 6-hour mouse-jiggler. The scorer subtracts proportionally.
        tamperRatio:
          inp.activeSecondsBucket > 0
            ? Math.min(1, tamperSeconds / inp.activeSecondsBucket)
            : 0,
        snapshotId: inp.snapshotId,
      },
      source: 'device_snapshots',
      sourceId: `${inp.snapshotId}::deep_work`,
    },
    {
      userId,
      signal: 'DEVICE_HYGIENE',
      eventType: 'pulse.daily_hygiene',
      occurredAt: inp.now,
      rawPayload: {
        date,
        defenderEnabledRatio: inp.defenderEnabled === false ? 0 : 1,
        firewallEnabledRatio: inp.firewallEnabled === false ? 0 : 1,
        bitlockerEnabled: inp.bitlockerEnabled ?? null,
        rebootPendingDays,
        unsupportedOs: inp.unsupportedOs ?? false,
        criticalPatchCount: inp.criticalPatchCount,
        importantPatchCount,
        riskySoftwareCount: inp.riskySoftwareCount,
        agentOfflineHours: 0,
        snapshotId: inp.snapshotId,
      },
      source: 'device_snapshots',
      sourceId: `${inp.snapshotId}::hygiene`,
    },
  ]);
}
