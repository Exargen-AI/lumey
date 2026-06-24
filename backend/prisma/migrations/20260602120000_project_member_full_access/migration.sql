-- Per-project full-access grant for CLIENT members (2026-06-02).
--
-- Adds project_members.fullAccess. When true on a CLIENT membership, that
-- client sees the FULL internal view of that ONE project (all tasks,
-- decisions, internal comments) instead of the client-visible subset.
-- Replaces the blunt global users.extendedClientAccess flag for new grants;
-- the backfill below converts any existing global grant into the
-- equivalent per-project grants so nothing regresses.

ALTER TABLE "project_members"
  ADD COLUMN "fullAccess" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: any CLIENT who currently holds the legacy global
-- extendedClientAccess flag gets full access on every project they're
-- already a member of — same effective visibility they have today.
UPDATE "project_members" pm
SET "fullAccess" = true
FROM "users" u
WHERE pm."userId" = u."id"
  AND u."role" = 'CLIENT'
  AND u."extendedClientAccess" = true;
