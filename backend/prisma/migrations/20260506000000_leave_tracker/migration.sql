-- Leave tracking — v1 schema. Pankaj (sole SUPER_ADMIN) is the only approver
-- in the service layer; the table is approver-agnostic so future delegation
-- can land without a migration.

CREATE TYPE "LeaveType" AS ENUM ('CASUAL', 'SICK', 'EARNED', 'UNPAID', 'BEREAVEMENT', 'OTHER');
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TABLE "leave_requests" (
  "id"           TEXT NOT NULL,
  "applicantId"  TEXT NOT NULL,
  "startDate"    TIMESTAMP(3) NOT NULL,
  "endDate"      TIMESTAMP(3) NOT NULL,
  "totalDays"    INTEGER NOT NULL,
  "leaveType"    "LeaveType" NOT NULL DEFAULT 'CASUAL',
  "reason"       TEXT,
  "status"       "LeaveStatus" NOT NULL DEFAULT 'PENDING',
  "decidedById"  TEXT,
  "decidedAt"    TIMESTAMP(3),
  "decisionNote" TEXT,
  "cancelledAt"  TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "leave_requests"
  ADD CONSTRAINT "leave_requests_applicantId_fkey"
  FOREIGN KEY ("applicantId") REFERENCES "users"("id") ON DELETE CASCADE;

ALTER TABLE "leave_requests"
  ADD CONSTRAINT "leave_requests_decidedById_fkey"
  FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL;

CREATE INDEX "leave_requests_applicantId_status_idx" ON "leave_requests" ("applicantId", "status");
CREATE INDEX "leave_requests_status_startDate_idx"  ON "leave_requests" ("status", "startDate");
