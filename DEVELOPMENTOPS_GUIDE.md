# DevelopmentOps Module - Implementation Guide

## Overview

The DevelopmentOps module is a production-level engineering operations dashboard integrated into Command Central. It enables teams to:

- Connect and manage Git repositories
- Track repository activities (commits, PRs, releases)
- Monitor CI/CD pipelines
- Manage deployment environments
- Track deployments and releases
- Link engineering activities to project tasks

## Architecture

### Database Schema

**Location**: `backend/prisma/schema.prisma` and `backend/prisma/migrations/20260528000000_add_developmentops_module/`

**Core Models**:
- `Repository` - Git repository connections
- `RepositoryActivity` - Tracked activities (commits, PRs, branches, releases)
- `LinkedTask` - Mapping between activities and project tasks
- `Environment` - Deployment environments (Dev, Staging, Prod)
- `Pipeline` - CI/CD workflows
- `PipelineRun` - Individual pipeline execution
- `Deployment` - Deployment records
- `Release` - Release versions

**Key Relationships**:
- Project → many Repositories
- Repository → many Activities, Pipelines, Deployments, Releases
- Activity → many LinkedTasks (cross-module visibility)
- Environment → many Deployments

### Backend Architecture

**Service Layer** (`backend/src/services/`):
- `devops.repository.service.ts` - Repository CRUD and management
- `devops.provider.service.ts` - Git provider abstraction (GitHub, GitLab, Bitbucket)
- `devops.activities.service.ts` - Activity syncing and linking
- `devops.environment.service.ts` - Environment management
- `devops.pipeline.service.ts` - Pipeline and run tracking
- `devops.deployment.service.ts` - Deployment management
- `devops.deployment.service.ts` - Release tracking (same file)

**API Routes** (`backend/src/routes/devops.routes.ts`):
- Repository management endpoints
- Activity sync and retrieval
- Environment CRUD
- Pipeline management
- Deployment tracking
- Release management
- Overview dashboard

**Handlers** (`backend/src/handlers/devops.handler.ts`):
- Request handling and response formatting
- Error handling
- Status code management

**Validators** (`backend/src/validators/devops.schema.ts`):
- Input validation using Zod
- Type definitions
- Request/response schemas

### Frontend Architecture

**Hooks** (`frontend/src/hooks/useDevOps.ts`):
- React Query hooks for all API calls
- Automatic cache invalidation
- Loading and error states

**Components** (`frontend/src/components/devops/`):
- `DevelopmentOpsTab.tsx` - Main tab component
- `StatusBadges.tsx` - Status indicators and badges
- `RepositoryConnectionDialog.tsx` - Repository connection UI
- `EnvironmentManagementDialog.tsx` - Environment creation UI

**Integration**:
- Added to ProjectDetailPage tabs
- Appears after "Decisions" tab
- Full project access control

## API Endpoints

### Repositories
```
POST   /projects/:projectId/devops/repositories
GET    /projects/:projectId/devops/repositories
GET    /devops/repositories/:repositoryId
PATCH  /devops/repositories/:repositoryId
DELETE /devops/repositories/:repositoryId
```

### Activities
```
POST   /devops/repositories/:repositoryId/sync
GET    /devops/repositories/:repositoryId/activities
GET    /projects/:projectId/devops/activities
GET    /devops/activities/:activityId
POST   /devops/activities/:activityId/link-task
POST   /devops/activities/:activityId/unlink-task
GET    /devops/activities/:activityId/linked-tasks
```

### Environments
```
POST   /projects/:projectId/devops/environments
GET    /projects/:projectId/devops/environments
GET    /projects/:projectId/devops/environments/with-status
GET    /devops/environments/:environmentId
PATCH  /devops/environments/:environmentId
DELETE /devops/environments/:environmentId
```

### Pipelines
```
POST   /devops/repositories/:repositoryId/pipelines
GET    /devops/repositories/:repositoryId/pipelines
GET    /devops/pipelines/:pipelineId
POST   /devops/pipelines/:pipelineId/runs
GET    /devops/pipelines/:pipelineId/runs
GET    /devops/pipelines/:pipelineId/latest-run
PATCH  /devops/pipelines/:pipelineId/runs/:runId
```

### Deployments
```
POST   /projects/:projectId/devops/repositories/:repositoryId/deployments
GET    /devops/environments/:environmentId/deployments
GET    /projects/:projectId/devops/deployments
PATCH  /devops/deployments/:deploymentId/status
```

### Releases
```
POST   /devops/repositories/:repositoryId/releases
GET    /devops/repositories/:repositoryId/releases
GET    /projects/:projectId/devops/latest-releases
```

### Overview
```
GET    /projects/:projectId/devops/overview
```

## Usage Examples

### Connecting a GitHub Repository

```typescript
// Frontend
const createRepo = useCreateRepository(projectId);

await createRepo.mutateAsync({
  provider: 'GITHUB',
  repoOwner: 'octocat',
  repoName: 'Hello-World',
  repoUrl: 'https://github.com/octocat/Hello-World',
  accessToken: 'ghp_xxx', // Optional, for private repos
  defaultBranch: 'main',
  isPrivate: false,
});
```

### Syncing Repository Activities

```typescript
const syncActivities = useSyncActivities(repositoryId);
await syncActivities.mutateAsync();
```

### Creating an Environment

```typescript
const createEnv = useCreateEnvironment(projectId);

await createEnv.mutateAsync({
  name: 'Production',
  type: 'PRODUCTION',
  branchName: 'main',
  deploymentUrl: 'https://prod.example.com',
  description: 'Production environment',
});
```

### Linking Activity to Task

```typescript
const linkActivity = useLinkActivityToTask(activityId);
await linkActivity.mutateAsync(taskId);
```

## Security & Permissions

### Role-Based Access Control
- `devops.read` - View all DevelopmentOps data
- `devops.manage` - Create, update, delete resources
- `devops.admin` - Full administrative access

### Token Handling
- Access tokens are stored encrypted in the database
- Never exposed in API responses
- Retrieved only when making provider API calls
- Users should create GitHub tokens with minimal required scopes

### Project Isolation
- All endpoints require project access validation
- Activities, environments, and deployments are scoped to projects
- Repositories are linked to specific projects

## GitHub Integration Details

### Supported Events
- Commits (push events)
- Pull Requests (open, merged, closed)
- Branches (creation detection)
- Releases (published)
- Workflow Runs (queued, running, success, failed)

### Rate Limiting
- GitHub API rate limit: 60 requests/hour (unauthenticated) or 5000/hour (authenticated)
- Implement exponential backoff for retries
- Check rate limit status before syncing

### Token Scopes
Minimal required scopes for GitHub token:
- `public_repo` - For public repositories
- `repo` - For private repositories (includes public_repo)
- `workflow` - For reading workflow runs

## Future Enhancements (Phase 2 & 3)

### GitLab Integration
- GitLab API integration
- GitLab CI/CD pipeline support
- GitLab webhook support

### Bitbucket Integration
- Bitbucket Cloud API
- Bitbucket Pipeline integration

### Automated Workflows
- Background polling for repository updates
- Automatic task creation from PR/commits
- Deployment webhooks integration

### Advanced Features
- Environment health monitoring
- Deployment rollback tracking
- Build artifact storage
- Deployment approval workflows
- Custom notification rules

### Analytics
- Deployment frequency metrics
- Lead time tracking
- Pipeline success rates
- Release velocity

## Testing

### Unit Tests
```bash
cd backend
npm run test
```

### Integration Tests
```bash
npm run test:real-db
```

### E2E Tests
```bash
cd frontend
npm run test:e2e
```

## Troubleshooting

### Repository Connection Issues
1. Verify repository owner/name are correct
2. Check GitHub token has correct scopes
3. Ensure GitHub API is accessible from backend
4. Check rate limit status

### Activity Sync Issues
1. Verify repository still exists on GitHub
2. Check access token validity
3. Check network connectivity
4. Look for error logs in backend

### Task Linking Issues
1. Verify activity and task exist
2. Check project access permissions
3. Verify activity is from correct repository

## Configuration

### Environment Variables
```env
# GitHub API base URL (default: https://api.github.com)
GITHUB_API_URL=https://api.github.com

# GitHub webhook timeout (default: 30000ms)
GITHUB_WEBHOOK_TIMEOUT=30000

# Max activities per sync (default: 100)
MAX_ACTIVITIES_PER_SYNC=100
```

## Performance Considerations

### Database Indexes
- Queries on `repositoryId` and `createdAt` are indexed
- Project-scoped queries have composite indexes
- Activity uniqueness constraint on (repositoryId, externalId)

### Caching Strategy
- React Query caches all API responses
- Automatic invalidation on mutations
- 5-minute stale time for non-critical data

### API Response Pagination
- Default limit: 50 items
- Maximum limit: 100 items
- Offset-based pagination

## File Structure

```
backend/src/
├── services/
│   ├── devops.repository.service.ts
│   ├── devops.provider.service.ts
│   ├── devops.activities.service.ts
│   ├── devops.environment.service.ts
│   ├── devops.pipeline.service.ts
│   └── devops.deployment.service.ts
├── handlers/
│   └── devops.handler.ts
├── routes/
│   └── devops.routes.ts
└── validators/
    └── devops.schema.ts

frontend/src/
├── components/devops/
│   ├── DevelopmentOpsTab.tsx
│   ├── StatusBadges.tsx
│   ├── RepositoryConnectionDialog.tsx
│   └── EnvironmentManagementDialog.tsx
├── hooks/
│   └── useDevOps.ts
└── pages/
    └── admin/ProjectDetailPage.tsx (updated)

backend/prisma/
├── schema.prisma (updated)
└── migrations/
    └── 20260528000000_add_developmentops_module/
        └── migration.sql
```

## Maintenance

### Database Cleanup
- Remove old pipeline runs periodically (>90 days)
- Archive old activities and deployments
- Clean up unused repositories

### Token Rotation
- Rotate GitHub tokens every 90 days
- Monitor token usage for security
- Remove access for inactive projects

### Monitoring
- Track API performance metrics
- Monitor GitHub API rate limit usage
- Alert on sync failures
- Log all permission changes

## Support & Documentation

For questions or issues:
1. Check this guide
2. Review API endpoint documentation
3. Check GitHub Issues
4. Contact engineering team

## Version History

- **v1.0.0** (2026-05-28)
  - Initial release
  - GitHub integration
  - Repository management
  - Activity tracking
  - Environment management
  - Pipeline tracking
  - Deployment monitoring
  - Release management
