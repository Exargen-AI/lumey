-- Retire the global per-user client-access flag (2026-06-02).
--
-- `users.extendedClientAccess` was the blunt "this client sees internals on
-- ALL their projects" switch. It's been replaced by the per-project
-- `project_members.fullAccess` grant (see the prior
-- 20260602120000_project_member_full_access migration, which already
-- backfilled every flagged client's memberships). No access is lost by
-- dropping it — the per-project grants carry the same visibility, scoped.

ALTER TABLE "users" DROP COLUMN "extendedClientAccess";
