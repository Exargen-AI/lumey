-- CreateTable
CREATE TABLE "run_receipts" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "algo" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "run_receipts_runId_key" ON "run_receipts"("runId");

-- AddForeignKey
ALTER TABLE "run_receipts" ADD CONSTRAINT "run_receipts_runId_fkey" FOREIGN KEY ("runId") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

