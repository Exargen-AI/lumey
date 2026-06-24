import { mkdir } from 'fs/promises';
import path from 'path';
import prisma from '../config/database';

async function ensureUploadsDirectory() {
  const uploadsDir = path.resolve(process.cwd(), 'uploads', 'cms');
  await mkdir(uploadsDir, { recursive: true });
}

export async function ensureCmsSchemaReady() {
  await ensureUploadsDirectory();

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "cms_blogs"
    ADD COLUMN IF NOT EXISTS "featuredImage" JSONB
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "cms_blogs"
    ADD COLUMN IF NOT EXISTS "seo" JSONB
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "cms_blogs"
    ADD COLUMN IF NOT EXISTS "tags" TEXT[] DEFAULT ARRAY[]::TEXT[]
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "cms_blogs"
    ADD COLUMN IF NOT EXISTS "categories" TEXT[] DEFAULT ARRAY[]::TEXT[]
  `);

  await prisma.$executeRawUnsafe(`
    UPDATE "cms_blogs"
    SET "tags" = ARRAY[]::TEXT[]
    WHERE "tags" IS NULL
  `);

  await prisma.$executeRawUnsafe(`
    UPDATE "cms_blogs"
    SET "categories" = ARRAY[]::TEXT[]
    WHERE "categories" IS NULL
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "cms_media_assets" (
      "id" TEXT NOT NULL,
      "projectId" TEXT NOT NULL,
      "filename" TEXT NOT NULL,
      "originalName" TEXT NOT NULL,
      "mimeType" TEXT NOT NULL,
      "size" INTEGER NOT NULL,
      "url" TEXT NOT NULL,
      "altText" TEXT,
      "caption" TEXT,
      "metadata" JSONB NOT NULL DEFAULT '{}',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "cms_media_assets_pkey" PRIMARY KEY ("id")
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "cms_media_assets_projectId_idx"
    ON "cms_media_assets"("projectId")
  `);

  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'cms_media_assets_projectId_fkey'
      ) THEN
        ALTER TABLE "cms_media_assets"
        ADD CONSTRAINT "cms_media_assets_projectId_fkey"
        FOREIGN KEY ("projectId") REFERENCES "cms_content_projects"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION;
      END IF;
    END $$;
  `);
}
