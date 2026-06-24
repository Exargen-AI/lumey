-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "agentPoolRole" TEXT;

-- CreateIndex
CREATE INDEX "tasks_agentPoolRole_idx" ON "tasks"("agentPoolRole");

