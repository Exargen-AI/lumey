-- Capture schema drift that previously lived only in `schema.prisma` (added
-- via `prisma db push` rather than `prisma migrate dev`).
--
-- This migration is idempotent — every DDL operation is wrapped in an
-- existence check so it's safe to apply on:
--   * fresh databases (CI, new dev setups) — adds everything
--   * existing databases that already have these objects via db-push (local
--     and production) — does nothing
--
-- After this lands, run `npx prisma migrate resolve --applied
-- 20260503000000_capture_schema_drift` on any existing DB to record it as
-- applied without re-running.

-- ─── Enums (idempotent via DO block) ────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "TaskType" AS ENUM ('FEATURE', 'BUG', 'CHORE', 'SPIKE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "SprintStatus" AS ENUM ('PLANNING', 'ACTIVE', 'COMPLETED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "EpicStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "CmsBlogStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "CmsTemplateType" AS ENUM ('ARTICLE', 'TUTORIAL', 'NEWS', 'CASE_STUDY', 'ANNOUNCEMENT');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── New tables ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "sprints" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "goal" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "SprintStatus" NOT NULL DEFAULT 'PLANNING',
    "retroNotes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sprints_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "epics" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "status" "EpicStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "epics_pkey" PRIMARY KEY ("id")
);

-- ─── Columns added to existing tables ───────────────────────────────────────

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "taskCounter" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "epicId"      TEXT;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "sprintId"    TEXT;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "storyPoints" INTEGER;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "taskNumber"  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "taskType"    "TaskType" NOT NULL DEFAULT 'FEATURE';

-- ─── Column type migrations (CMS status / template type → enum) ────────────
--
-- The 20260421_add_cms_module migration declared these as TEXT, but the
-- schema models them as enums. Convert in place — preserves existing values
-- by casting through text. The `USING` clause makes this safe for rows
-- already containing valid enum-string values (DRAFT/PUBLISHED/ARCHIVED etc.).
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns
        WHERE table_name = 'cms_blogs' AND column_name = 'status') = 'text' THEN
    ALTER TABLE "cms_blogs"
      ALTER COLUMN "status" DROP DEFAULT,
      ALTER COLUMN "status" TYPE "CmsBlogStatus" USING "status"::"CmsBlogStatus",
      ALTER COLUMN "status" SET DEFAULT 'DRAFT';
  END IF;
END $$;

DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns
        WHERE table_name = 'cms_templates' AND column_name = 'type') = 'text' THEN
    ALTER TABLE "cms_templates"
      ALTER COLUMN "type" TYPE "CmsTemplateType" USING "type"::"CmsTemplateType";
  END IF;
END $$;

-- ─── Indexes (CREATE INDEX IF NOT EXISTS is built-in) ──────────────────────

CREATE INDEX        IF NOT EXISTS "sprints_projectId_status_idx"  ON "sprints"  ("projectId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "sprints_projectId_number_key"  ON "sprints"  ("projectId", "number");
CREATE INDEX        IF NOT EXISTS "epics_projectId_idx"           ON "epics"    ("projectId");
CREATE INDEX        IF NOT EXISTS "cms_blogs_projectId_status_idx" ON "cms_blogs" ("projectId", "status");
CREATE INDEX        IF NOT EXISTS "tasks_sprintId_idx"            ON "tasks"    ("sprintId");
CREATE INDEX        IF NOT EXISTS "tasks_epicId_idx"              ON "tasks"    ("epicId");
CREATE UNIQUE INDEX IF NOT EXISTS "tasks_projectId_taskNumber_key" ON "tasks"   ("projectId", "taskNumber");

-- ─── Foreign keys (idempotent via DO block) ────────────────────────────────

DO $$ BEGIN
  ALTER TABLE "tasks" ADD CONSTRAINT "tasks_sprintId_fkey"
    FOREIGN KEY ("sprintId") REFERENCES "sprints"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "tasks" ADD CONSTRAINT "tasks_epicId_fkey"
    FOREIGN KEY ("epicId") REFERENCES "epics"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "sprints" ADD CONSTRAINT "sprints_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "epics" ADD CONSTRAINT "epics_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "cms_templates" ADD CONSTRAINT "cms_templates_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "cms_content_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "cms_blogs" ADD CONSTRAINT "cms_blogs_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "cms_content_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "cms_blogs" ADD CONSTRAINT "cms_blogs_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "cms_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "cms_blogs" ADD CONSTRAINT "cms_blogs_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "cms_media_assets" ADD CONSTRAINT "cms_media_assets_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "cms_content_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
