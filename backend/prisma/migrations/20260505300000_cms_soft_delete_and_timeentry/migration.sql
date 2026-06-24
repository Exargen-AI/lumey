-- ─── CMS soft-delete (QA finding #33) ─────────────────────────────────────
-- Switch from hard-delete to tombstone so an admin misclick doesn't wipe the
-- audit chain (rotated keys, blogs published under the old project).

ALTER TABLE "cms_content_projects"
  ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "cms_content_projects_deletedAt_idx" ON "cms_content_projects"("deletedAt");

-- ─── TimeEntry partial unique on null taskId (QA finding #45) ─────────────
-- The composite unique index `(userId, projectId, date, taskId)` doesn't
-- enforce uniqueness when taskId is NULL because Postgres treats every NULL
-- as distinct. Same user logging two project-level entries for the same day
-- would write two rows.
--
-- Fix: a partial unique index keyed on the non-null columns, restricted to
-- the NULL-taskId rows. The existing composite unique handles task-bound
-- entries unchanged.
CREATE UNIQUE INDEX "time_entries_userId_projectId_date_null_task_idx"
  ON "time_entries"("userId", "projectId", "date")
  WHERE "taskId" IS NULL;
