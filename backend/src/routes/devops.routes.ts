import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { projectAccess } from '../middleware/projectAccess';
import { validate } from '../middleware/validate';
import * as schema from '../validators/devops.schema';
import * as handler from '../handlers/devops.handler';

const router = Router();

/**
 * DevelopmentOps Module Routes
 * All routes require authentication and project access
 */

// ─── PROJECT OVERVIEW ───
router.get(
  '/projects/:projectId/devops/overview',
  authenticate,
  projectAccess,
  authorize('devops.read'),
  validate(schema.projectIdParamSchema),
  handler.getOverviewHandler,
);

// ─── REPOSITORIES ───
router.post(
  '/projects/:projectId/devops/repositories',
  authenticate,
  projectAccess,
  authorize('devops.manage'),
  validate(schema.projectIdParamSchema),
  validate(schema.createRepositorySchema),
  handler.createRepositoryHandler,
);

router.get(
  '/projects/:projectId/devops/repositories',
  authenticate,
  projectAccess,
  authorize('devops.read'),
  validate(schema.projectIdParamSchema),
  handler.listRepositoriesHandler,
);

router.get(
  '/devops/repositories/:repositoryId',
  authenticate,
  authorize('devops.read'),
  validate(schema.repositoryIdParamSchema),
  handler.getRepositoryHandler,
);

router.patch(
  '/devops/repositories/:repositoryId',
  authenticate,
  authorize('devops.manage'),
  validate(schema.repositoryIdParamSchema),
  validate(schema.updateRepositorySchema),
  handler.updateRepositoryHandler,
);

router.delete(
  '/devops/repositories/:repositoryId',
  authenticate,
  authorize('devops.manage'),
  validate(schema.repositoryIdParamSchema),
  handler.deleteRepositoryHandler,
);

// ─── REPOSITORY ACTIVITIES ───
router.post(
  '/devops/repositories/:repositoryId/sync',
  authenticate,
  authorize('devops.manage'),
  validate(schema.repositoryIdParamSchema),
  handler.syncRepositoryActivitiesHandler,
);

router.get(
  '/devops/repositories/:repositoryId/activities',
  authenticate,
  authorize('devops.read'),
  validate(schema.repositoryIdParamSchema),
  validate(schema.activityFilterSchema),
  handler.listActivitiesHandler,
);

router.get(
  '/projects/:projectId/devops/activities',
  authenticate,
  projectAccess,
  authorize('devops.read'),
  validate(schema.projectIdParamSchema),
  validate(schema.paginationSchema),
  handler.listProjectActivitiesHandler,
);

router.get(
  '/devops/activities/:activityId',
  authenticate,
  authorize('devops.read'),
  validate(schema.activityIdParamSchema),
  handler.getActivityHandler,
);

// ─── LINK ACTIVITIES TO TASKS ───
router.post(
  '/devops/activities/:activityId/link-task',
  authenticate,
  authorize('devops.manage'),
  validate(schema.activityIdParamSchema),
  validate(schema.linkActivityToTaskSchema),
  handler.linkActivityToTaskHandler,
);

router.post(
  '/devops/activities/:activityId/unlink-task',
  authenticate,
  authorize('devops.manage'),
  validate(schema.activityIdParamSchema),
  validate(schema.unlinkActivityFromTaskSchema),
  handler.unlinkActivityFromTaskHandler,
);

router.get(
  '/devops/activities/:activityId/linked-tasks',
  authenticate,
  authorize('devops.read'),
  validate(schema.activityIdParamSchema),
  handler.getLinkedTasksHandler,
);

// ─── ENVIRONMENTS ───
router.post(
  '/projects/:projectId/devops/environments',
  authenticate,
  projectAccess,
  authorize('devops.manage'),
  validate(schema.projectIdParamSchema),
  validate(schema.createEnvironmentSchema),
  handler.createEnvironmentHandler,
);

router.get(
  '/projects/:projectId/devops/environments',
  authenticate,
  projectAccess,
  authorize('devops.read'),
  validate(schema.projectIdParamSchema),
  handler.listEnvironmentsHandler,
);

router.get(
  '/projects/:projectId/devops/environments/with-status',
  authenticate,
  projectAccess,
  authorize('devops.read'),
  validate(schema.projectIdParamSchema),
  handler.getEnvironmentsWithStatusHandler,
);

router.get(
  '/devops/environments/:environmentId',
  authenticate,
  authorize('devops.read'),
  validate(schema.environmentIdParamSchema),
  handler.getEnvironmentHandler,
);

router.patch(
  '/devops/environments/:environmentId',
  authenticate,
  authorize('devops.manage'),
  validate(schema.environmentIdParamSchema),
  validate(schema.updateEnvironmentSchema),
  handler.updateEnvironmentHandler,
);

router.delete(
  '/devops/environments/:environmentId',
  authenticate,
  authorize('devops.manage'),
  validate(schema.environmentIdParamSchema),
  handler.deleteEnvironmentHandler,
);

// ─── PIPELINES ───
router.post(
  '/devops/repositories/:repositoryId/pipelines',
  authenticate,
  authorize('devops.manage'),
  validate(schema.repositoryIdParamSchema),
  validate(schema.createPipelineSchema),
  handler.createPipelineHandler,
);

router.get(
  '/devops/repositories/:repositoryId/pipelines',
  authenticate,
  authorize('devops.read'),
  validate(schema.repositoryIdParamSchema),
  handler.listPipelinesHandler,
);

router.get(
  '/devops/pipelines/:pipelineId',
  authenticate,
  authorize('devops.read'),
  validate(schema.pipelineIdParamSchema),
  handler.getPipelineHandler,
);

// ─── PIPELINE RUNS ───
router.post(
  '/devops/pipelines/:pipelineId/runs',
  authenticate,
  authorize('devops.manage'),
  validate(schema.pipelineIdParamSchema),
  validate(schema.createPipelineRunSchema),
  handler.createPipelineRunHandler,
);

router.get(
  '/devops/pipelines/:pipelineId/runs',
  authenticate,
  authorize('devops.read'),
  validate(schema.pipelineIdParamSchema),
  validate(schema.paginationSchema),
  handler.listPipelineRunsHandler,
);

router.get(
  '/devops/pipelines/:pipelineId/latest-run',
  authenticate,
  authorize('devops.read'),
  validate(schema.pipelineIdParamSchema),
  handler.getLatestPipelineRunHandler,
);

router.get(
  '/devops/pipelines/:pipelineId/runs/:runId',
  authenticate,
  authorize('devops.read'),
  handler.getPipelineRunHandler,
);

router.patch(
  '/devops/pipelines/:pipelineId/runs/:runId',
  authenticate,
  authorize('devops.manage'),
  validate(schema.updatePipelineRunSchema),
  handler.updatePipelineRunHandler,
);

// ─── DEPLOYMENTS ───
router.post(
  '/projects/:projectId/devops/repositories/:repositoryId/deployments',
  authenticate,
  projectAccess,
  authorize('devops.manage'),
  validate(schema.projectIdParamSchema),
  validate(schema.createDeploymentSchema),
  handler.createDeploymentHandler,
);

router.get(
  '/devops/environments/:environmentId/deployments',
  authenticate,
  authorize('devops.read'),
  validate(schema.environmentIdParamSchema),
  validate(schema.paginationSchema),
  handler.listDeploymentsHandler,
);

router.get(
  '/projects/:projectId/devops/deployments',
  authenticate,
  projectAccess,
  authorize('devops.read'),
  validate(schema.projectIdParamSchema),
  validate(schema.paginationSchema),
  handler.listProjectDeploymentsHandler,
);

router.get(
  '/devops/deployments/:deploymentId',
  authenticate,
  authorize('devops.read'),
  validate(schema.deploymentIdParamSchema),
  handler.getDeploymentHandler,
);

router.patch(
  '/devops/deployments/:deploymentId/status',
  authenticate,
  authorize('devops.manage'),
  validate(schema.deploymentIdParamSchema),
  validate(schema.updateDeploymentStatusSchema),
  handler.updateDeploymentStatusHandler,
);

// ─── RELEASES ───
router.post(
  '/devops/repositories/:repositoryId/releases',
  authenticate,
  authorize('devops.manage'),
  validate(schema.repositoryIdParamSchema),
  validate(schema.createReleaseSchema),
  handler.createReleaseHandler,
);

router.get(
  '/devops/repositories/:repositoryId/releases',
  authenticate,
  authorize('devops.read'),
  validate(schema.repositoryIdParamSchema),
  validate(schema.paginationSchema),
  handler.listReleasesHandler,
);

router.get(
  '/projects/:projectId/devops/latest-releases',
  authenticate,
  projectAccess,
  authorize('devops.read'),
  validate(schema.projectIdParamSchema),
  handler.getLatestReleasesHandler,
);

router.get(
  '/devops/releases/:releaseId',
  authenticate,
  authorize('devops.read'),
  validate(schema.releaseIdParamSchema),
  handler.getReleaseHandler,
);

export default router;
