-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'CLOSED');

-- DropForeignKey
ALTER TABLE "cms_blogs" DROP CONSTRAINT "cms_blogs_authorId_fkey";

-- DropForeignKey
ALTER TABLE "cms_blogs" DROP CONSTRAINT "cms_blogs_projectId_fkey";

-- DropForeignKey
ALTER TABLE "cms_blogs" DROP CONSTRAINT "cms_blogs_templateId_fkey";

-- DropForeignKey
ALTER TABLE "cms_media_assets" DROP CONSTRAINT "cms_media_assets_projectId_fkey";

-- DropForeignKey
ALTER TABLE "cms_templates" DROP CONSTRAINT "cms_templates_projectId_fkey";

-- DropForeignKey
ALTER TABLE "deployments" DROP CONSTRAINT "deployments_deployedBy_fkey";

-- DropForeignKey
ALTER TABLE "deployments" DROP CONSTRAINT "deployments_environmentId_fkey";

-- DropForeignKey
ALTER TABLE "deployments" DROP CONSTRAINT "deployments_projectId_fkey";

-- DropForeignKey
ALTER TABLE "deployments" DROP CONSTRAINT "deployments_repositoryId_fkey";

-- DropForeignKey
ALTER TABLE "device_enrollment_tokens" DROP CONSTRAINT "device_enrollment_tokens_issuedByUserId_fkey";

-- DropForeignKey
ALTER TABLE "environments" DROP CONSTRAINT "environments_projectId_fkey";

-- DropForeignKey
ALTER TABLE "leave_requests" DROP CONSTRAINT "leave_requests_applicantId_fkey";

-- DropForeignKey
ALTER TABLE "leave_requests" DROP CONSTRAINT "leave_requests_decidedById_fkey";

-- DropForeignKey
ALTER TABLE "linked_tasks" DROP CONSTRAINT "linked_tasks_repositoryActivityId_fkey";

-- DropForeignKey
ALTER TABLE "linked_tasks" DROP CONSTRAINT "linked_tasks_taskId_fkey";

-- DropForeignKey
ALTER TABLE "pipeline_runs" DROP CONSTRAINT "pipeline_runs_pipelineId_fkey";

-- DropForeignKey
ALTER TABLE "pipelines" DROP CONSTRAINT "pipelines_repositoryId_fkey";

-- DropForeignKey
ALTER TABLE "releases" DROP CONSTRAINT "releases_createdBy_fkey";

-- DropForeignKey
ALTER TABLE "releases" DROP CONSTRAINT "releases_repositoryId_fkey";

-- DropForeignKey
ALTER TABLE "repositories" DROP CONSTRAINT "repositories_createdBy_fkey";

-- DropForeignKey
ALTER TABLE "repositories" DROP CONSTRAINT "repositories_projectId_fkey";

-- DropForeignKey
ALTER TABLE "repository_activities" DROP CONSTRAINT "repository_activities_projectId_fkey";

-- DropForeignKey
ALTER TABLE "repository_activities" DROP CONSTRAINT "repository_activities_repositoryId_fkey";

-- DropForeignKey
ALTER TABLE "task_links" DROP CONSTRAINT "task_links_createdById_fkey";

-- DropIndex
DROP INDEX "device_health_snapshots_batteryPercent_idx";

-- DropIndex
DROP INDEX "device_health_snapshots_diskFreePercent_idx";

-- DropIndex
DROP INDEX "device_health_snapshots_tamperProcessCount_idx";

-- AlterTable
ALTER TABLE "cms_content_projects" ADD COLUMN     "apiKeyScopes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "website" TEXT,
    "formType" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "company" TEXT,
    "message" TEXT,
    "sourcePage" TEXT,
    "metadata" JSONB,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "leads_projectId_email_idx" ON "leads"("projectId", "email");

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_links" ADD CONSTRAINT "task_links_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "cms_content_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms_templates" ADD CONSTRAINT "cms_templates_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "cms_content_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms_blogs" ADD CONSTRAINT "cms_blogs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "cms_content_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms_blogs" ADD CONSTRAINT "cms_blogs_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "cms_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms_blogs" ADD CONSTRAINT "cms_blogs_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cms_media_assets" ADD CONSTRAINT "cms_media_assets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "cms_content_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repository_activities" ADD CONSTRAINT "repository_activities_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repository_activities" ADD CONSTRAINT "repository_activities_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linked_tasks" ADD CONSTRAINT "linked_tasks_repositoryActivityId_fkey" FOREIGN KEY ("repositoryActivityId") REFERENCES "repository_activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "linked_tasks" ADD CONSTRAINT "linked_tasks_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "environments" ADD CONSTRAINT "environments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "pipelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_environmentId_fkey" FOREIGN KEY ("environmentId") REFERENCES "environments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_deployedBy_fkey" FOREIGN KEY ("deployedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "releases" ADD CONSTRAINT "releases_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "releases" ADD CONSTRAINT "releases_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_enrollment_tokens" ADD CONSTRAINT "device_enrollment_tokens_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "employee_productivity_scores_window_key" RENAME TO "employee_productivity_scores_userId_windowStart_windowEnd_c_key";

-- RenameIndex
ALTER INDEX "productivity_events_dedupe_key" RENAME TO "productivity_events_source_sourceId_eventType_key";
