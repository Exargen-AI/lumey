-- Pulse — Per-employee activity tracking + anti-tamper (2026-05-29).
--
-- Adds:
--   • device_app_activity table: per-(device, bucket, app) foreground
--     time, with window-title-based category classification.
--   • AppCategory enum: PRODUCTIVE / COMMUNICATION / ENTERTAINMENT /
--     PERSONAL / UNKNOWN / TAMPER.
--   • Three new DeviceAlertType values: HEARTBEAT_GAP_DETECTED,
--     TAMPER_TOOL_DETECTED, EXCESSIVE_DISTRACTION.
--   • Two new fields on device_health_snapshots:
--       currentSessionStart  — when the user actually logged in
--       runningProcessCount  — sanity-check process count from the agent
--
-- CASCADE on device delete (matches existing Pulse tables).

-- ─── Enums ────────────────────────────────────────────────────────────

CREATE TYPE "AppCategory" AS ENUM (
  'PRODUCTIVE',
  'COMMUNICATION',
  'ENTERTAINMENT',
  'PERSONAL',
  'UNKNOWN',
  'TAMPER'
);

ALTER TYPE "DeviceAlertType" ADD VALUE 'HEARTBEAT_GAP_DETECTED';
ALTER TYPE "DeviceAlertType" ADD VALUE 'TAMPER_TOOL_DETECTED';
ALTER TYPE "DeviceAlertType" ADD VALUE 'EXCESSIVE_DISTRACTION';

-- ─── New snapshot fields ──────────────────────────────────────────────

ALTER TABLE "device_health_snapshots"
  ADD COLUMN "currentSessionStart" TIMESTAMP(3),
  ADD COLUMN "runningProcessCount" INTEGER;

-- ─── device_app_activity ──────────────────────────────────────────────

CREATE TABLE "device_app_activity" (
  "id"                TEXT NOT NULL,
  "deviceId"          TEXT NOT NULL,
  "bucketStart"       TIMESTAMP(3) NOT NULL,
  "bucketEnd"         TIMESTAMP(3) NOT NULL,
  "appName"           TEXT NOT NULL,
  "appDisplayName"    TEXT,
  "lastWindowTitle"   TEXT,
  "category"          "AppCategory" NOT NULL DEFAULT 'UNKNOWN',
  "categoryReason"    TEXT,
  "foregroundSeconds" INTEGER NOT NULL DEFAULT 0,
  "capturedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "device_app_activity_pkey" PRIMARY KEY ("id")
);

-- Unique constraint = the upsert key. Retried buckets merge cleanly.
CREATE UNIQUE INDEX "device_app_activity_deviceId_bucketStart_appName_key"
  ON "device_app_activity"("deviceId", "bucketStart", "appName");

CREATE INDEX "device_app_activity_deviceId_bucketStart_idx"
  ON "device_app_activity"("deviceId", "bucketStart");

CREATE INDEX "device_app_activity_category_idx"
  ON "device_app_activity"("category");

CREATE INDEX "device_app_activity_capturedAt_idx"
  ON "device_app_activity"("capturedAt");

ALTER TABLE "device_app_activity"
  ADD CONSTRAINT "device_app_activity_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "devices"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
