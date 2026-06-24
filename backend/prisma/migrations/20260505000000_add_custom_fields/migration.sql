-- Per-product custom field definitions + Task.customFields value bag.
-- Idempotent: every step uses IF NOT EXISTS / DO-block guards so the
-- migration is safe to re-run after `prisma db push` or partial pushes.

-- 1. Task.customFields value map (JSON keyed by definition.key)
ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "customFields" JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 2. Field-type enum
DO $$ BEGIN
  CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'SELECT', 'DATE', 'URL', 'BADGE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 3. CustomFieldDefinition table
CREATE TABLE IF NOT EXISTS "custom_field_definitions" (
  "id"        TEXT             NOT NULL,
  "projectId" TEXT             NOT NULL,
  "name"      TEXT             NOT NULL,
  "key"       TEXT             NOT NULL,
  "fieldType" "CustomFieldType" NOT NULL,
  "config"    JSONB            NOT NULL DEFAULT '{}'::jsonb,
  "required"  BOOLEAN          NOT NULL DEFAULT false,
  "order"     INTEGER          NOT NULL DEFAULT 0,
  "hint"      TEXT,
  "createdAt" TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3)     NOT NULL,
  CONSTRAINT "custom_field_definitions_pkey" PRIMARY KEY ("id")
);

-- A given key can only be used once per project — protects against UI
-- duplication and preserves the {key → value} contract on Task.customFields.
CREATE UNIQUE INDEX IF NOT EXISTS "custom_field_definitions_projectId_key_key"
  ON "custom_field_definitions" ("projectId", "key");

-- Ordered fetch by display position.
CREATE INDEX IF NOT EXISTS "custom_field_definitions_projectId_order_idx"
  ON "custom_field_definitions" ("projectId", "order");

-- FK to Project — cascade so cleanup is automatic.
DO $$ BEGIN
  ALTER TABLE "custom_field_definitions"
    ADD CONSTRAINT "custom_field_definitions_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
