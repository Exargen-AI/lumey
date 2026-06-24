-- Task subscriptions + nudges (CC feature PR 2026-05-20).
--
-- Two new tables:
--
--   1. task_subscriptions — users follow a task to receive
--      notifications on new comments + significant edits. Auto-
--      populated when a user becomes assignee / reviewer / creator
--      (with a `source` discriminator so a manual unsubscribe is
--      respected — we don't re-add a user who explicitly said "stop
--      following this"). Manual subscribe via POST /tasks/:id/subscribe.
--
--   2. task_nudges — audit + cooldown trail for the "nudge a
--      teammate about this task" feature. The 24h-per-(task,sender)
--      cooldown is enforced by querying the latest nudge row for
--      that pair; the composite index makes the lookup direct.
--
-- Both are pure additions — no backfill, no existing rows mutated.
-- Both cascade-delete with the parent Task / User so they don't
-- orphan after a delete.

-- ── ENUM: TaskSubscriptionSource ─────────────────────────────────
CREATE TYPE "TaskSubscriptionSource" AS ENUM (
  'AUTO_ASSIGNEE',
  'AUTO_REVIEWER',
  'AUTO_CREATOR',
  'AUTO_MENTIONED',
  'MANUAL'
);

-- ── TABLE: task_subscriptions ────────────────────────────────────
CREATE TABLE "task_subscriptions" (
  "id"        TEXT NOT NULL,
  "taskId"    TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "source"    "TaskSubscriptionSource" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_subscriptions_pkey" PRIMARY KEY ("id")
);

-- One subscription per (task, user) — re-subscribe is idempotent at
-- the API layer via prisma upsert.
CREATE UNIQUE INDEX "task_subscriptions_taskId_userId_key"
  ON "task_subscriptions"("taskId", "userId");

CREATE INDEX "task_subscriptions_taskId_idx"
  ON "task_subscriptions"("taskId");
CREATE INDEX "task_subscriptions_userId_idx"
  ON "task_subscriptions"("userId");

ALTER TABLE "task_subscriptions"
  ADD CONSTRAINT "task_subscriptions_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "task_subscriptions"
  ADD CONSTRAINT "task_subscriptions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── TABLE: task_nudges ───────────────────────────────────────────
CREATE TABLE "task_nudges" (
  "id"        TEXT NOT NULL,
  "taskId"    TEXT NOT NULL,
  "senderId"  TEXT NOT NULL,
  "message"   TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_nudges_pkey" PRIMARY KEY ("id")
);

-- Hot query: "has THIS user nudged THIS task in the last 24h?"
-- (cooldown enforcement). The composite covers task+sender+time so
-- Postgres can use it directly without a secondary scan.
CREATE INDEX "task_nudges_taskId_senderId_createdAt_idx"
  ON "task_nudges"("taskId", "senderId", "createdAt");

ALTER TABLE "task_nudges"
  ADD CONSTRAINT "task_nudges_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "task_nudges"
  ADD CONSTRAINT "task_nudges_senderId_fkey"
  FOREIGN KEY ("senderId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
