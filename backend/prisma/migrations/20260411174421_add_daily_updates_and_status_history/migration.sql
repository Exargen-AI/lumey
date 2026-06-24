-- CreateEnum
CREATE TYPE "Mood" AS ENUM ('GREAT', 'GOOD', 'NEUTRAL', 'STRUGGLING', 'BLOCKED');

-- CreateTable
CREATE TABLE "daily_updates" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "summary" TEXT NOT NULL,
    "mood" "Mood" NOT NULL DEFAULT 'NEUTRAL',
    "blockers" TEXT,
    "plans" TEXT,
    "hoursWorked" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_update_tasks" (
    "id" TEXT NOT NULL,
    "dailyUpdateId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "note" TEXT,
    "statusBefore" "TaskStatus" NOT NULL,
    "statusAfter" "TaskStatus" NOT NULL,

    CONSTRAINT "daily_update_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_status_history" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fromStatus" "TaskStatus" NOT NULL,
    "toStatus" "TaskStatus" NOT NULL,
    "changedBy" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_updates_userId_idx" ON "daily_updates"("userId");

-- CreateIndex
CREATE INDEX "daily_updates_date_idx" ON "daily_updates"("date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_updates_userId_date_key" ON "daily_updates"("userId", "date");

-- CreateIndex
CREATE INDEX "task_status_history_taskId_idx" ON "task_status_history"("taskId");

-- CreateIndex
CREATE INDEX "task_status_history_changedBy_idx" ON "task_status_history"("changedBy");

-- CreateIndex
CREATE INDEX "task_status_history_changedAt_idx" ON "task_status_history"("changedAt");

-- CreateIndex
CREATE INDEX "notifications_userId_read_idx" ON "notifications"("userId", "read");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");

-- AddForeignKey
ALTER TABLE "daily_updates" ADD CONSTRAINT "daily_updates_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_update_tasks" ADD CONSTRAINT "daily_update_tasks_dailyUpdateId_fkey" FOREIGN KEY ("dailyUpdateId") REFERENCES "daily_updates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_update_tasks" ADD CONSTRAINT "daily_update_tasks_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_status_history" ADD CONSTRAINT "task_status_history_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_status_history" ADD CONSTRAINT "task_status_history_changedBy_fkey" FOREIGN KEY ("changedBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
