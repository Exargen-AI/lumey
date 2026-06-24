-- PR B feature #5 — Reviewer tagging on Task.
--
-- Adds three nullable columns so we can record:
--   - reviewerId            — who's currently reviewing this task
--   - reviewRequestedAt     — when the handoff happened (drives "X days
--                             waiting on review" signals)
--   - reviewRequestedById   — who asked for the review (so the assignee
--                             knows who to follow up with)
--
-- Why these are separate from assigneeId: today, a hand-off-for-review
-- forces the team to overwrite the assignee, losing the "who actually
-- did the work" provenance and breaking workload reporting. Reviewer is
-- additive; assignee stays put.
--
-- FK rules:
--   - ON DELETE SET NULL for both FKs to User. If a reviewer's account
--     is deactivated/deleted we don't want every IN_REVIEW task to
--     cascade-delete; the row stays, the reference becomes null, and
--     the UI can prompt the team to pick a new reviewer.
--
-- Indexes:
--   - tasks_reviewerId_idx              — "tasks waiting on me" (the
--                                          reviewer-dashboard query)
--   - tasks_projectId_reviewerId_idx    — "reviews this project owes the
--                                          client" / scoped lookups
--
-- Purely additive; no backfill — every existing row has NULL on all
-- three columns until the team starts using the workflow.

ALTER TABLE "tasks"
  ADD COLUMN "reviewerId"            TEXT,
  ADD COLUMN "reviewRequestedAt"     TIMESTAMP(3),
  ADD COLUMN "reviewRequestedById"   TEXT;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_reviewerId_fkey"
    FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_reviewRequestedById_fkey"
    FOREIGN KEY ("reviewRequestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "tasks_reviewerId_idx"
  ON "tasks"("reviewerId");

CREATE INDEX "tasks_projectId_reviewerId_idx"
  ON "tasks"("projectId", "reviewerId");
