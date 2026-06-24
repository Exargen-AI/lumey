/**
 * Pulse handlers (2026-05-28).
 *
 * Two surfaces:
 *   • Agent endpoints (POST enroll / heartbeat / snapshot) — gated by
 *     deviceAuthenticate; req.device is set, req.user is NOT.
 *   • Admin endpoints — gated by authenticate + requireRoles('SUPER_ADMIN');
 *     req.user is set, req.device is NOT.
 *
 * Each handler is a thin pass-through to a service. Validators run via
 * the `validate()` middleware so handlers can trust req.body shape.
 */

import type { Request, Response, NextFunction } from 'express';
import * as deviceService from '../services/device.service';
import * as telemetryService from '../services/deviceTelemetry.service';
import * as pulseService from '../services/devicePulse.service';
import * as employeesService from '../services/pulseEmployees.service';

// ─── Agent-side: enroll ───────────────────────────────────────────────

export async function enrollDeviceHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as {
      enrollmentToken: string;
      fingerprint: string;
      hostname: string;
      platform: 'WINDOWS' | 'MACOS' | 'LINUX';
      osVersion?: string;
      osBuild?: string;
      arch?: string;
      agentVersion: string;
    };
    const result = await deviceService.enrollDevice({
      ...body,
      ip: req.ip ?? null,
    });
    res.status(201).json({
      success: true,
      data: {
        deviceId: result.deviceId,
        apiKey: result.apiKey,
        ownerUserId: result.ownerUserId,
        serverTime: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
}

// ─── Agent-side: heartbeat ────────────────────────────────────────────

export async function heartbeatHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as {
      powerState: 'ON' | 'IDLE' | 'LOCKED' | 'OFF';
      uptimeSeconds: number;
      agentVersion: string;
      // Wave 9 — agent self-health (optional).
      cpuPercent?: number;
      memoryMb?: number;
      errorCount?: number;
      lastErrorAt?: string;
      lastErrorMessage?: string | null;
    };
    const device = req.device!;
    const result = await telemetryService.ingestHeartbeat({
      deviceId: device.id,
      powerState: body.powerState,
      uptimeSeconds: body.uptimeSeconds,
      agentVersion: body.agentVersion,
      ip: req.ip ?? null,
      cpuPercent: body.cpuPercent ?? null,
      memoryMb: body.memoryMb ?? null,
      errorCount: body.errorCount ?? null,
      lastErrorAt: body.lastErrorAt ? new Date(body.lastErrorAt) : null,
      lastErrorMessage: body.lastErrorMessage ?? null,
      // Wave 9 — kill switch. If the device is in REVOKED/INACTIVE
      // status, tell the agent to shut down via the response.
      isRevoked: device.status !== 'ACTIVE',
    });
    // 2026-05-30 — echo back `serverTime` so the agent can detect a
    // skewed local clock without an NTP dependency. Agent compares
    // this to its own Date.now() right after parsing the response
    // and warns + records into selfHealth when the skew is > 5 min.
    // Older agents that don't read this field ignore it harmlessly.
    res.status(200).json({
      success: true,
      data: { ...result, serverTime: new Date().toISOString() },
    });
  } catch (err) {
    next(err);
  }
}

// ─── Agent-side: snapshot ─────────────────────────────────────────────

export async function snapshotHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as {
      powerState: 'ON' | 'IDLE' | 'LOCKED' | 'OFF';
      uptimeSeconds: number;
      lastBootAt?: string;
      loggedInUserName?: string;
      defenderEnabled?: boolean;
      firewallEnabled?: boolean;
      bitlockerEnabled?: boolean;
      rebootRequired?: boolean;
      pendingRebootSince?: string;
      unsupportedOs?: boolean;
      installedSoftware: { name: string; version?: string; publisher?: string; installDate?: string }[];
      missingPatches: { patchId: string; title?: string; classification?: string; severity?: string; releasedAt?: string }[];
      activeSecondsBucket?: number;
      idleSecondsBucket?: number;
      lockedSecondsBucket?: number;
      currentSessionStart?: string;
      runningProcessCount?: number;
      appBucketStart?: string;
      appBucketEnd?: string;
      appBuckets?: {
        appName: string;
        appDisplayName?: string;
        lastWindowTitle?: string;
        foregroundSeconds: number;
        category: 'PRODUCTIVE' | 'COMMUNICATION' | 'ENTERTAINMENT' | 'PERSONAL' | 'UNKNOWN' | 'TAMPER';
        categoryReason?: string;
      }[];
      // Wave 9 — agent resilience signals (optional).
      runningTamperProcesses?: { name: string; pid?: number }[];
      batteryPercent?: number;
      batteryCharging?: boolean;
      batteryHealthPercent?: number;
      diskFreePercent?: number;
      diskFreeGb?: number;
      networkType?: 'ETHERNET' | 'WIFI' | 'CELLULAR' | 'VPN' | 'UNKNOWN';
      networkConnectivity?: 'INTERNET' | 'LOCAL_ONLY' | 'NO_TRAFFIC' | 'UNKNOWN';
      agentVersion: string;
    };
    const result = await telemetryService.ingestSnapshot({
      deviceId: req.device!.id,
      powerState: body.powerState,
      uptimeSeconds: body.uptimeSeconds,
      lastBootAt: body.lastBootAt ? new Date(body.lastBootAt) : null,
      loggedInUserName: body.loggedInUserName,
      defenderEnabled: body.defenderEnabled ?? null,
      firewallEnabled: body.firewallEnabled ?? null,
      bitlockerEnabled: body.bitlockerEnabled ?? null,
      rebootRequired: body.rebootRequired ?? null,
      pendingRebootSince: body.pendingRebootSince ? new Date(body.pendingRebootSince) : null,
      unsupportedOs: body.unsupportedOs ?? null,
      installedSoftware: body.installedSoftware.map((s) => ({
        ...s,
        installDate: s.installDate ? new Date(s.installDate) : null,
      })),
      missingPatches: body.missingPatches.map((p) => ({
        ...p,
        releasedAt: p.releasedAt ? new Date(p.releasedAt) : null,
      })),
      activeSecondsBucket: body.activeSecondsBucket,
      idleSecondsBucket: body.idleSecondsBucket,
      lockedSecondsBucket: body.lockedSecondsBucket,
      currentSessionStart: body.currentSessionStart ? new Date(body.currentSessionStart) : null,
      runningProcessCount: body.runningProcessCount ?? null,
      appBucketStart: body.appBucketStart ? new Date(body.appBucketStart) : null,
      appBucketEnd: body.appBucketEnd ? new Date(body.appBucketEnd) : null,
      appBuckets: body.appBuckets,
      // Wave 9 — agent resilience signals.
      runningTamperProcesses: body.runningTamperProcesses,
      batteryPercent: body.batteryPercent ?? null,
      batteryCharging: body.batteryCharging ?? null,
      batteryHealthPercent: body.batteryHealthPercent ?? null,
      diskFreePercent: body.diskFreePercent ?? null,
      diskFreeGb: body.diskFreeGb ?? null,
      networkType: body.networkType ?? null,
      networkConnectivity: body.networkConnectivity ?? null,
      agentVersion: body.agentVersion,
      ip: req.ip ?? null,
    });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

// ─── Admin: overview ──────────────────────────────────────────────────

export async function overviewHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await pulseService.getPulseOverview(req.user!.role);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// ─── Admin: list devices ──────────────────────────────────────────────

export async function listDevicesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as {
      riskLevel?: 'HEALTHY' | 'AT_RISK' | 'CRITICAL';
      status?: 'PENDING_ENROLLMENT' | 'ACTIVE' | 'REVOKED' | 'INACTIVE';
      search?: string;
    };
    const data = await pulseService.listDevices(req.user!.role, {
      riskLevel: q.riskLevel,
      status: q.status,
      search: q.search,
    });
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// ─── Admin: device detail ─────────────────────────────────────────────

export async function getDeviceHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await pulseService.getDeviceDetail(req.user!.role, req.params.id);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getDeviceProductivityHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const days = req.query.days ? Number(req.query.days) : 7;
    const data = await pulseService.getDeviceProductivity(req.user!.role, req.params.id, days);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// ─── Admin: revoke device ─────────────────────────────────────────────

export async function revokeDeviceHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as { reason?: string };
    const data = await deviceService.revokeDevice(req.params.id, req.user!.id, body.reason);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// ─── Admin: reassign device owner ─────────────────────────────────────

export async function reassignDeviceHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as { ownerUserId: string | null };
    const data = await deviceService.reassignDeviceOwner(
      req.params.id,
      body.ownerUserId,
      req.user!.id,
    );
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// ─── Admin: per-employee activity views (2026-05-29) ────────────────

export async function listEmployeesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await employeesService.listEmployees(req.user!.role);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function getEmployeeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await employeesService.getEmployeeDetail(req.user!.role, req.params.id);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// 2026-05-29 — Self-service today summary. Any authenticated user can
// read their OWN today rollup (active hours, productive hours, current
// standup / clock state). Used by the TodayPage vibe card.
export async function getMyTodaySummaryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await employeesService.getMyTodaySummary(req.user!.id);
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

// ─── Admin: enrollment tokens ─────────────────────────────────────────

export async function createEnrollmentTokenHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as {
      assignedUserId?: string;
      note?: string;
      expiresInHours?: number;
    };
    const data = await deviceService.createEnrollmentToken({
      issuedByUserId: req.user!.id,
      assignedUserId: body.assignedUserId ?? null,
      note: body.note,
      expiresInHours: body.expiresInHours,
    });
    res.status(201).json({
      success: true,
      data: {
        id: data.id,
        token: data.token, // returned ONCE — shown to the SUPER_ADMIN
        assignedUserId: data.assignedUserId,
        expiresAt: data.expiresAt.toISOString(),
        createdAt: data.createdAt.toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function listEnrollmentTokensHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await deviceService.listEnrollmentTokens({
      includeConsumed: req.query.includeConsumed === 'true',
      includeExpired: req.query.includeExpired === 'true',
    });
    res.status(200).json({
      success: true,
      data: data.map((t) => ({
        id: t.id,
        tokenSuffix: t.tokenLast4,
        assignedUser: t.assignedUser,
        issuedBy: t.issuedBy,
        expiresAt: t.expiresAt.toISOString(),
        consumedAt: t.consumedAt ? t.consumedAt.toISOString() : null,
        consumedByDeviceId: t.consumedByDeviceId,
        note: t.note,
        createdAt: t.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    next(err);
  }
}

export async function revokeEnrollmentTokenHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const data = await deviceService.revokeEnrollmentToken(req.params.id, req.user!.id);
    res.status(200).json({ success: true, data: { id: data.id, expiresAt: data.expiresAt.toISOString() } });
  } catch (err) {
    next(err);
  }
}

// ─── Admin: alerts ────────────────────────────────────────────────────

export async function listAlertsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const q = req.query as {
      severity?: 'INFO' | 'WARNING' | 'CRITICAL';
      includeResolved?: boolean;
      limit?: number;
    };
    const data = await pulseService.listAlerts(req.user!.role, {
      severity: q.severity,
      includeResolved: q.includeResolved,
      limit: q.limit,
    });
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

export async function resolveAlertHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const body = req.body as { resolutionNote?: string };
    const data = await pulseService.resolveAlert(
      req.user!.role,
      req.user!.id,
      req.params.id,
      body.resolutionNote,
    );
    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
}
