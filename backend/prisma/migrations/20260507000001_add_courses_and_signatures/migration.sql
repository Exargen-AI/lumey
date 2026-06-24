-- Compliance / onboarding course system: courses, modules, quizzes, enrollments,
-- module progress, quiz attempts, and legally-defensible per-document signatures.
-- Also adds onboarding flags to users.

-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('MULTIPLE_CHOICE', 'TRUE_FALSE', 'SCENARIO');

-- AlterTable
ALTER TABLE "users"
  ADD COLUMN "onboardingRequired" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "courses" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isMandatoryOnHire" BOOLEAN NOT NULL DEFAULT false,
    "passingScore" INTEGER NOT NULL DEFAULT 80,
    "applicableRoles" "UserRole"[],
    "status" "CourseStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_modules" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "contentBlocks" JSONB NOT NULL DEFAULT '[]',
    "estimatedMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_documents" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quizzes" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "passingScore" INTEGER NOT NULL DEFAULT 80,
    "allowRetry" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quizzes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_questions" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL DEFAULT 'MULTIPLE_CHOICE',
    "options" JSONB NOT NULL DEFAULT '[]',
    "explanation" TEXT,

    CONSTRAINT "quiz_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "courseVersion" INTEGER NOT NULL,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "module_progress" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "scrolledToBottom" BOOLEAN NOT NULL DEFAULT false,
    "timeOnPageSec" INTEGER NOT NULL DEFAULT 0,
    "quizPassed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "module_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quiz_attempts" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "scorePercent" INTEGER,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "answers" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "quiz_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_signatures" (
    "id" TEXT NOT NULL,
    "enrollmentId" TEXT NOT NULL,
    "courseDocumentId" TEXT NOT NULL,
    "documentVersion" INTEGER NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signedName" TEXT NOT NULL,
    "signedTextSnapshot" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "passwordReentered" BOOLEAN NOT NULL DEFAULT false,
    "externalProvider" TEXT,
    "externalEnvelopeId" TEXT,
    "externalAuditUrl" TEXT,

    CONSTRAINT "document_signatures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "courses_slug_key" ON "courses"("slug");

-- CreateIndex
CREATE INDEX "courses_status_isMandatoryOnHire_idx" ON "courses"("status", "isMandatoryOnHire");

-- CreateIndex
CREATE INDEX "course_modules_courseId_idx" ON "course_modules"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "course_modules_courseId_order_key" ON "course_modules"("courseId", "order");

-- CreateIndex
CREATE INDEX "course_documents_courseId_idx" ON "course_documents"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "course_documents_courseId_slug_key" ON "course_documents"("courseId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "quizzes_moduleId_key" ON "quizzes"("moduleId");

-- CreateIndex
CREATE UNIQUE INDEX "quiz_questions_quizId_order_key" ON "quiz_questions"("quizId", "order");

-- CreateIndex
CREATE INDEX "enrollments_userId_idx" ON "enrollments"("userId");

-- CreateIndex
CREATE INDEX "enrollments_courseId_idx" ON "enrollments"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_userId_courseId_courseVersion_key" ON "enrollments"("userId", "courseId", "courseVersion");

-- CreateIndex
CREATE UNIQUE INDEX "module_progress_enrollmentId_moduleId_key" ON "module_progress"("enrollmentId", "moduleId");

-- CreateIndex
CREATE INDEX "quiz_attempts_enrollmentId_idx" ON "quiz_attempts"("enrollmentId");

-- CreateIndex
CREATE INDEX "document_signatures_enrollmentId_idx" ON "document_signatures"("enrollmentId");

-- CreateIndex
CREATE UNIQUE INDEX "document_signatures_enrollmentId_courseDocumentId_documentV_key" ON "document_signatures"("enrollmentId", "courseDocumentId", "documentVersion");

-- AddForeignKey
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_documents" ADD CONSTRAINT "course_documents_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quizzes" ADD CONSTRAINT "quizzes_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "course_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module_progress" ADD CONSTRAINT "module_progress_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module_progress" ADD CONSTRAINT "module_progress_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "course_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "quizzes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_courseDocumentId_fkey" FOREIGN KEY ("courseDocumentId") REFERENCES "course_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
