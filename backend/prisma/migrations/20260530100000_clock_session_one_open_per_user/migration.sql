-- Wave 11 — enforce "at most one OPEN clock session per user" at the
-- database level so two concurrent /clock/in requests from the same
-- browser (double-tap, optimistic retry, etc.) can never produce two
-- open rows for the same user.
--
-- The application layer already had a `findFirst → create` check,
-- but under Postgres default READ COMMITTED isolation two concurrent
-- transactions can both see "no open session" before either has
-- written, then both succeed — silently violating the invariant.
-- Wrapping in `$transaction` does NOT fix this on its own (still
-- READ COMMITTED). The robust fix is a partial UNIQUE INDEX.
--
-- Postgres treats NULL as not-equal-to-anything in UNIQUE indexes,
-- so a partial index `WHERE clockedOutAt IS NULL AND autoClosedAt IS
-- NULL` enforces uniqueness only across OPEN rows. Closed sessions
-- (either clockedOut or auto-closed) are unconstrained — there can
-- be hundreds per user.
--
-- The loser of a concurrent insert gets a 23505 unique_violation;
-- the service layer catches it and returns the winning row so
-- /clock/in stays idempotent from the user's perspective ("you're
-- already clocked in, here's your open session").
--
-- Prisma's @@unique syntax does NOT support partial indexes, so this
-- has to be a raw SQL migration. The index name matches Prisma's
-- naming convention so a future `prisma db pull` finds it.

CREATE UNIQUE INDEX IF NOT EXISTS "clock_sessions_one_open_per_user"
  ON "clock_sessions" ("userId")
  WHERE "clockedOutAt" IS NULL AND "autoClosedAt" IS NULL;
