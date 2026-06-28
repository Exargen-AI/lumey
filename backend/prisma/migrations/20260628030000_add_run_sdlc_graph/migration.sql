-- CreateEnum
CREATE TYPE "PrState" AS ENUM ('OPEN', 'MERGED', 'CLOSED');

-- CreateEnum
CREATE TYPE "CheckStatus" AS ENUM ('QUEUED', 'IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "CheckConclusion" AS ENUM ('SUCCESS', 'FAILURE', 'NEUTRAL', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'SKIPPED', 'STALE');

-- CreateTable
CREATE TABLE "run_commits" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sha" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "committedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "run_commits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_pull_requests" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "number" INTEGER,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "baseBranch" TEXT NOT NULL,
    "state" "PrState" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mergedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "run_pull_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_checks" (
    "id" TEXT NOT NULL,
    "runPullRequestId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CheckStatus" NOT NULL DEFAULT 'QUEUED',
    "conclusion" "CheckConclusion",
    "url" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "run_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "run_commits_runId_idx" ON "run_commits"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "run_commits_runId_sha_key" ON "run_commits"("runId", "sha");

-- CreateIndex
CREATE UNIQUE INDEX "run_pull_requests_externalId_key" ON "run_pull_requests"("externalId");

-- CreateIndex
CREATE INDEX "run_pull_requests_runId_idx" ON "run_pull_requests"("runId");

-- CreateIndex
CREATE INDEX "run_pull_requests_branch_idx" ON "run_pull_requests"("branch");

-- CreateIndex
CREATE UNIQUE INDEX "run_checks_externalId_key" ON "run_checks"("externalId");

-- CreateIndex
CREATE INDEX "run_checks_runPullRequestId_idx" ON "run_checks"("runPullRequestId");

-- AddForeignKey
ALTER TABLE "run_commits" ADD CONSTRAINT "run_commits_runId_fkey" FOREIGN KEY ("runId") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_pull_requests" ADD CONSTRAINT "run_pull_requests_runId_fkey" FOREIGN KEY ("runId") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_checks" ADD CONSTRAINT "run_checks_runPullRequestId_fkey" FOREIGN KEY ("runPullRequestId") REFERENCES "run_pull_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

