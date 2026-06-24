-- Project Documents — S3-backed reference material per project.
--
-- Adds the ProjectDocument model plus two enums (DocCategory, DocStatus).
-- Bytes live on S3; this table holds metadata + the s3Key needed to fetch
-- them. Soft-delete via status=DELETED so audit history survives; an
-- async worker (Phase 2 of the docs feature) sweeps DELETED rows and
-- their S3 objects together.
--
-- No existing rows to backfill — purely additive.

-- CreateEnum
CREATE TYPE "DocCategory" AS ENUM ('SPEC', 'DESIGN', 'CONTRACT', 'REFERENCE', 'RUNBOOK', 'SECURITY', 'OTHER');

-- CreateEnum
CREATE TYPE "DocStatus" AS ENUM ('PENDING', 'READY', 'DELETED');

-- CreateTable
CREATE TABLE "project_documents" (
    "id"           TEXT NOT NULL,
    "projectId"    TEXT NOT NULL,
    "title"        TEXT NOT NULL,
    "description"  TEXT,
    "category"     "DocCategory" NOT NULL DEFAULT 'OTHER',
    "s3Bucket"     TEXT NOT NULL,
    "s3Key"        TEXT NOT NULL,
    "filename"     TEXT NOT NULL,
    "contentType"  TEXT NOT NULL,
    "sizeBytes"    INTEGER NOT NULL,
    "status"       "DocStatus" NOT NULL DEFAULT 'PENDING',
    "uploadedById" TEXT NOT NULL,
    "uploadedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,
    "deletedAt"    TIMESTAMP(3),

    CONSTRAINT "project_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_documents_s3Key_key" ON "project_documents"("s3Key");

-- The hot lookup is "list READY docs for project P, newest first" — exactly
-- what the index covers. Drives the Documents tab list AND the knowledge-
-- pack response builder.
CREATE INDEX "project_documents_projectId_status_uploadedAt_idx"
  ON "project_documents"("projectId", "status", "uploadedAt" DESC);

-- AddForeignKey
ALTER TABLE "project_documents"
  ADD CONSTRAINT "project_documents_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_documents"
  ADD CONSTRAINT "project_documents_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
