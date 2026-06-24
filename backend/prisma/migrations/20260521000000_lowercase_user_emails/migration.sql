-- One-off data migration to canonicalize the email column.
--
-- WHY:
--   The User.email column is `String @unique` and Postgres string compares
--   are case-sensitive by default. Users who registered or were invited
--   with a mixed-case address (e.g. "John@Exargen.in") could not log in
--   when they typed the email in any other casing — `findUnique` missed
--   their row. Application code now normalizes emails to lowercase at
--   the Zod validator boundary and again at the service layer, so all
--   NEW writes go in lowercase. This migration brings EXISTING rows
--   in line with that convention.
--
-- SAFETY:
--   If two existing rows already collide case-insensitively (e.g. both
--   "John@x.com" AND "john@x.com" exist), a naive UPDATE would violate
--   the unique constraint and the migration would abort mid-way. We
--   pre-check for that and RAISE EXCEPTION so a human has to reconcile
--   the dupes before we proceed. Idempotent: re-running it after
--   completion is a no-op (the WHERE filter excludes already-lowercase
--   rows).
--
-- Operationally:
--   - Expect zero collisions on Exargen's current dataset (every seeded
--     account is already lowercase). The pre-check is for the unknown
--     long-tail of user-self-created rows in prod.
--   - If the EXCEPTION fires, the operator should run the diagnostic
--     SELECT below to see which rows collide, then either delete the
--     duplicate or merge their auth identity manually.

DO $$
DECLARE
  collision_count int;
BEGIN
  SELECT COUNT(*) INTO collision_count
  FROM (
    SELECT LOWER(email) AS lo
    FROM "users"
    GROUP BY LOWER(email)
    HAVING COUNT(*) > 1
  ) sub;

  IF collision_count > 0 THEN
    RAISE EXCEPTION
      'Aborting email-lowercase migration: % case-insensitive email collision(s) found in "users". Reconcile manually with: SELECT id, email FROM "users" WHERE LOWER(email) IN (SELECT LOWER(email) FROM "users" GROUP BY LOWER(email) HAVING COUNT(*) > 1) ORDER BY LOWER(email);',
      collision_count;
  END IF;
END $$;

UPDATE "users"
SET email = LOWER(email)
WHERE email <> LOWER(email);
