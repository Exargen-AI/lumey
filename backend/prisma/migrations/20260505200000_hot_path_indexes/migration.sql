-- Hot-path indexes for queries that show up on every authenticated request.

-- ProjectMember.projectId — projectAccess middleware fetches by (projectId)
-- to verify membership, but the only existing index was the (userId, projectId)
-- unique whose leading column is userId. CONCURRENTLY would be ideal in prod
-- but Prisma migrate doesn't allow it inside a transaction.
CREATE INDEX "project_members_projectId_idx" ON "project_members"("projectId");

-- Task.(projectId, assigneeId) — engineer-dashboard "my tasks in project X"
-- query. Bare assigneeId index works but Postgres filters projectId post-fetch.
CREATE INDEX "tasks_projectId_assigneeId_idx" ON "tasks"("projectId", "assigneeId");
