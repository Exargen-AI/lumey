-- Adds the acceptanceCriteria field on Task — a JSON array of
-- { id, text, done } records. Mirrors the existing `subtasks` column shape.
-- Idempotent: ALTER TABLE ... ADD COLUMN IF NOT EXISTS so the migration is
-- safe to re-run on environments where the column was already pushed via
-- `prisma db push` during development.

ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "acceptanceCriteria" JSONB NOT NULL DEFAULT '[]'::jsonb;
