-- Pulse — Employee Productivity Tracker + Device Health (2026-05-28).
--
-- SUPER_ADMIN-only telemetry surface. Six tables + six enums. The Windows
-- agent (headless background service on employee laptops) authenticates
-- with a per-device API key and POSTs heartbeats + periodic full snapshots
-- to backend endpoints. The agent NEVER writes the DB directly — all
-- traffic flows through the backend, which validates the API-key hash
-- before any handler runs.
--
-- Tables:
--   • devices                       — registered employee laptop, owns
--                                     the per-device API key hash.
--   • device_enrollment_tokens      — short-lived single-use bootstrap
--                                     token issued by a SUPER_ADMIN and
--                                     exchanged by the agent at first
--                                     boot for its long-lived API key.
--   • device_health_snapshots       — one row per ~60-min full snapshot;
--                                     drives the historical dashboard
--                                     trend lines.
--   • device_installed_software     — per-device app inventory, refreshed
--                                     each full snapshot. Risk flag set
--                                     at ingestion time.
--   • device_missing_patches        — outstanding Windows Update KBs.
--   • device_risk_alerts            — open/resolved risk findings.
--
-- Enums:
--   DevicePlatform, DeviceEnrollmentStatus, DevicePowerState,
--   DeviceRiskLevel, DeviceAlertType, DeviceAlertSeverity.
--
-- Cascade strategy:
--   • Device → snapshots / software / patches / alerts: CASCADE.
--     Deleting a device drops the telemetry; that's intentional — the
--     same hardware re-enrolls as a new device row.
--   • User → device.ownerUserId / revokedByUserId: SET NULL.
--     Owner may leave the company; telemetry record is preserved so the
--     device can be reassigned.
--   • User → device_enrollment_tokens.assignedUserId: SET NULL.
--   • User → device_enrollment_tokens.issuedByUserId: NO ACTION (issuer
--     must remain for audit; we restrict delete via the user.service
--     guard that already protects SUPER_ADMINs).
--   • Device → device_enrollment_tokens.consumedByDeviceId: SET NULL.
--   • User → device_risk_alerts.resolvedByUserId: SET NULL.

-- ─── Enums ────────────────────────────────────────────────────────────

CREATE TYPE "DevicePlatform" AS ENUM ('WINDOWS', 'MACOS', 'LINUX');

CREATE TYPE "DeviceEnrollmentStatus" AS ENUM (
  'PENDING_ENROLLMENT',
  'ACTIVE',
  'REVOKED',
  'INACTIVE'
);

CREATE TYPE "DevicePowerState" AS ENUM ('ON', 'IDLE', 'LOCKED', 'OFF');

CREATE TYPE "DeviceRiskLevel" AS ENUM ('HEALTHY', 'AT_RISK', 'CRITICAL');

CREATE TYPE "DeviceAlertType" AS ENUM (
  'AGENT_OFFLINE',
  'MISSING_CRITICAL_PATCHES',
  'REBOOT_REQUIRED_OVERDUE',
  'ANTIVIRUS_DISABLED',
  'FIREWALL_DISABLED',
  'BITLOCKER_DISABLED',
  'UNSUPPORTED_OS',
  'RISKY_SOFTWARE_INSTALLED',
  'HIGH_RISK_SCORE'
);

CREATE TYPE "DeviceAlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- ─── devices ──────────────────────────────────────────────────────────

CREATE TABLE "devices" (
  "id"                 TEXT NOT NULL,
  "fingerprint"        TEXT NOT NULL,
  "hostname"           TEXT NOT NULL,
  "platform"           "DevicePlatform" NOT NULL,
  "osVersion"          TEXT,
  "osBuild"            TEXT,
  "arch"               TEXT,
  "ownerUserId"        TEXT,
  "apiKeyHash"         TEXT NOT NULL,
  "apiKeyPrefix"       TEXT NOT NULL,
  "status"             "DeviceEnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "revokedAt"          TIMESTAMP(3),
  "revokedByUserId"    TEXT,
  "revokedReason"      TEXT,
  "agentVersion"       TEXT,
  "lastSeenAt"         TIMESTAMP(3),
  "lastHeartbeatIp"    TEXT,
  "currentRiskScore"   INTEGER,
  "currentRiskLevel"   "DeviceRiskLevel",
  "currentPowerState"  "DevicePowerState",
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "devices_fingerprint_key"  ON "devices"("fingerprint");
CREATE UNIQUE INDEX "devices_apiKeyHash_key"   ON "devices"("apiKeyHash");
CREATE INDEX "devices_ownerUserId_idx"         ON "devices"("ownerUserId");
CREATE INDEX "devices_status_idx"              ON "devices"("status");
CREATE INDEX "devices_currentRiskLevel_idx"    ON "devices"("currentRiskLevel");
CREATE INDEX "devices_lastSeenAt_idx"          ON "devices"("lastSeenAt");

ALTER TABLE "devices"
  ADD CONSTRAINT "devices_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "devices"
  ADD CONSTRAINT "devices_revokedByUserId_fkey"
    FOREIGN KEY ("revokedByUserId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── device_enrollment_tokens ─────────────────────────────────────────

CREATE TABLE "device_enrollment_tokens" (
  "id"                  TEXT NOT NULL,
  "token"               TEXT NOT NULL,
  "assignedUserId"      TEXT,
  "issuedByUserId"      TEXT NOT NULL,
  "expiresAt"           TIMESTAMP(3) NOT NULL,
  "consumedAt"          TIMESTAMP(3),
  "consumedByDeviceId"  TEXT,
  "note"                TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "device_enrollment_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "device_enrollment_tokens_token_key"
  ON "device_enrollment_tokens"("token");
CREATE UNIQUE INDEX "device_enrollment_tokens_consumedByDeviceId_key"
  ON "device_enrollment_tokens"("consumedByDeviceId");
CREATE INDEX "device_enrollment_tokens_assignedUserId_idx"
  ON "device_enrollment_tokens"("assignedUserId");
CREATE INDEX "device_enrollment_tokens_issuedByUserId_idx"
  ON "device_enrollment_tokens"("issuedByUserId");
CREATE INDEX "device_enrollment_tokens_expiresAt_idx"
  ON "device_enrollment_tokens"("expiresAt");

ALTER TABLE "device_enrollment_tokens"
  ADD CONSTRAINT "device_enrollment_tokens_assignedUserId_fkey"
    FOREIGN KEY ("assignedUserId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "device_enrollment_tokens"
  ADD CONSTRAINT "device_enrollment_tokens_issuedByUserId_fkey"
    FOREIGN KEY ("issuedByUserId") REFERENCES "users"("id")
    ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "device_enrollment_tokens"
  ADD CONSTRAINT "device_enrollment_tokens_consumedByDeviceId_fkey"
    FOREIGN KEY ("consumedByDeviceId") REFERENCES "devices"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── device_health_snapshots ──────────────────────────────────────────

CREATE TABLE "device_health_snapshots" (
  "id"                  TEXT NOT NULL,
  "deviceId"            TEXT NOT NULL,
  "capturedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "powerState"          "DevicePowerState" NOT NULL,
  "uptimeSeconds"       INTEGER NOT NULL DEFAULT 0,
  "lastBootAt"          TIMESTAMP(3),
  "loggedInUserName"    TEXT,
  "defenderEnabled"     BOOLEAN,
  "firewallEnabled"     BOOLEAN,
  "bitlockerEnabled"    BOOLEAN,
  "rebootRequired"      BOOLEAN,
  "pendingRebootSince"  TIMESTAMP(3),
  "unsupportedOs"       BOOLEAN,
  "riskScore"           INTEGER NOT NULL,
  "riskLevel"           "DeviceRiskLevel" NOT NULL,
  "missingPatchCount"   INTEGER NOT NULL DEFAULT 0,
  "criticalPatchCount"  INTEGER NOT NULL DEFAULT 0,
  "riskySoftwareCount"  INTEGER NOT NULL DEFAULT 0,
  "agentVersion"        TEXT,
  CONSTRAINT "device_health_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "device_health_snapshots_deviceId_capturedAt_idx"
  ON "device_health_snapshots"("deviceId", "capturedAt");
CREATE INDEX "device_health_snapshots_capturedAt_idx"
  ON "device_health_snapshots"("capturedAt");
CREATE INDEX "device_health_snapshots_riskLevel_idx"
  ON "device_health_snapshots"("riskLevel");

ALTER TABLE "device_health_snapshots"
  ADD CONSTRAINT "device_health_snapshots_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "devices"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── device_installed_software ────────────────────────────────────────

CREATE TABLE "device_installed_software" (
  "id"           TEXT NOT NULL,
  "deviceId"     TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "version"      TEXT,
  "publisher"    TEXT,
  "installDate"  TIMESTAMP(3),
  "isRisky"      BOOLEAN NOT NULL DEFAULT false,
  "riskReason"   TEXT,
  "firstSeenAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "device_installed_software_pkey" PRIMARY KEY ("id")
);

-- Upsert key. NULLs in version are treated as a distinct row by Postgres
-- (since NULL != NULL); the service layer normalizes missing version to
-- the empty string before write to keep the dedup contract.
CREATE UNIQUE INDEX "device_installed_software_deviceId_name_version_key"
  ON "device_installed_software"("deviceId", "name", "version");
CREATE INDEX "device_installed_software_deviceId_idx"
  ON "device_installed_software"("deviceId");
CREATE INDEX "device_installed_software_isRisky_idx"
  ON "device_installed_software"("isRisky");

ALTER TABLE "device_installed_software"
  ADD CONSTRAINT "device_installed_software_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "devices"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── device_missing_patches ───────────────────────────────────────────

CREATE TABLE "device_missing_patches" (
  "id"              TEXT NOT NULL,
  "deviceId"        TEXT NOT NULL,
  "patchId"         TEXT NOT NULL,
  "title"           TEXT,
  "classification"  TEXT,
  "severity"        TEXT,
  "releasedAt"      TIMESTAMP(3),
  "firstSeenAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "device_missing_patches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "device_missing_patches_deviceId_patchId_key"
  ON "device_missing_patches"("deviceId", "patchId");
CREATE INDEX "device_missing_patches_deviceId_idx"
  ON "device_missing_patches"("deviceId");
CREATE INDEX "device_missing_patches_severity_idx"
  ON "device_missing_patches"("severity");

ALTER TABLE "device_missing_patches"
  ADD CONSTRAINT "device_missing_patches_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "devices"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── device_risk_alerts ───────────────────────────────────────────────

CREATE TABLE "device_risk_alerts" (
  "id"                TEXT NOT NULL,
  "deviceId"          TEXT NOT NULL,
  "type"              "DeviceAlertType" NOT NULL,
  "severity"          "DeviceAlertSeverity" NOT NULL,
  "message"           TEXT NOT NULL,
  "openedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt"        TIMESTAMP(3),
  "resolvedByUserId"  TEXT,
  "resolutionNote"    TEXT,
  CONSTRAINT "device_risk_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "device_risk_alerts_deviceId_idx"
  ON "device_risk_alerts"("deviceId");
CREATE INDEX "device_risk_alerts_type_idx"
  ON "device_risk_alerts"("type");
CREATE INDEX "device_risk_alerts_severity_idx"
  ON "device_risk_alerts"("severity");
CREATE INDEX "device_risk_alerts_resolvedAt_idx"
  ON "device_risk_alerts"("resolvedAt");
-- Composite supports the hot "find open alert by (device, type)" query
-- the risk-scorer runs on every snapshot.
CREATE INDEX "device_risk_alerts_deviceId_type_resolvedAt_idx"
  ON "device_risk_alerts"("deviceId", "type", "resolvedAt");

ALTER TABLE "device_risk_alerts"
  ADD CONSTRAINT "device_risk_alerts_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "devices"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "device_risk_alerts"
  ADD CONSTRAINT "device_risk_alerts_resolvedByUserId_fkey"
    FOREIGN KEY ("resolvedByUserId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Productivity time-bucket columns on health_snapshots ─────────────
--
-- The Windows agent tracks time spent in each powerState since the
-- previous snapshot and reports it on the next /devices/me/snapshot
-- call. We sum across snapshots to draw "today's active / locked /
-- idle" charts on the admin dashboard. Default 0 so older snapshots
-- (none yet — same migration) silently degrade to "unknown".

ALTER TABLE "device_health_snapshots"
  ADD COLUMN "activeSecondsBucket" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "idleSecondsBucket"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lockedSecondsBucket" INTEGER NOT NULL DEFAULT 0;

-- ─── clock_sessions ───────────────────────────────────────────────────
--
-- Employee-self clock-in / clock-out. One row per session;
-- clockedOutAt is null while open. The service layer refuses a second
-- clockIn while one is open. Auto-close sweep flips autoClosedAt on
-- sessions older than 12h so "I forgot to clock out" cases don't
-- inflate the user's hours.
--
-- CASCADE on user delete: clock history lives with the user.

CREATE TABLE "clock_sessions" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "clockedInAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "clockedOutAt" TIMESTAMP(3),
  "autoClosedAt" TIMESTAMP(3),
  "noteIn"       TEXT,
  "noteOut"      TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "clock_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "clock_sessions_userId_clockedInAt_idx"
  ON "clock_sessions"("userId", "clockedInAt");
-- Hot path: "is there an open session for this user?" — used on every
-- clock-in to refuse double-clocks.
CREATE INDEX "clock_sessions_userId_clockedOutAt_idx"
  ON "clock_sessions"("userId", "clockedOutAt");

ALTER TABLE "clock_sessions"
  ADD CONSTRAINT "clock_sessions_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
