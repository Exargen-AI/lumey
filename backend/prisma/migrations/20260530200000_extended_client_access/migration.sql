-- 2026-05-30 — Extended CLIENT access flag.
--
-- Adds a per-user opt-in for CLIENT-role users that, when true, grants
-- a curated set of read-only permissions on top of the base CLIENT
-- permission set (see `EXTENDED_CLIENT_ADDITIONAL_PERMISSIONS` in
-- `shared/src/constants/roles.ts`).
--
-- The flag is meaningless on non-CLIENT roles (those roles already have
-- these permissions) — we don't bother validating that at the DB layer.
--
-- Default false so this migration is a no-op for every existing row:
-- zero behaviour change on prod until SUPER_ADMIN flips the flag on a
-- specific CLIENT user via the user-edit modal.
--
-- NOT NULL with DEFAULT lets Postgres skip the table rewrite on PG≥11
-- (it stores the default in pg_attribute and applies it lazily on read),
-- so this is safe to run on a hot table without long lock duration.

ALTER TABLE "users"
  ADD COLUMN "extendedClientAccess" BOOLEAN NOT NULL DEFAULT false;
