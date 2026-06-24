-- Add an optional epic link to Sprint so two epics can each carry a "Sprint 1"
-- without colliding in dedup. Existing sprints have epicId=NULL (they came in
-- through the in-app create flow which doesn't link an epic). Ingestion-
-- created sprints starting from this PR will set epicId when the markdown
-- nests the Sprint inside an Epic.
--
-- QA finding I-C2 (CRITICAL): without this, two parsed epics each containing
-- "### Sprint: Sprint 1 (...)" silently collapsed into one DB row, attaching
-- tasks under both epics' Sprint 1 to a single sprint.

ALTER TABLE "sprints" ADD COLUMN "epicId" TEXT;

ALTER TABLE "sprints"
  ADD CONSTRAINT "sprints_epicId_fkey"
  FOREIGN KEY ("epicId") REFERENCES "epics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "sprints_epicId_idx" ON "sprints" ("epicId");
