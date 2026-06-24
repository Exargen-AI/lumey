-- Adds the TaskLink model + TaskLinkType enum.
-- Idempotent: enum + table + indexes + FKs are guarded so re-running on an
-- environment that pushed schema via `prisma db push` is safe.

DO $$ BEGIN
  CREATE TYPE "TaskLinkType" AS ENUM ('BLOCKS', 'RELATES_TO', 'DUPLICATES');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "task_links" (
  "id"          TEXT          NOT NULL,
  "fromTaskId"  TEXT          NOT NULL,
  "toTaskId"    TEXT          NOT NULL,
  "type"        "TaskLinkType" NOT NULL,
  "createdById" TEXT          NOT NULL,
  "createdAt"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_links_pkey" PRIMARY KEY ("id")
);

-- Unique guarantees the same (from, to, type) tuple can't be duplicated.
-- e.g. you can't add the same "A blocks B" link twice.
CREATE UNIQUE INDEX IF NOT EXISTS "task_links_fromTaskId_toTaskId_type_key"
  ON "task_links" ("fromTaskId", "toTaskId", "type");

CREATE INDEX IF NOT EXISTS "task_links_fromTaskId_idx" ON "task_links" ("fromTaskId");
CREATE INDEX IF NOT EXISTS "task_links_toTaskId_idx"   ON "task_links" ("toTaskId");

DO $$ BEGIN
  ALTER TABLE "task_links"
    ADD CONSTRAINT "task_links_fromTaskId_fkey"
    FOREIGN KEY ("fromTaskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "task_links"
    ADD CONSTRAINT "task_links_toTaskId_fkey"
    FOREIGN KEY ("toTaskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "task_links"
    ADD CONSTRAINT "task_links_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
