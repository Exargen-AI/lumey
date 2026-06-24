-- Task ↔ Milestone link.
--
-- 1. Add `tasks.milestoneId` — optional FK to the new Milestone the task
--    rolls up to. NULL is the default + the common case (sprint-level
--    work, chores, anything not aligned to a specific milestone). The
--    foreign-key rule is ON DELETE SET NULL so deleting a milestone
--    doesn't drop any task history — the tasks just become un-scoped.
--
-- 2. Index on `(milestoneId)` for the hot per-milestone roll-up query
--    ("all tasks under this milestone" → progress %, story points
--    done/total, forecast verdict).
--
-- All additive. Existing rows default `milestoneId` to NULL. No backfill
-- required.

ALTER TABLE "tasks" ADD COLUMN "milestoneId" TEXT;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_milestoneId_fkey"
  FOREIGN KEY ("milestoneId")
  REFERENCES "milestones"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

CREATE INDEX "tasks_milestoneId_idx" ON "tasks"("milestoneId");
