-- PR A foundation — Task.clientRequested flag.
--
-- This column flips to true whenever a client (UserRole = CLIENT) submits
-- a task from their portal kanban. The server forces clientVisible=true
-- AND status=BACKLOG on those rows; the team triages from there.
--
-- Why an explicit column instead of deriving from creator.role:
--   1. The kanban filters by clientRequested without a JOIN to users —
--      "show me incoming client requests" is a hot dashboard query.
--   2. Client identity is denormalised here so a re-roled user (rare,
--      but possible: client promoted to ENGINEER) doesn't retroactively
--      change the provenance of historical requests.
--   3. Future "I asked an engineer to submit this on behalf of a client"
--      stays expressible — the engineer is the creator, the boolean
--      records the workflow context.
--
-- No backfill needed; existing rows default to false. The (projectId,
-- clientRequested) index keeps the "incoming requests for this project"
-- list cheap; it matches the same access pattern as the existing
-- (projectId, clientVisible) index.

ALTER TABLE "tasks"
  ADD COLUMN "clientRequested" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "tasks_projectId_clientRequested_idx"
  ON "tasks"("projectId", "clientRequested");
