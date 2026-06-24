/**
 * Pulse — admin read service tests (2026-05-28).
 *
 * The route layer gates with `requireRoles('SUPER_ADMIN')`. This service
 * adds a defence-in-depth check (`assertSuperAdmin`) so an accidentally-
 * unprotected route still hits a 403. These tests pin that boundary —
 * the privilege check has to refuse ANY role other than SUPER_ADMIN,
 * AND that refusal must happen BEFORE any DB read.
 */

import './../test/prismaMock';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import { ForbiddenError } from '../utils/errors';
import {
  getPulseOverview,
  listDevices,
  getDeviceDetail,
  listAlerts,
  resolveAlert,
} from './devicePulse.service';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('assertSuperAdmin — getPulseOverview', () => {
  it.each(['ADMIN', 'PRODUCT_MANAGER', 'ENGINEER', 'CLIENT', undefined])(
    'refuses %s (defence in depth — route layer should already block)',
    async (role) => {
      await expect(getPulseOverview(role)).rejects.toBeInstanceOf(ForbiddenError);
      // CRITICAL: refusal must happen BEFORE any DB call.
      expect(prismaMock.device.count).not.toHaveBeenCalled();
    },
  );

  it('accepts SUPER_ADMIN', async () => {
    prismaMock.device.count.mockResolvedValue(0);
    prismaMock.deviceMissingPatch.count.mockResolvedValue(0);
    prismaMock.deviceHealthSnapshot.findMany.mockResolvedValue([] as any);
    (prismaMock.deviceRiskAlert.groupBy as any).mockResolvedValue([]);
    (prismaMock.deviceHealthSnapshot.groupBy as any).mockResolvedValue([]);
    prismaMock.deviceInstalledSoftware.findMany.mockResolvedValue([] as any);

    const result = await getPulseOverview('SUPER_ADMIN');
    expect(result.totalDevices).toBe(0);
    expect(result.openAlertsBySeverity).toEqual({ info: 0, warning: 0, critical: 0 });
    expect(result.teamActiveSecondsToday).toBe(0);
    expect(result.reportingDevicesToday).toBe(0);
  });
});

describe('assertSuperAdmin — listDevices', () => {
  it('refuses non-SUPER_ADMIN', async () => {
    await expect(listDevices('ADMIN')).rejects.toBeInstanceOf(ForbiddenError);
    expect(prismaMock.device.findMany).not.toHaveBeenCalled();
  });
});

describe('assertSuperAdmin — getDeviceDetail', () => {
  it('refuses non-SUPER_ADMIN', async () => {
    await expect(getDeviceDetail('CLIENT', 'device-1')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(prismaMock.device.findUnique).not.toHaveBeenCalled();
  });
});

// 2026-05-31 — device-health visibility regression guard.
//
// The agent collects battery / disk / network / session / process-
// count / tamper signals and ingestSnapshot persists them to
// device_health_snapshots, but getDeviceDetail used to drop them on
// the read path — so the SUPER_ADMIN dashboard could never display
// them. This test pins that the latestSnapshot returned by the read
// service includes every one of those fields, so a future refactor
// can't silently re-introduce the "collected but not visible" gap.
describe('getDeviceDetail — surfaces device-health + session fields', () => {
  it('includes battery / disk / network / session / process / tamper fields in latestSnapshot', async () => {
    const capturedAt = new Date('2026-05-30T10:00:00Z');
    const sessionStart = new Date('2026-05-30T09:00:00Z');
    prismaMock.device.findUnique.mockResolvedValue({
      id: 'device-1',
      hostname: 'LAPTOP-1',
      platform: 'WINDOWS',
      osVersion: 'Windows 11',
      osBuild: '22631',
      arch: 'x64',
      fingerprint: 'fp-1',
      apiKeyPrefix: 'pk_abc',
      status: 'ACTIVE',
      revokedAt: null,
      revokedReason: null,
      owner: { id: 'u-1', name: 'Pat', email: 'pat@example.com' },
      agentVersion: '0.1.0',
      lastSeenAt: capturedAt,
      currentRiskScore: 10,
      currentRiskLevel: 'HEALTHY',
      currentPowerState: 'ON',
      createdAt: capturedAt,
      updatedAt: capturedAt,
      snapshots: [
        {
          id: 'snap-1',
          capturedAt,
          powerState: 'ON',
          uptimeSeconds: 3600,
          lastBootAt: capturedAt,
          defenderEnabled: true,
          firewallEnabled: true,
          bitlockerEnabled: true,
          rebootRequired: false,
          pendingRebootSince: null,
          unsupportedOs: false,
          riskScore: 10,
          riskLevel: 'HEALTHY',
          missingPatchCount: 0,
          criticalPatchCount: 0,
          riskySoftwareCount: 0,
          // The fields that were previously dropped:
          loggedInUserName: 'pat',
          currentSessionStart: sessionStart,
          runningProcessCount: 287,
          batteryPercent: 82,
          batteryCharging: true,
          batteryHealthPercent: 91,
          diskFreePercent: 44,
          diskFreeGb: 210.5,
          networkType: 'WIFI',
          networkConnectivity: 'INTERNET',
          tamperProcessCount: 1,
          runningTamperProcesses: [{ name: 'caffeine.exe', pid: 4242 }],
        },
      ],
      installedSoftware: [],
      missingPatches: [],
      riskAlerts: [],
    } as any);

    const detail = await getDeviceDetail('SUPER_ADMIN', 'device-1');
    const s = detail.latestSnapshot!;

    expect(s.loggedInUserName).toBe('pat');
    expect(s.currentSessionStart).toBe(sessionStart.toISOString());
    expect(s.runningProcessCount).toBe(287);
    expect(s.batteryPercent).toBe(82);
    expect(s.batteryCharging).toBe(true);
    expect(s.batteryHealthPercent).toBe(91);
    expect(s.diskFreePercent).toBe(44);
    expect(s.diskFreeGb).toBe(210.5);
    expect(s.networkType).toBe('WIFI');
    expect(s.networkConnectivity).toBe('INTERNET');
    expect(s.tamperProcessCount).toBe(1);
    expect(s.runningTamperProcesses).toEqual([{ name: 'caffeine.exe', pid: 4242 }]);
  });

  it('coerces a null runningTamperProcesses JSON column to an empty array', async () => {
    const capturedAt = new Date('2026-05-30T10:00:00Z');
    prismaMock.device.findUnique.mockResolvedValue({
      id: 'device-2',
      hostname: 'DESKTOP-1',
      platform: 'WINDOWS',
      osVersion: 'Windows 11',
      osBuild: null, arch: null, fingerprint: 'fp-2', apiKeyPrefix: 'pk_xyz',
      status: 'ACTIVE', revokedAt: null, revokedReason: null,
      owner: null, agentVersion: '0.1.0', lastSeenAt: capturedAt,
      currentRiskScore: 0, currentRiskLevel: 'HEALTHY', currentPowerState: 'ON',
      createdAt: capturedAt, updatedAt: capturedAt,
      snapshots: [
        {
          id: 'snap-2', capturedAt, powerState: 'ON', uptimeSeconds: 100,
          lastBootAt: null, defenderEnabled: true, firewallEnabled: true,
          bitlockerEnabled: null, rebootRequired: false, pendingRebootSince: null,
          unsupportedOs: false, riskScore: 0, riskLevel: 'HEALTHY',
          missingPatchCount: 0, criticalPatchCount: 0, riskySoftwareCount: 0,
          // Desktop without battery; collectors returned null; tamper JSON null.
          loggedInUserName: null, currentSessionStart: null, runningProcessCount: null,
          batteryPercent: null, batteryCharging: null, batteryHealthPercent: null,
          diskFreePercent: null, diskFreeGb: null, networkType: null,
          networkConnectivity: null, tamperProcessCount: 0,
          runningTamperProcesses: null,
        },
      ],
      installedSoftware: [], missingPatches: [], riskAlerts: [],
    } as any);

    const detail = await getDeviceDetail('SUPER_ADMIN', 'device-2');
    expect(detail.latestSnapshot!.runningTamperProcesses).toEqual([]);
    expect(detail.latestSnapshot!.batteryPercent).toBeNull();
  });
});

describe('assertSuperAdmin — listAlerts', () => {
  it('refuses non-SUPER_ADMIN', async () => {
    await expect(listAlerts(undefined)).rejects.toBeInstanceOf(ForbiddenError);
    expect(prismaMock.deviceRiskAlert.findMany).not.toHaveBeenCalled();
  });
});

describe('assertSuperAdmin — resolveAlert', () => {
  it('refuses non-SUPER_ADMIN', async () => {
    await expect(resolveAlert('ENGINEER', 'user-1', 'alert-1')).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(prismaMock.deviceRiskAlert.findUnique).not.toHaveBeenCalled();
  });
});

describe('getPulseOverview — aggregation correctness', () => {
  beforeEach(() => {
    prismaMock.device.count.mockResolvedValue(0);
    prismaMock.deviceMissingPatch.count.mockResolvedValue(0);
    (prismaMock.deviceRiskAlert.groupBy as any).mockResolvedValue([]);
    (prismaMock.deviceHealthSnapshot.groupBy as any).mockResolvedValue([]);
    prismaMock.deviceInstalledSoftware.findMany.mockResolvedValue([] as any);
  });

  it('reduces multi-snapshot stream to latest-per-device when counting flags', async () => {
    // device-1 has TWO snapshots; latest wins.
    prismaMock.deviceHealthSnapshot.findMany.mockResolvedValue([
      {
        deviceId: 'device-1',
        capturedAt: new Date('2026-05-28T12:00:00Z'),
        rebootRequired: true,
        defenderEnabled: false,
        firewallEnabled: true,
        bitlockerEnabled: true,
        unsupportedOs: false,
      },
      {
        deviceId: 'device-1',
        capturedAt: new Date('2026-05-27T12:00:00Z'),
        rebootRequired: false, // earlier, should be ignored
        defenderEnabled: true,
        firewallEnabled: true,
        bitlockerEnabled: true,
        unsupportedOs: false,
      },
    ] as any);

    const result = await getPulseOverview('SUPER_ADMIN');
    expect(result.rebootRequiredCount).toBe(1);
    expect(result.antivirusDisabledCount).toBe(1);
  });

  it('correctly maps alerts-by-severity groupBy result', async () => {
    (prismaMock.deviceRiskAlert.groupBy as any).mockResolvedValue([
      { severity: 'CRITICAL', _count: { _all: 3 } },
      { severity: 'WARNING', _count: { _all: 5 } },
    ]);
    prismaMock.deviceHealthSnapshot.findMany.mockResolvedValue([] as any);

    const result = await getPulseOverview('SUPER_ADMIN');
    expect(result.openAlertsBySeverity.critical).toBe(3);
    expect(result.openAlertsBySeverity.warning).toBe(5);
    expect(result.openAlertsBySeverity.info).toBe(0);
  });

  it('sums team productivity buckets across reporting devices', async () => {
    prismaMock.deviceHealthSnapshot.findMany.mockResolvedValue([] as any);
    (prismaMock.deviceHealthSnapshot.groupBy as any).mockResolvedValue([
      {
        deviceId: 'device-a',
        _sum: {
          activeSecondsBucket: 3600,
          idleSecondsBucket: 600,
          lockedSecondsBucket: 300,
        },
      },
      {
        deviceId: 'device-b',
        _sum: {
          activeSecondsBucket: 7200,
          idleSecondsBucket: 0,
          lockedSecondsBucket: 1200,
        },
      },
    ]);

    const result = await getPulseOverview('SUPER_ADMIN');
    expect(result.teamActiveSecondsToday).toBe(10_800);
    expect(result.teamIdleSecondsToday).toBe(600);
    expect(result.teamLockedSecondsToday).toBe(1500);
    expect(result.reportingDevicesToday).toBe(2);
  });
});
