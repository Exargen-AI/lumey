import prisma from '../config/database';
import {
  RepositoryActivity as PrismaRepositoryActivity,
  RepositoryActivityType,
  PipelineStatus,
} from '@prisma/client';
import { NotFoundError } from '../utils/errors';
import { GitProviderFactory } from './devops.provider.service';
import { RepositoryService } from './devops.repository.service';

export interface RepositoryActivityDTO {
  id: string;
  projectId: string;
  repositoryId: string;
  activityType: RepositoryActivityType;
  title: string;
  description?: string;
  authorName?: string;
  branchName?: string;
  activityUrl?: string;
  metadata: Record<string, any>;
  createdAt: Date;
}

export interface ActivityWithLink extends RepositoryActivityDTO {
  linkedTaskIds: string[];
}

/**
 * Repository activity tracking service
 * Handles fetching, storing, and managing repository activities
 */
export class DevOpsActivityService {
  constructor(private repositoryService: RepositoryService) {}

  /**
   * Fetch and sync repository activities from provider
   */
  async syncRepositoryActivities(
    repositoryId: string,
    _userId: string,
  ): Promise<RepositoryActivityDTO[]> {
    const repository = await prisma.repository.findUnique({
      where: { id: repositoryId },
      select: {
        id: true,
        provider: true,
        repoOwner: true,
        repoName: true,
        defaultBranch: true,
        projectId: true,
      },
    });

    if (!repository) {
      throw new NotFoundError('Repository not found');
    }

    const accessToken = await this.repositoryService.getAccessToken(repositoryId);
    const provider = GitProviderFactory.getProvider(repository.provider, accessToken || undefined);

    // Fetch the last activity timestamp to avoid re-processing
    const lastActivity = await prisma.repositoryActivity.findFirst({
      where: { repositoryId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });

    const since = lastActivity?.createdAt;

    // Fetch activities from provider
    const [commits, pullRequests, releases, branches, workflowRuns] = await Promise.all([
      provider.getCommits(repository.repoOwner, repository.repoName, repository.defaultBranch, since),
      provider.getPullRequests(repository.repoOwner, repository.repoName, 'all', since),
      provider.getReleases(repository.repoOwner, repository.repoName, since),
      provider.getBranches(repository.repoOwner, repository.repoName),
      provider.getWorkflowRuns(repository.repoOwner, repository.repoName, since),
    ]);

    const activities: RepositoryActivityDTO[] = [];

    // Process commits
    for (const commit of commits) {
      const activity = await this.createOrUpdateActivity(repository.projectId, repositoryId, {
        activityType: 'COMMIT' as RepositoryActivityType,
        externalId: commit.sha,
        title: commit.message.split('\n')[0],
        description: commit.message,
        authorName: commit.author,
        branchName: repository.defaultBranch,
        activityUrl: commit.url,
        metadata: { sha: commit.sha },
      });
      activities.push(activity);
    }

    // Process pull requests
    for (const pr of pullRequests) {
      const activityType: RepositoryActivityType = pr.merged ? 'PR_MERGED' : 'PR_OPENED';
      const activity = await this.createOrUpdateActivity(repository.projectId, repositoryId, {
        activityType,
        externalId: `pr-${pr.number}`,
        title: `PR #${pr.number}: ${pr.title}`,
        description: pr.body,
        authorName: pr.user,
        activityUrl: pr.url,
        metadata: {
          prNumber: pr.number,
          state: pr.state,
          merged: pr.merged,
        },
      });
      activities.push(activity);
    }

    // Process releases
    for (const release of releases) {
      const activity = await this.createOrUpdateActivity(repository.projectId, repositoryId, {
        activityType: 'RELEASE_PUBLISHED' as RepositoryActivityType,
        externalId: release.tagName,
        title: `Release ${release.tagName}${release.name ? `: ${release.name}` : ''}`,
        description: release.body,
        activityUrl: release.url,
        metadata: { tagName: release.tagName },
      });
      activities.push(activity);
    }

    // Process new branches
    const newBranches = branches.filter(b => b.name !== repository.defaultBranch);
    for (const branch of newBranches) {
      // Only create activity if it's new (not in our database yet)
      const existing = await prisma.repositoryActivity.findUnique({
        where: {
          repositoryId_externalId: {
            repositoryId,
            externalId: `branch-${branch.name}`,
          },
        },
      });

      if (!existing) {
        const activity = await this.createOrUpdateActivity(repository.projectId, repositoryId, {
          activityType: 'BRANCH_CREATED' as RepositoryActivityType,
          externalId: `branch-${branch.name}`,
          title: `Branch created: ${branch.name}`,
          branchName: branch.name,
          activityUrl: branch.commit.url,
          metadata: { branchName: branch.name, sha: branch.commit.sha },
        });
        activities.push(activity);
      }
    }

    // Persist workflow runs as pipelines and pipeline run history
    for (const run of workflowRuns) {
      const pipelineKey = `${run.workflow_id}`;
      const pipeline = await prisma.pipeline.upsert({
        where: {
          repositoryId_externalPipelineId: {
            repositoryId,
            externalPipelineId: pipelineKey,
          },
        },
        update: {
          pipelineName: run.name || run.path || `Workflow ${run.workflow_id}`,
        },
        create: {
          repositoryId,
          provider: repository.provider,
          pipelineName: run.name || run.path || `Workflow ${run.workflow_id}`,
          externalPipelineId: pipelineKey,
        },
      });

      const runNumber = run.run_number || run.id;
      const status = this.mapWorkflowRunStatus(run.status, run.conclusion);

      const existingRun = await prisma.pipelineRun.findUnique({
        where: {
          pipelineId_runNumber: {
            pipelineId: pipeline.id,
            runNumber,
          },
        },
      });

      if (!existingRun) {
        await prisma.pipelineRun.create({
          data: {
            pipelineId: pipeline.id,
            runNumber,
            status,
            conclusion: run.conclusion,
            branch: run.head_branch,
            triggeredBy: run.triggered_by?.login || run.actor?.login || undefined,
            startedAt: run.run_started_at ? new Date(run.run_started_at) : undefined,
            completedAt: run.updated_at ? new Date(run.updated_at) : undefined,
            externalUrl: run.html_url,
          },
        });
      }
    }

    // Persist releases in the release table so the Releases tab can reflect GitHub tags
    for (const release of releases) {
      await prisma.release.upsert({
        where: {
          repositoryId_releaseTag: {
            repositoryId,
            releaseTag: release.tagName,
          },
        },
        update: {
          releaseName: release.name,
          releaseNotes: release.body,
          publishedAt: release.publishedAt ? new Date(release.publishedAt) : undefined,
        },
        create: {
          repositoryId,
          releaseTag: release.tagName,
          releaseName: release.name,
          releaseNotes: release.body,
          publishedAt: release.publishedAt ? new Date(release.publishedAt) : undefined,
        },
      });
    }

    return activities.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Create or update repository activity
   */
  private async createOrUpdateActivity(
    projectId: string,
    repositoryId: string,
    data: {
      activityType: RepositoryActivityType;
      externalId: string;
      title: string;
      description?: string;
      authorName?: string;
      branchName?: string;
      activityUrl?: string;
      metadata: Record<string, any>;
    },
  ): Promise<RepositoryActivityDTO> {
    const activity = await prisma.repositoryActivity.upsert({
      where: {
        repositoryId_externalId: {
          repositoryId,
          externalId: data.externalId,
        },
      },
      update: {
        // Don't update existing records
      },
      create: {
        projectId,
        repositoryId,
        activityType: data.activityType,
        externalId: data.externalId,
        title: data.title,
        description: data.description,
        authorName: data.authorName,
        branchName: data.branchName,
        activityUrl: data.activityUrl,
        metadataJson: data.metadata,
      },
    });

    return this.mapToDTO(activity);
  }

  private mapWorkflowRunStatus(status: string, conclusion?: string): PipelineStatus {
    if (status === 'queued') return 'QUEUED';
    if (status === 'in_progress') return 'RUNNING';
    if (status === 'completed') {
      if (conclusion === 'success') return 'SUCCESS';
      if (conclusion === 'failure') return 'FAILED';
      if (conclusion === 'cancelled') return 'CANCELLED';
      return 'FAILED';
    }
    return 'QUEUED';
  }

  /**
   * Get activity by ID
   */
  async getActivity(activityId: string): Promise<RepositoryActivityDTO> {
    const activity = await prisma.repositoryActivity.findUnique({
      where: { id: activityId },
    });

    if (!activity) {
      throw new NotFoundError('Activity not found');
    }

    return this.mapToDTO(activity);
  }

  /**
   * List activities for a repository
   */
  async listActivities(
    repositoryId: string,
    options?: {
      limit?: number;
      offset?: number;
      type?: RepositoryActivityType;
    },
  ): Promise<RepositoryActivityDTO[]> {
    const activities = await prisma.repositoryActivity.findMany({
      where: {
        repositoryId,
        ...(options?.type && { activityType: options.type }),
      },
      orderBy: { createdAt: 'desc' },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
    });

    return activities.map(a => this.mapToDTO(a));
  }

  /**
   * Get activities for a project
   */
  async listProjectActivities(
    projectId: string,
    options?: {
      limit?: number;
      offset?: number;
    },
  ): Promise<ActivityWithLink[]> {
    const activities = await prisma.repositoryActivity.findMany({
      where: { projectId },
      include: {
        linkedTasks: {
          select: { taskId: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: options?.limit ?? 100,
      skip: options?.offset ?? 0,
    });

    return activities.map(a => ({
      ...this.mapToDTO(a),
      linkedTaskIds: a.linkedTasks.map(lt => lt.taskId),
    }));
  }

  /**
   * Link activity to a task
   */
  async linkActivityToTask(activityId: string, taskId: string): Promise<void> {
    const activity = await prisma.repositoryActivity.findUnique({
      where: { id: activityId },
    });

    if (!activity) {
      throw new NotFoundError('Activity not found');
    }

    // Check if task exists
    const task = await prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task) {
      throw new NotFoundError('Task not found');
    }

    // Create the link
    await prisma.linkedTask.upsert({
      where: {
        repositoryActivityId_taskId: {
          repositoryActivityId: activityId,
          taskId,
        },
      },
      update: {},
      create: {
        repositoryActivityId: activityId,
        taskId,
      },
    });
  }

  /**
   * Unlink activity from task
   */
  async unlinkActivityFromTask(activityId: string, taskId: string): Promise<void> {
    await prisma.linkedTask.deleteMany({
      where: {
        repositoryActivityId: activityId,
        taskId,
      },
    });
  }

  /**
   * Get linked tasks for an activity
   */
  async getLinkedTasks(activityId: string): Promise<string[]> {
    const links = await prisma.linkedTask.findMany({
      where: { repositoryActivityId: activityId },
      select: { taskId: true },
    });

    return links.map(l => l.taskId);
  }

  /**
   * Map to DTO
   */
  private mapToDTO(activity: PrismaRepositoryActivity): RepositoryActivityDTO {
    return {
      id: activity.id,
      projectId: activity.projectId,
      repositoryId: activity.repositoryId,
      activityType: activity.activityType,
      title: activity.title,
      description: activity.description || undefined,
      authorName: activity.authorName || undefined,
      branchName: activity.branchName || undefined,
      activityUrl: activity.activityUrl || undefined,
      metadata: activity.metadataJson as Record<string, any>,
      createdAt: activity.createdAt,
    };
  }
}

export const devOpsActivityService = new DevOpsActivityService(new RepositoryService());
