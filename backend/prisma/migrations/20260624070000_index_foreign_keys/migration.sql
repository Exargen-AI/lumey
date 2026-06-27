-- CreateIndex
CREATE INDEX "project_documents_uploadedById_idx" ON "project_documents"("uploadedById");

-- CreateIndex
CREATE INDEX "tasks_creatorId_idx" ON "tasks"("creatorId");

-- CreateIndex
CREATE INDEX "tasks_reviewRequestedById_idx" ON "tasks"("reviewRequestedById");

-- CreateIndex
CREATE INDEX "task_links_createdById_idx" ON "task_links"("createdById");

-- CreateIndex
CREATE INDEX "task_nudges_senderId_idx" ON "task_nudges"("senderId");

-- CreateIndex
CREATE INDEX "decisions_createdById_idx" ON "decisions"("createdById");

-- CreateIndex
CREATE INDEX "deliverables_signedOffById_idx" ON "deliverables"("signedOffById");

-- CreateIndex
CREATE INDEX "comments_authorId_idx" ON "comments"("authorId");

-- CreateIndex
CREATE INDEX "comments_milestoneId_idx" ON "comments"("milestoneId");

-- CreateIndex
CREATE INDEX "status_updates_authorId_idx" ON "status_updates"("authorId");

-- CreateIndex
CREATE INDEX "daily_update_tasks_dailyUpdateId_idx" ON "daily_update_tasks"("dailyUpdateId");

-- CreateIndex
CREATE INDEX "daily_update_tasks_taskId_idx" ON "daily_update_tasks"("taskId");

-- CreateIndex
CREATE INDEX "role_permissions_permissionId_idx" ON "role_permissions"("permissionId");

