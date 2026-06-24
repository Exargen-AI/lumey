-- Phase 3: per-user acknowledgment validity (annual re-ack) + cycle support.
--
-- Adds:
--   - courses.acknowledgmentValidityDays (null = never expires)
--   - enrollments.cycle (default 1) — incremented each time a user re-takes
--   - enrollments.expiresAt — denormalized completion + validity window
--   - composite unique index changed to include cycle so multiple cycles can
--     exist at the same courseVersion

-- AlterTable
ALTER TABLE "courses"
  ADD COLUMN "acknowledgmentValidityDays" INTEGER;

-- AlterTable
ALTER TABLE "enrollments"
  ADD COLUMN "cycle" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "expiresAt" TIMESTAMP(3);

-- DropIndex (old unique without cycle)
DROP INDEX "enrollments_userId_courseId_courseVersion_key";

-- CreateIndex (new unique including cycle)
CREATE UNIQUE INDEX "enrollments_userId_courseId_courseVersion_cycle_key"
  ON "enrollments"("userId", "courseId", "courseVersion", "cycle");

-- CreateIndex (lookup expired completions efficiently in the maintenance job)
CREATE INDEX "enrollments_expiresAt_idx" ON "enrollments"("expiresAt");
