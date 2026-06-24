-- Pulse Composite Productivity Score — Foundation (R5)
--
-- Adds the data substrate for the multi-signal monthly productivity
-- score. Universal weights — no role-based scoring (founder R3).
-- Real-time event-sourced via outbox pattern: every emitting service
-- writes a productivity_events row inside the same transaction as its
-- source mutation.
--
-- See docs/pulse/04-productivity-scoring.md for the full design.
--
-- Tables added:
--   productivity_events          — append-only event log (outbox)
--   employee_productivity_scores — computed per (user, window, cadence)
--   universal_weight_sets        — append-only weight-history
--   employee_profiles            — optional self-role + bio + emergency
--                                  weight override (display-only role)
--
-- Enums added:
--   ProductivitySignal  — 7 signals (R5)
--   ProductivityCadence — DAILY / WEEKLY / MONTHLY
--   ScoreBand           — HIGH / MEDIUM / LOW
--   SelfRole            — display-only employee self-identification

-- ────────────────────────────────────────────────────────────────────
-- Enums
-- ────────────────────────────────────────────────────────────────────

CREATE TYPE "ProductivitySignal" AS ENUM (
  'STANDUP',
  'EXECUTION',
  'CODE',
  'COMMUNICATION',
  'PRESENCE',
  'DEEP_WORK',
  'DEVICE_HYGIENE'
);

CREATE TYPE "ProductivityCadence" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

CREATE TYPE "ScoreBand" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

CREATE TYPE "SelfRole" AS ENUM (
  'ENGINEER',
  'PM',
  'DESIGNER',
  'OPS',
  'SALES',
  'FOUNDER',
  'OTHER'
);

-- ────────────────────────────────────────────────────────────────────
-- productivity_events — outbox / append-only event log
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE "productivity_events" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "signal"       "ProductivitySignal" NOT NULL,
  "eventType"    VARCHAR(64) NOT NULL,
  "occurredAt"   TIMESTAMP(3) NOT NULL,
  "recordedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt"  TIMESTAMP(3),
  "rawPayload"   JSONB NOT NULL,
  "scoreDelta"   DECIMAL(6, 2),
  "gamingFlag"   VARCHAR(64),
  "source"       VARCHAR(32) NOT NULL,
  "sourceId"     VARCHAR(128) NOT NULL,

  CONSTRAINT "productivity_events_pkey" PRIMARY KEY ("id")
);

-- De-dupe key: replaying the same source mutation must not produce a
-- duplicate event. Different event types from the same source row are
-- allowed (e.g. 'pr.opened' and 'pr.merged' both keyed to same PR id).
CREATE UNIQUE INDEX "productivity_events_dedupe_key"
  ON "productivity_events"("source", "sourceId", "eventType");

-- Window-aggregate query: "all of user X's events between T1 and T2".
CREATE INDEX "productivity_events_userId_occurredAt_idx"
  ON "productivity_events"("userId", "occurredAt");

-- Worker poller hot path: "give me the oldest unprocessed events".
CREATE INDEX "productivity_events_processedAt_recordedAt_idx"
  ON "productivity_events"("processedAt", "recordedAt");

-- Per-signal aggregate queries.
CREATE INDEX "productivity_events_signal_occurredAt_idx"
  ON "productivity_events"("signal", "occurredAt");

ALTER TABLE "productivity_events"
  ADD CONSTRAINT "productivity_events_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ────────────────────────────────────────────────────────────────────
-- employee_productivity_scores — computed scores per window+cadence
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE "employee_productivity_scores" (
  "id"                     TEXT NOT NULL,
  "userId"                 TEXT NOT NULL,
  "windowStart"            DATE NOT NULL,
  "windowEnd"              DATE NOT NULL,
  "cadence"                "ProductivityCadence" NOT NULL,
  "compositeScore"         DECIMAL(5, 2) NOT NULL,
  "band"                   "ScoreBand" NOT NULL,
  "signalScores"           JSONB NOT NULL,
  "rawBreakdown"           JSONB NOT NULL,
  "flags"                  JSONB NOT NULL,
  "computedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "computedFromEventCount" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "employee_productivity_scores_pkey" PRIMARY KEY ("id"),
  -- DB-level invariant: composite is a 0-100 percentage.
  CONSTRAINT "employee_productivity_scores_composite_range"
    CHECK ("compositeScore" >= 0 AND "compositeScore" <= 100),
  -- DB-level invariant: window end is on or after window start.
  CONSTRAINT "employee_productivity_scores_window_order"
    CHECK ("windowEnd" >= "windowStart")
);

-- One score row per (user, window, cadence). Recompute does UPSERT.
CREATE UNIQUE INDEX "employee_productivity_scores_window_key"
  ON "employee_productivity_scores"("userId", "windowStart", "windowEnd", "cadence");

-- Dashboard hot path: "show me everyone's current-week scores".
CREATE INDEX "employee_productivity_scores_cadence_windowStart_idx"
  ON "employee_productivity_scores"("cadence", "windowStart");

CREATE INDEX "employee_productivity_scores_userId_cadence_idx"
  ON "employee_productivity_scores"("userId", "cadence");

ALTER TABLE "employee_productivity_scores"
  ADD CONSTRAINT "employee_productivity_scores_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ────────────────────────────────────────────────────────────────────
-- universal_weight_sets — append-only weight history
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE "universal_weight_sets" (
  "id"              TEXT NOT NULL,
  "weights"         JSONB NOT NULL,
  "signalBaselines" JSONB NOT NULL,
  "thresholdHigh"   INTEGER NOT NULL DEFAULT 75,
  "thresholdLow"    INTEGER NOT NULL DEFAULT 40,
  "effectiveFrom"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedBy"       TEXT NOT NULL,
  "changeNote"      TEXT,

  CONSTRAINT "universal_weight_sets_pkey" PRIMARY KEY ("id"),
  -- DB-level invariant: thresholds are 0-100.
  CONSTRAINT "universal_weight_sets_threshold_range"
    CHECK ("thresholdHigh" > "thresholdLow"
           AND "thresholdHigh" <= 100
           AND "thresholdLow" >= 0)
);

-- Active set = max(effectiveFrom). Descending index makes that query a
-- single index scan.
CREATE INDEX "universal_weight_sets_effectiveFrom_idx"
  ON "universal_weight_sets"("effectiveFrom" DESC);

ALTER TABLE "universal_weight_sets"
  ADD CONSTRAINT "universal_weight_sets_updatedBy_fkey"
  FOREIGN KEY ("updatedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ────────────────────────────────────────────────────────────────────
-- employee_profiles — self-role (display-only) + emergency overrides
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE "employee_profiles" (
  "userId"                TEXT NOT NULL,
  "selfRole"              "SelfRole",
  "bio"                   TEXT,
  "customWeightOverrides" JSONB,
  "customWeightSetAt"     TIMESTAMP(3),
  "customWeightSetBy"     TEXT,
  "updatedAt"             TIMESTAMP(3) NOT NULL,

  CONSTRAINT "employee_profiles_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "employee_profiles"
  ADD CONSTRAINT "employee_profiles_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
