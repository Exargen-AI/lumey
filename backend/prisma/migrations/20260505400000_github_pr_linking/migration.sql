-- GitHub PR linking: per-project integration config + per-task outbound link rows.
-- The `integration.manage` permission is registered via the runtime
-- `permissionSync.service` on next bootstrap — no SQL seed needed.

CREATE TYPE "TaskExternalLinkKind" AS ENUM ('GITHUB_PR');
CREATE TYPE "TaskExternalLinkState" AS ENUM ('OPEN', 'MERGED', 'CLOSED');

CREATE TABLE "project_github_integrations" (
  "id"               TEXT NOT NULL,
  "projectId"        TEXT NOT NULL,
  "repoOwner"        TEXT NOT NULL,
  "repoName"         TEXT NOT NULL,
  "webhookSecret"    TEXT NOT NULL,
  "autoCloseOnMerge" BOOLEAN NOT NULL DEFAULT false,
  "lastWebhookAt"    TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "project_github_integrations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_github_integrations_projectId_key"
  ON "project_github_integrations"("projectId");

ALTER TABLE "project_github_integrations"
  ADD CONSTRAINT "project_github_integrations_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "task_external_links" (
  "id"           TEXT NOT NULL,
  "taskId"       TEXT NOT NULL,
  "kind"         "TaskExternalLinkKind" NOT NULL,
  "externalId"   TEXT NOT NULL,
  "url"          TEXT NOT NULL,
  "title"        TEXT,
  "state"        "TaskExternalLinkState" NOT NULL DEFAULT 'OPEN',
  "authorName"   TEXT,
  "authorAvatar" TEXT,
  "openedAt"     TIMESTAMP(3),
  "mergedAt"     TIMESTAMP(3),
  "closedAt"     TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "task_external_links_pkey" PRIMARY KEY ("id")
);

-- Idempotency: GitHub redelivers webhooks. Same task + same kind + same
-- external id is the same link, no matter how many times the event fires.
CREATE UNIQUE INDEX "task_external_links_taskId_kind_externalId_key"
  ON "task_external_links"("taskId", "kind", "externalId");
CREATE INDEX "task_external_links_taskId_idx" ON "task_external_links"("taskId");

ALTER TABLE "task_external_links"
  ADD CONSTRAINT "task_external_links_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
