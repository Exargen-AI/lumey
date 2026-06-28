-- HITL clarification round-trip: the agent's `ask_human` tool opens a PENDING
-- request and the run parks on AWAITING_INPUT; a human answers and the loop
-- resumes with the answer injected into its transcript.
CREATE TYPE "ClarificationStatus" AS ENUM ('PENDING', 'ANSWERED', 'CANCELLED');

CREATE TABLE "run_clarification_requests" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "status" "ClarificationStatus" NOT NULL DEFAULT 'PENDING',
    "askedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "answeredById" TEXT,

    CONSTRAINT "run_clarification_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "run_clarification_requests_runId_idx" ON "run_clarification_requests"("runId");
CREATE INDEX "run_clarification_requests_status_idx" ON "run_clarification_requests"("status");

ALTER TABLE "run_clarification_requests" ADD CONSTRAINT "run_clarification_requests_runId_fkey" FOREIGN KEY ("runId") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "run_clarification_requests" ADD CONSTRAINT "run_clarification_requests_answeredById_fkey" FOREIGN KEY ("answeredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
