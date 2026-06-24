-- CreateEnum
CREATE TYPE "TimesheetStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "timesheet_weeks" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "status" "TimesheetStatus" NOT NULL DEFAULT 'DRAFT',
    "totalHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "timesheet_weeks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "timesheet_weeks_userId_idx" ON "timesheet_weeks"("userId");

-- CreateIndex
CREATE INDEX "timesheet_weeks_status_idx" ON "timesheet_weeks"("status");

-- CreateIndex
CREATE UNIQUE INDEX "timesheet_weeks_userId_weekStart_key" ON "timesheet_weeks"("userId", "weekStart");

-- AddForeignKey
ALTER TABLE "timesheet_weeks" ADD CONSTRAINT "timesheet_weeks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timesheet_weeks" ADD CONSTRAINT "timesheet_weeks_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
