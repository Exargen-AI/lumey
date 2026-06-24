-- Pulse Composite Productivity Score — Wave 3 (CODE signal + GitHub
-- webhook ingestion).
--
-- Adds:
--   users.githubLogin   — optional unique lowercased GitHub login so
--                         the webhook can map an actor's login to a
--                         user row. Null until SUPER_ADMIN populates it.
--   github_webhook_events — audit log of every delivery received.
--                         De-duped by deliveryId (the X-GitHub-Delivery
--                         header). 90-day retention.
--
-- See docs/pulse/04-productivity-scoring.md for the full design.

-- ────────────────────────────────────────────────────────────────────
-- User.githubLogin
-- ────────────────────────────────────────────────────────────────────

ALTER TABLE "users" ADD COLUMN "githubLogin" TEXT;

-- Unique constraint: one human per GitHub login, no typo'd-casing
-- duplicates (the application layer lowercases on write).
CREATE UNIQUE INDEX "users_githubLogin_key" ON "users"("githubLogin");

-- ────────────────────────────────────────────────────────────────────
-- github_webhook_events
-- ────────────────────────────────────────────────────────────────────

CREATE TABLE "github_webhook_events" (
  "id"            TEXT NOT NULL,
  "deliveryId"    VARCHAR(64) NOT NULL,
  "eventType"     VARCHAR(32) NOT NULL,
  "action"        VARCHAR(32),
  "repo"          VARCHAR(255),
  "actorLogin"    VARCHAR(64),
  "actorIsBot"    BOOLEAN NOT NULL DEFAULT FALSE,
  "rawPayload"    JSONB NOT NULL,
  "eventsEmitted" INTEGER NOT NULL DEFAULT 0,
  "receivedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "github_webhook_events_pkey" PRIMARY KEY ("id")
);

-- De-dupe key: re-deliveries of the same delivery_id no-op on insert.
CREATE UNIQUE INDEX "github_webhook_events_deliveryId_key"
  ON "github_webhook_events"("deliveryId");

-- Reconciliation query: "all events of type X in the last 24h" so the
-- scoreRecomputeWorker can cross-check against productivity_events.
CREATE INDEX "github_webhook_events_eventType_receivedAt_idx"
  ON "github_webhook_events"("eventType", "receivedAt");

-- Audit: "all events from actor login X in the last 30 days".
CREATE INDEX "github_webhook_events_actorLogin_receivedAt_idx"
  ON "github_webhook_events"("actorLogin", "receivedAt");

-- Retention sweep: "all events older than 90 days".
CREATE INDEX "github_webhook_events_receivedAt_idx"
  ON "github_webhook_events"("receivedAt");
