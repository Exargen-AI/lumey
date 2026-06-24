-- ─── DEVELOPMENTOPS ENUMS ───

CREATE TYPE "GitProvider" AS ENUM ('GITHUB', 'GITLAB', 'BITBUCKET');
CREATE TYPE "RepositoryActivityType" AS ENUM ('COMMIT', 'PR_OPENED', 'PR_MERGED', 'BRANCH_CREATED', 'RELEASE_PUBLISHED');
CREATE TYPE "EnvironmentType" AS ENUM ('DEVELOPMENT', 'STAGING', 'PRODUCTION');
CREATE TYPE "EnvironmentStatus" AS ENUM ('HEALTHY', 'DEGRADED', 'DOWN', 'UNKNOWN');
CREATE TYPE "PipelineStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED');
CREATE TYPE "DeploymentStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'SUCCESS', 'FAILED', 'ROLLED_BACK');

-- ─── REPOSITORIES TABLE ───

CREATE TABLE "repositories" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "provider" "GitProvider" NOT NULL,
  "repoName" TEXT NOT NULL,
  "repoOwner" TEXT NOT NULL,
  "repoUrl" TEXT NOT NULL,
  "accessToken" TEXT,
  "defaultBranch" TEXT NOT NULL DEFAULT 'main',
  "isPrivate" BOOLEAN NOT NULL DEFAULT false,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "repositories_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE CASCADE,
  CONSTRAINT "repositories_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users" ("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "repositories_projectId_provider_repoOwner_repoName_key" ON "repositories"("projectId", "provider", "repoOwner", "repoName");
CREATE INDEX "repositories_projectId_idx" ON "repositories"("projectId");

-- ─── REPOSITORY ACTIVITIES TABLE ───

CREATE TABLE "repository_activities" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "activityType" "RepositoryActivityType" NOT NULL,
  "externalId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "authorName" TEXT,
  "branchName" TEXT,
  "activityUrl" TEXT,
  "metadataJson" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "repository_activities_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE CASCADE,
  CONSTRAINT "repository_activities_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories" ("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "repository_activities_repositoryId_externalId_key" ON "repository_activities"("repositoryId", "externalId");
CREATE INDEX "repository_activities_projectId_idx" ON "repository_activities"("projectId");
CREATE INDEX "repository_activities_repositoryId_createdAt_idx" ON "repository_activities"("repositoryId", "createdAt" DESC);

-- ─── LINKED TASKS TABLE (Activity → Task mapping) ───

CREATE TABLE "linked_tasks" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "repositoryActivityId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "linked_tasks_repositoryActivityId_fkey" FOREIGN KEY ("repositoryActivityId") REFERENCES "repository_activities" ("id") ON DELETE CASCADE,
  CONSTRAINT "linked_tasks_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks" ("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "linked_tasks_repositoryActivityId_taskId_key" ON "linked_tasks"("repositoryActivityId", "taskId");
CREATE INDEX "linked_tasks_taskId_idx" ON "linked_tasks"("taskId");

-- ─── ENVIRONMENTS TABLE ───

CREATE TABLE "environments" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "EnvironmentType" NOT NULL,
  "branchName" TEXT,
  "deploymentUrl" TEXT,
  "status" "EnvironmentStatus" NOT NULL DEFAULT 'UNKNOWN',
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "environments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "environments_projectId_name_key" ON "environments"("projectId", "name");
CREATE INDEX "environments_projectId_idx" ON "environments"("projectId");

-- ─── PIPELINES TABLE ───

CREATE TABLE "pipelines" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "repositoryId" TEXT NOT NULL,
  "provider" "GitProvider" NOT NULL,
  "pipelineName" TEXT NOT NULL,
  "externalPipelineId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "pipelines_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories" ("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "pipelines_repositoryId_externalPipelineId_key" ON "pipelines"("repositoryId", "externalPipelineId");
CREATE INDEX "pipelines_repositoryId_idx" ON "pipelines"("repositoryId");

-- ─── PIPELINE RUNS TABLE ───

CREATE TABLE "pipeline_runs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "pipelineId" TEXT NOT NULL,
  "runNumber" INTEGER NOT NULL,
  "status" "PipelineStatus" NOT NULL,
  "conclusion" TEXT,
  "branch" TEXT,
  "triggeredBy" TEXT,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "externalUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "pipeline_runs_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "pipelines" ("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "pipeline_runs_pipelineId_runNumber_key" ON "pipeline_runs"("pipelineId", "runNumber");
CREATE INDEX "pipeline_runs_pipelineId_status_idx" ON "pipeline_runs"("pipelineId", "status");
CREATE INDEX "pipeline_runs_pipelineId_completedAt_idx" ON "pipeline_runs"("pipelineId", "completedAt" DESC);

-- ─── DEPLOYMENTS TABLE ───

CREATE TABLE "deployments" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "environmentId" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "deployedBy" TEXT,
  "deploymentStatus" "DeploymentStatus" NOT NULL DEFAULT 'PENDING',
  "deploymentTime" TIMESTAMP(3),
  "commitSha" TEXT,
  "releaseNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "deployments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects" ("id") ON DELETE CASCADE,
  CONSTRAINT "deployments_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environments" ("id") ON DELETE RESTRICT,
  CONSTRAINT "deployments_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories" ("id") ON DELETE RESTRICT,
  CONSTRAINT "deployments_deployedBy_fkey" FOREIGN KEY ("deployedBy") REFERENCES "users" ("id") ON DELETE SET NULL
);

CREATE INDEX "deployments_projectId_idx" ON "deployments"("projectId");
CREATE INDEX "deployments_environmentId_createdAt_idx" ON "deployments"("environmentId", "createdAt" DESC);
CREATE INDEX "deployments_repositoryId_idx" ON "deployments"("repositoryId");

-- ─── RELEASES TABLE ───

CREATE TABLE "releases" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "repositoryId" TEXT NOT NULL,
  "releaseTag" TEXT NOT NULL,
  "releaseName" TEXT,
  "releaseNotes" TEXT,
  "publishedAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "releases_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories" ("id") ON DELETE CASCADE,
  CONSTRAINT "releases_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users" ("id") ON DELETE SET NULL
);

CREATE UNIQUE INDEX "releases_repositoryId_releaseTag_key" ON "releases"("repositoryId", "releaseTag");
CREATE INDEX "releases_repositoryId_publishedAt_idx" ON "releases"("repositoryId", "publishedAt" DESC);
