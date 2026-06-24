-- Pulse Wave 9 — agent resilience signals.
--
-- Adds:
--   • Device.lastCpuPercent / lastMemoryMb / agentErrorCount /
--     agentLastErrorAt / agentLastErrorMessage (per-heartbeat self-health)
--   • DeviceHealthSnapshot.batteryPercent / batteryCharging /
--     batteryHealthPercent (laptop power state)
--   • DeviceHealthSnapshot.diskFreePercent / diskFreeGb (OS volume)
--   • DeviceHealthSnapshot.networkType / networkConnectivity (wifi vs
--     ethernet vs VPN vs unknown — useful for explaining "this user's
--     heartbeat lag is 4h, they're on a flight")
--   • DeviceHealthSnapshot.runningTamperProcesses (background tamper
--     enumeration — distinct from foreground TAMPER bucket)
--   • DeviceHealthSnapshot.tamperProcessCount (denormalised count for
--     cheap list queries)
--
-- All columns are nullable / default-zero so pre-Wave-9 agents still
-- post a valid snapshot and pre-Wave-9 rows still query correctly.

ALTER TABLE "devices"
  ADD COLUMN "lastCpuPercent"        DOUBLE PRECISION,
  ADD COLUMN "lastMemoryMb"          DOUBLE PRECISION,
  ADD COLUMN "agentErrorCount"       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "agentLastErrorAt"      TIMESTAMP(3),
  ADD COLUMN "agentLastErrorMessage" TEXT;

ALTER TABLE "device_health_snapshots"
  ADD COLUMN "batteryPercent"         INTEGER,
  ADD COLUMN "batteryCharging"        BOOLEAN,
  ADD COLUMN "batteryHealthPercent"   INTEGER,
  ADD COLUMN "diskFreePercent"        INTEGER,
  ADD COLUMN "diskFreeGb"             DOUBLE PRECISION,
  ADD COLUMN "networkType"            TEXT,
  ADD COLUMN "networkConnectivity"    TEXT,
  ADD COLUMN "runningTamperProcesses" JSONB,
  ADD COLUMN "tamperProcessCount"     INTEGER NOT NULL DEFAULT 0;

-- Index for the "show me unhealthy laptops" admin view.
CREATE INDEX "device_health_snapshots_batteryPercent_idx"
  ON "device_health_snapshots" ("batteryPercent");
CREATE INDEX "device_health_snapshots_diskFreePercent_idx"
  ON "device_health_snapshots" ("diskFreePercent");
CREATE INDEX "device_health_snapshots_tamperProcessCount_idx"
  ON "device_health_snapshots" ("tamperProcessCount");
