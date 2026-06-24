-- Story-update comments (Ask 1, 2026-06): engineers post a structured
-- progress update against a task using the client-facing story template.
-- "plain" preserves the behaviour of every comment that existed before
-- this migration; "story_update" rows additionally carry `storyData`.

ALTER TABLE "comments" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'plain';
ALTER TABLE "comments" ADD COLUMN "storyData" JSONB;

-- The client task view pins the latest story update, so it queries
-- comments on a task filtered by kind, newest first.
CREATE INDEX "comments_taskId_kind_idx" ON "comments"("taskId", "kind");
