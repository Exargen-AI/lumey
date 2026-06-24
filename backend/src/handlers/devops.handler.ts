import { Request, Response, NextFunction } from 'express';
import { repositoryService } from '../services/devops.repository.service';
import { devOpsActivityService } from '../services/devops.activities.service';
import { environmentService } from '../services/devops.environment.service';
import { pipelineService } from '../services/devops.pipeline.service';
import { deploymentService, releaseService } from '../services/devops.deployment.service';

// ─── REPOSITORY HANDLERS ───

export async function createRepositoryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = req.params.projectId;
    const result = await repositoryService.createRepository(projectId, req.user!.id, req.body);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function listRepositoriesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = req.params.projectId;
    const repositories = await repositoryService.listRepositories(projectId);
    res.json({ success: true, data: repositories });
  } catch (err) {
    next(err);
  }
}

export async function getRepositoryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await repositoryService.getRepository(req.params.repositoryId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function updateRepositoryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await repositoryService.updateRepository(req.params.repositoryId, req.body);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function deleteRepositoryHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await repositoryService.deleteRepository(req.params.repositoryId);
    res.json({ success: true, data: { message: 'Repository deleted' } });
  } catch (err) {
    next(err);
  }
}

// ─── ACTIVITY HANDLERS ───

export async function syncRepositoryActivitiesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const repositoryId = req.params.repositoryId;
    const activities = await devOpsActivityService.syncRepositoryActivities(repositoryId, req.user!.id);
    res.json({ success: true, data: { activities, count: activities.length } });
  } catch (err) {
    next(err);
  }
}

export async function listActivitiesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const repositoryId = req.params.repositoryId;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
    const type = req.query.type as any;

    const activities = await devOpsActivityService.listActivities(repositoryId, {
      limit,
      offset,
      type,
    });
    res.json({ success: true, data: activities });
  } catch (err) {
    next(err);
  }
}

export async function listProjectActivitiesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = req.params.projectId;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

    const activities = await devOpsActivityService.listProjectActivities(projectId, {
      limit,
      offset,
    });
    res.json({ success: true, data: activities });
  } catch (err) {
    next(err);
  }
}

export async function getActivityHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const activity = await devOpsActivityService.getActivity(req.params.activityId);
    res.json({ success: true, data: activity });
  } catch (err) {
    next(err);
  }
}

export async function linkActivityToTaskHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const activityId = req.params.activityId;
    const taskId = req.body.taskId;
    await devOpsActivityService.linkActivityToTask(activityId, taskId);
    res.json({ success: true, data: { message: 'Activity linked to task' } });
  } catch (err) {
    next(err);
  }
}

export async function unlinkActivityFromTaskHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const activityId = req.params.activityId;
    const taskId = req.body.taskId;
    await devOpsActivityService.unlinkActivityFromTask(activityId, taskId);
    res.json({ success: true, data: { message: 'Activity unlinked from task' } });
  } catch (err) {
    next(err);
  }
}

export async function getLinkedTasksHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const activityId = req.params.activityId;
    const taskIds = await devOpsActivityService.getLinkedTasks(activityId);
    res.json({ success: true, data: { taskIds } });
  } catch (err) {
    next(err);
  }
}

// ─── ENVIRONMENT HANDLERS ───

export async function createEnvironmentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = req.params.projectId;
    const result = await environmentService.createEnvironment(projectId, req.body);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function listEnvironmentsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = req.params.projectId;
    const environments = await environmentService.listEnvironments(projectId);
    res.json({ success: true, data: environments });
  } catch (err) {
    next(err);
  }
}

export async function getEnvironmentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await environmentService.getEnvironment(req.params.environmentId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function updateEnvironmentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await environmentService.updateEnvironment(req.params.environmentId, req.body);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function deleteEnvironmentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    await environmentService.deleteEnvironment(req.params.environmentId);
    res.json({ success: true, data: { message: 'Environment deleted' } });
  } catch (err) {
    next(err);
  }
}

export async function getEnvironmentsWithStatusHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = req.params.projectId;
    const environments = await environmentService.getEnvironmentsWithStatus(projectId);
    res.json({ success: true, data: environments });
  } catch (err) {
    next(err);
  }
}

// ─── PIPELINE HANDLERS ───

export async function createPipelineHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const repositoryId = req.params.repositoryId;
    const result = await pipelineService.createPipeline(repositoryId, req.body);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function listPipelinesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const repositoryId = req.params.repositoryId;
    const pipelines = await pipelineService.listPipelines(repositoryId);
    res.json({ success: true, data: pipelines });
  } catch (err) {
    next(err);
  }
}

export async function getPipelineHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pipelineService.getPipeline(req.params.pipelineId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function createPipelineRunHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const pipelineId = req.params.pipelineId;
    const result = await pipelineService.createPipelineRun(pipelineId, req.body);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function listPipelineRunsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const pipelineId = req.params.pipelineId;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
    const runs = await pipelineService.listPipelineRuns(pipelineId, { limit, offset });
    res.json({ success: true, data: runs });
  } catch (err) {
    next(err);
  }
}

export async function getPipelineRunHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pipelineService.getPipelineRun(req.params.runId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function updatePipelineRunHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pipelineService.updatePipelineRun(req.params.runId, req.body);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function getLatestPipelineRunHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const pipelineId = req.params.pipelineId;
    const run = await pipelineService.getLatestPipelineRun(pipelineId);
    res.json({ success: true, data: run });
  } catch (err) {
    next(err);
  }
}

// ─── DEPLOYMENT HANDLERS ───

export async function createDeploymentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = req.params.projectId;
    const repositoryId = req.params.repositoryId;
    const result = await deploymentService.createDeployment(projectId, repositoryId, req.body);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function listDeploymentsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const environmentId = req.params.environmentId;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
    const deployments = await deploymentService.listDeployments(environmentId, { limit, offset });
    res.json({ success: true, data: deployments });
  } catch (err) {
    next(err);
  }
}

export async function listProjectDeploymentsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = req.params.projectId;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
    const deployments = await deploymentService.listProjectDeployments(projectId, { limit, offset });
    res.json({ success: true, data: deployments });
  } catch (err) {
    next(err);
  }
}

export async function getDeploymentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await deploymentService.getDeployment(req.params.deploymentId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function updateDeploymentStatusHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const deploymentId = req.params.deploymentId;
    const result = await deploymentService.updateDeploymentStatus(
      deploymentId,
      req.body.status,
      req.body.deploymentTime,
    );
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

// ─── RELEASE HANDLERS ───

export async function createReleaseHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const repositoryId = req.params.repositoryId;
    const result = await releaseService.createRelease(repositoryId, req.body);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function listReleasesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const repositoryId = req.params.repositoryId;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
    const releases = await releaseService.listReleases(repositoryId, { limit, offset });
    res.json({ success: true, data: releases });
  } catch (err) {
    next(err);
  }
}

export async function getReleaseHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await releaseService.getRelease(req.params.releaseId);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function getLatestReleasesHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = req.params.projectId;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
    const releases = await releaseService.getLatestReleases(projectId, limit);
    res.json({ success: true, data: releases });
  } catch (err) {
    next(err);
  }
}

// ─── OVERVIEW HANDLER ───

export async function getOverviewHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = req.params.projectId;

    const [repositories, environments, activities, deployments, releases] = await Promise.all([
      repositoryService.listRepositories(projectId),
      environmentService.getEnvironmentsWithStatus(projectId),
      devOpsActivityService.listProjectActivities(projectId, { limit: 20 }),
      deploymentService.listProjectDeployments(projectId, { limit: 10 }),
      releaseService.getLatestReleases(projectId, 10),
    ]);

    const overview = {
      repositoriesCount: repositories.length,
      environmentsCount: environments.length,
      recentActivitiesCount: activities.length,
      recentDeploymentsCount: deployments.length,
      recentReleasesCount: releases.length,
      repositories,
      environments,
      recentActivities: activities.slice(0, 10),
      recentDeployments: deployments.slice(0, 5),
      recentReleases: releases.slice(0, 5),
    };

    res.json({ success: true, data: overview });
  } catch (err) {
    next(err);
  }
}
