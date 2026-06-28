-- HITL approval gate: the runtime opens a PENDING approval before a high-risk
-- action (e.g. open_pr) and the run parks on AWAITING_INPUT; a human approves
-- (the action proceeds) or rejects (it is refused and the agent continues).
-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "run_approval_requests" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,

    CONSTRAINT "run_approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "run_approval_requests_runId_idx" ON "run_approval_requests"("runId");

-- CreateIndex
CREATE INDEX "run_approval_requests_status_idx" ON "run_approval_requests"("status");

-- AddForeignKey
ALTER TABLE "run_approval_requests" ADD CONSTRAINT "run_approval_requests_runId_fkey" FOREIGN KEY ("runId") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_approval_requests" ADD CONSTRAINT "run_approval_requests_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

