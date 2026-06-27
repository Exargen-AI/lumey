# Schema audit (2026-06)

A health check of `backend/prisma/schema.prisma` (34 models, 24 enums).

## Verdict: already lean — no dead or redundant models

Every model was cross-checked against the codebase (including transaction `tx.`
and nested-relation access that a naïve `prisma.<model>` grep misses). **All 34
are wired to live routes/services.** The earlier 73→30 lean-down removed the
truly-dead structures; what remains is *feature scope*, not redundancy.

### The model landscape, by domain

| Domain | Models |
|---|---|
| **Agent runtime** | `AgentRun` · `RunStep` · `RunEvent` · `AgentMemory` · `IdempotencyKey` |
| **Tasks / kanban** | `Task` · `Comment` · `TaskLink` · `TaskExternalLink` · `TaskSubscription` · `TaskNudge` · `TaskStatusHistory` |
| **Identity / RBAC** | `User` · `RefreshToken` · `Permission` · `RolePermission` · `NotificationPreference` |
| **Projects** | `Project` · `Product` · `ProjectMember` · `ProjectDocument` · `ProjectGitHubIntegration` |
| **PM layer** | `Sprint` · `Epic` · `Milestone` · `Decision` · `Deliverable` |
| **Client portal / standups** | `ProjectAcknowledgment` · `StatusUpdate` · `DailyUpdate` · `DailyUpdateTask` |
| **Cross-cutting** | `Activity` · `Notification` · `CustomFieldDefinition` |

## Done ✅ — index the foreign keys (efficiency, no feature loss)

Postgres does **not** auto-index foreign-key columns, so unindexed FKs cause slow
joins **and slow cascade-deletes** (the child table is scanned on parent delete).
A scan found **13** unindexed FK columns; all were indexed (migration
`20260624070000_index_foreign_keys`):

`ProjectDocument.uploadedById` · `Task.creatorId` · `Task.reviewRequestedById` ·
`TaskLink.createdById` · `TaskNudge.senderId` · `Decision.createdById` ·
`Deliverable.signedOffById` · `Comment.authorId` · `Comment.milestoneId` ·
`StatusUpdate.authorId` · `DailyUpdateTask.dailyUpdateId` ·
`DailyUpdateTask.taskId` · `RolePermission.permissionId`.

Re-scan: **0 unindexed FK columns remain.**

## Deferred (a product decision, not a cleanup)

These need *your* call because they remove live features + data, so they're noted
here rather than done:

- **Scope reduction to a lean agentic core (~34 → ~21 models).** The PM layer
  (`Epic`, `Milestone`, `Sprint`) and client-portal models (`Decision`,
  `Deliverable`, `ProjectAcknowledgment`, `Product`, `DailyUpdate`/`DailyUpdateTask`,
  `StatusUpdate`, `CustomFieldDefinition`, `TaskNudge`) are real, wired features —
  dropping them shrinks the schema but deletes capability + data. Irreversible.
- **Lossy consolidation.** `TaskStatusHistory` and `DailyUpdateTask.statusBefore/
  After` overlap the generic `Activity` log, but they're *typed, indexed* tables
  for status-timeline / cycle-time queries; folding them into `Activity(details
  JSON)` saves ~2 models at the cost of query type-safety and speed.

Revisit when the product scope is settled.
