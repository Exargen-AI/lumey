// Pulse module — wire DTOs (2026-05-28).
//
// Shared between backend handlers + frontend admin Pulse page + Windows
// agent (the agent type-checks against this same package so request/
// response shapes can't drift). Dates serialize as ISO strings over the
// wire — backend transforms Prisma Date → string at the handler edge.

import type {
  DeviceAlertSeverity,
  DeviceAlertType,
  DeviceEnrollmentStatus,
  DevicePlatform,
  DevicePowerState,
  DeviceRiskLevel,
} from '../enums.js';

// ─── Agent-side wire types (POST bodies the Windows agent sends) ───

export interface DeviceEnrollRequest {
  // Bootstrap token issued by a SUPER_ADMIN. Single-use.
  enrollmentToken: string;
  // Stable hardware fingerprint (machine UUID + primary MAC + OS install
  // id, hashed client-side). Used to recognise re-enrollment of the same
  // physical device.
  fingerprint: string;
  hostname: string;
  platform: DevicePlatform;
  osVersion?: string;
  osBuild?: string;
  arch?: string;
  agentVersion: string;
}

export interface DeviceEnrollResponse {
  deviceId: string;
  // Cleartext API key. The server only stores the hash — this is the
  // ONE chance for the agent to capture it.
  apiKey: string;
  // Echo of assigned owner (if the token was pre-bound).
  ownerUserId: string | null;
  serverTime: string; // ISO; agent uses to detect clock skew.
}

export interface DeviceHeartbeatRequest {
  powerState: DevicePowerState;
  uptimeSeconds: number;
  agentVersion: string;
}

export interface DeviceHeartbeatResponse {
  ok: true;
  // Server may tell the agent to back off — used if rate limits start
  // biting. Agent honours this on the next loop.
  nextHeartbeatInSeconds: number;
}

export interface DeviceSnapshotInstalledSoftware {
  name: string;
  version?: string;
  publisher?: string;
  installDate?: string; // ISO
}

export interface DeviceSnapshotMissingPatch {
  patchId: string;
  title?: string;
  classification?: string;
  severity?: string;
  releasedAt?: string; // ISO
}

export interface DeviceSnapshotRequest {
  // Full snapshot — replaces software + patch inventories, writes a new
  // health-snapshot row, runs the risk scorer.
  powerState: DevicePowerState;
  uptimeSeconds: number;
  lastBootAt?: string; // ISO
  loggedInUserName?: string;
  defenderEnabled?: boolean;
  firewallEnabled?: boolean;
  bitlockerEnabled?: boolean;
  rebootRequired?: boolean;
  pendingRebootSince?: string; // ISO
  unsupportedOs?: boolean;
  installedSoftware: DeviceSnapshotInstalledSoftware[];
  missingPatches: DeviceSnapshotMissingPatch[];
  // 2026-05-28b — Productivity rollup. Seconds spent in each
  // power state since the previous snapshot, accumulated agent-
  // side via a 30-second tick. Backend sums these across snapshots
  // to render the "today's active / locked / idle" admin view.
  activeSecondsBucket?: number;
  idleSecondsBucket?: number;
  lockedSecondsBucket?: number;
  // 2026-05-29 — When the user actually logged in to Windows.
  currentSessionStart?: string;
  // 2026-05-29 — Total process count snapshot.
  runningProcessCount?: number;
  // 2026-05-29 — Per-app foreground time for this window. Backend
  // upserts into device_app_activity keyed by (deviceId,
  // appBucketStart, appName).
  appBucketStart?: string;
  appBucketEnd?: string;
  appBuckets?: SnapshotAppBucket[];
  agentVersion: string;
}

export type AppCategory =
  | 'PRODUCTIVE'
  | 'COMMUNICATION'
  | 'ENTERTAINMENT'
  | 'PERSONAL'
  | 'UNKNOWN'
  | 'TAMPER';

export interface SnapshotAppBucket {
  appName: string;
  appDisplayName?: string;
  lastWindowTitle?: string;
  foregroundSeconds: number;
  category: AppCategory;
  categoryReason?: string;
}

export interface DeviceSnapshotResponse {
  ok: true;
  riskScore: number;
  riskLevel: DeviceRiskLevel;
  openAlertCount: number;
}

// ─── Admin-side read DTOs (SUPER_ADMIN dashboard) ───

export interface PulseOverview {
  totalDevices: number;
  byRiskLevel: {
    healthy: number;
    atRisk: number;
    critical: number;
  };
  byStatus: {
    active: number;
    pendingEnrollment: number;
    revoked: number;
    inactive: number;
  };
  agentsOffline: number;
  missingPatchesTotal: number;
  rebootRequiredCount: number;
  antivirusDisabledCount: number;
  firewallDisabledCount: number;
  bitlockerDisabledCount: number;
  unsupportedOsCount: number;
  riskySoftwareDeviceCount: number;
  openAlertsBySeverity: {
    info: number;
    warning: number;
    critical: number;
  };
  // 2026-05-28c — Team-wide productivity rollup for today (UTC day).
  // Aggregated across ALL devices currently in ACTIVE status.
  teamActiveSecondsToday: number;
  teamIdleSecondsToday: number;
  teamLockedSecondsToday: number;
  // How many devices contributed any productivity bucket today (i.e.
  // sent at least one snapshot since UTC midnight).
  reportingDevicesToday: number;
  lastUpdatedAt: string; // ISO; "now"
}

export interface PulseDeviceSummary {
  id: string;
  hostname: string;
  platform: DevicePlatform;
  osVersion: string | null;
  status: DeviceEnrollmentStatus;
  owner: {
    id: string;
    name: string;
    email: string;
  } | null;
  agentVersion: string | null;
  lastSeenAt: string | null;
  currentRiskScore: number | null;
  currentRiskLevel: DeviceRiskLevel | null;
  currentPowerState: DevicePowerState | null;
  openAlertCount: number;
  missingPatchCount: number;
  riskySoftwareCount: number;
  // 2026-05-28c — Today's productivity rollup. Sum across today's
  // health snapshots (UTC day). Null when the device hasn't reported
  // any snapshot today yet.
  todayActiveSeconds: number;
  todayIdleSeconds: number;
  todayLockedSeconds: number;
}

export interface PulseDeviceDetail extends PulseDeviceSummary {
  fingerprint: string;
  osBuild: string | null;
  arch: string | null;
  apiKeyPrefix: string;
  revokedAt: string | null;
  revokedReason: string | null;
  createdAt: string;
  updatedAt: string;
  // Latest snapshot inline so the device-detail page has everything in
  // one round-trip.
  latestSnapshot: PulseHealthSnapshot | null;
  installedSoftware: PulseInstalledSoftware[];
  missingPatches: PulseMissingPatch[];
  openAlerts: PulseRiskAlert[];
}

export interface PulseHealthSnapshot {
  id: string;
  capturedAt: string;
  powerState: DevicePowerState;
  uptimeSeconds: number;
  lastBootAt: string | null;
  defenderEnabled: boolean | null;
  firewallEnabled: boolean | null;
  bitlockerEnabled: boolean | null;
  rebootRequired: boolean | null;
  pendingRebootSince: string | null;
  unsupportedOs: boolean | null;
  riskScore: number;
  riskLevel: DeviceRiskLevel;
  missingPatchCount: number;
  criticalPatchCount: number;
  riskySoftwareCount: number;
  // 2026-05-31 — device-health + session signals surfaced to the
  // SUPER_ADMIN device drawer. All collected by the agent and stored
  // on device_health_snapshots; previously dropped by the read API.
  // Every field is nullable because (a) older agents predate the
  // Wave 9 collectors, and (b) some are hardware-dependent (a desktop
  // has no battery).
  loggedInUserName?: string | null;
  currentSessionStart?: string | null;
  runningProcessCount?: number | null;
  batteryPercent?: number | null;
  batteryCharging?: boolean | null;
  batteryHealthPercent?: number | null;
  diskFreePercent?: number | null;
  diskFreeGb?: number | null;
  networkType?: string | null;
  networkConnectivity?: string | null;
  tamperProcessCount?: number;
  runningTamperProcesses?: { name: string; pid?: number }[];
}

export interface PulseInstalledSoftware {
  id: string;
  name: string;
  version: string | null;
  publisher: string | null;
  installDate: string | null;
  isRisky: boolean;
  riskReason: string | null;
  lastSeenAt: string;
}

export interface PulseMissingPatch {
  id: string;
  patchId: string;
  title: string | null;
  classification: string | null;
  severity: string | null;
  releasedAt: string | null;
  firstSeenAt: string;
}

export interface PulseRiskAlert {
  id: string;
  deviceId: string;
  type: DeviceAlertType;
  severity: DeviceAlertSeverity;
  message: string;
  openedAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  resolvedBy: {
    id: string;
    name: string;
  } | null;
}

export interface PulseAlertsResponse {
  alerts: (PulseRiskAlert & {
    device: {
      id: string;
      hostname: string;
      ownerName: string | null;
    };
  })[];
}

// ─── SUPER_ADMIN bootstrap: enrollment-token APIs ───

export interface CreateEnrollmentTokenRequest {
  assignedUserId?: string;
  note?: string;
  // Optional override; defaults to 7 days. Min 1h, max 30d (enforced
  // server-side).
  expiresInHours?: number;
}

export interface CreateEnrollmentTokenResponse {
  id: string;
  // Returned ONCE; the server stores this verbatim (single-use, short-
  // lived) so the SUPER_ADMIN can hand it to the employee.
  token: string;
  assignedUserId: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface EnrollmentTokenSummary {
  id: string;
  // Last 4 chars of the token, for identification without revealing it.
  tokenSuffix: string;
  assignedUser: { id: string; name: string; email: string } | null;
  issuedBy: { id: string; name: string };
  expiresAt: string;
  consumedAt: string | null;
  consumedByDeviceId: string | null;
  note: string | null;
  createdAt: string;
}

// ─── Clock in / Clock out (2026-05-28b) ───

export interface ClockSessionDTO {
  id: string;
  userId: string;
  clockedInAt: string;
  clockedOutAt: string | null;
  autoClosedAt: string | null;
  noteIn: string | null;
  noteOut: string | null;
}

export interface ClockStatusResponse {
  // Currently-open session (null when the user is clocked out).
  openSession: ClockSessionDTO | null;
  // All of today's sessions (open + closed), in clockedInAt asc.
  todaySessions: ClockSessionDTO[];
  // Total seconds clocked in today (sum of closed + currently-open).
  totalSecondsToday: number;
}

export interface ClockInRequest {
  note?: string;
}

export interface ClockOutRequest {
  note?: string;
}

export interface TeamClockEntry {
  user: { id: string; name: string; email: string };
  openSession: ClockSessionDTO | null;
  totalSecondsToday: number;
  sessionCountToday: number;
}

// ─── Per-employee admin views (2026-05-29) ───────────────────────────

export type EmployeePresence = 'ONLINE' | 'AWAY' | 'LOCKED' | 'OFFLINE';

export interface PulseEmployeeSummary {
  user: { id: string; name: string; email: string; role: string };
  presence: EmployeePresence;
  // Whichever of the user's devices last reported.
  lastSeenAt: string | null;
  // Aggregated across ALL devices owned by this user.
  todayActiveSeconds: number;
  todayIdleSeconds: number;
  todayLockedSeconds: number;
  // Productive minutes today across all devices.
  todayProductiveSeconds: number;
  todayEntertainmentSeconds: number;
  todayPersonalSeconds: number;
  todayCommunicationSeconds: number;
  todayUnknownSeconds: number;
  todayTamperSeconds: number;
  // 2026-05-29 — Productivity score (pure function of the above).
  // See backend/src/services/pulseEmployeeScore.service.ts for the rubric.
  productivityScore: number; // 0-100
  productivityBand: 'HIGH' | 'MEDIUM' | 'LOW';
  productivitySummary: string;
  // What is on the foreground right now (latest device).
  currentApp: {
    appName: string;
    appDisplayName: string | null;
    windowTitle: string | null;
    category: AppCategory;
    asOf: string;
  } | null;
  // Top 3 apps by foreground time today.
  topApps: PulseEmployeeAppSummary[];
  // Current session login time + device.
  currentSessionStart: string | null;
  // Cross-reference back to the underlying devices.
  deviceCount: number;
  worstRiskLevel: 'HEALTHY' | 'AT_RISK' | 'CRITICAL' | null;
  openAlertCount: number;
}

export interface PulseEmployeeAppSummary {
  appName: string;
  appDisplayName: string | null;
  category: AppCategory;
  categoryReason: string | null;
  foregroundSeconds: number;
  lastWindowTitle: string | null;
}

export interface PulseEmployeeDetail extends PulseEmployeeSummary {
  // All devices owned by this employee, with summary inline.
  devices: PulseDeviceSummary[];
  // Full app breakdown today, sorted by foreground time desc.
  allAppsToday: PulseEmployeeAppSummary[];
  // 7-day per-day breakdown of productive / entertainment / personal time.
  weekHistory: {
    date: string;
    activeSeconds: number;
    productiveSeconds: number;
    entertainmentSeconds: number;
    personalSeconds: number;
    communicationSeconds: number;
    unknownSeconds: number;
    tamperSeconds: number;
  }[];
  // Itemised score breakdown — explains "why is this person a 42?".
  productivityBreakdown: {
    kind:
      | 'PRODUCTIVE_SHARE'
      | 'COMMUNICATION_CREDIT'
      | 'ENTERTAINMENT_PENALTY'
      | 'PERSONAL_PENALTY'
      | 'TAMPER_PENALTY'
      | 'NO_ACTIVITY';
    delta: number;
    message: string;
  }[];
  productivityScoringVersion: number;
}

// ─── Device productivity rollup ───

export interface PulseDailyUsage {
  date: string; // YYYY-MM-DD (UTC)
  activeSeconds: number;
  idleSeconds: number;
  lockedSeconds: number;
  // Seconds for which the agent did not report (uptime gap)
  offSeconds: number;
  // Sum of bucket inputs that contributed to this row.
  snapshotCount: number;
}

export interface PulseProductivityResponse {
  deviceId: string;
  days: PulseDailyUsage[];
}
