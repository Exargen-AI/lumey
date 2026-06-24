import { z } from 'zod';
import { GitProvider, RepositoryActivityType, EnvironmentType, PipelineStatus, DeploymentStatus } from '@prisma/client';

// ─── Path Parameters ───

export const projectIdParamSchema = z.object({
  params: z.object({
    projectId: z.string().uuid(),
  }),
  body: z.any().optional(),
  query: z.any().optional(),
});

export const repositoryIdParamSchema = z.object({
  params: z.object({
    repositoryId: z.string().uuid(),
  }),
  body: z.any().optional(),
  query: z.any().optional(),
});

export const environmentIdParamSchema = z.object({
  params: z.object({
    environmentId: z.string().uuid(),
  }),
  body: z.any().optional(),
  query: z.any().optional(),
});

export const pipelineIdParamSchema = z.object({
  params: z.object({
    pipelineId: z.string().uuid(),
  }),
  body: z.any().optional(),
  query: z.any().optional(),
});

export const deploymentIdParamSchema = z.object({
  params: z.object({
    deploymentId: z.string().uuid(),
  }),
  body: z.any().optional(),
  query: z.any().optional(),
});

export const releaseIdParamSchema = z.object({
  params: z.object({
    releaseId: z.string().uuid(),
  }),
  body: z.any().optional(),
  query: z.any().optional(),
});

export const activityIdParamSchema = z.object({
  params: z.object({
    activityId: z.string().uuid(),
  }),
  body: z.any().optional(),
  query: z.any().optional(),
});

// ─── Repository ───

export const createRepositorySchema = z.object({
  params: z.any().optional(),
  body: z.object({
    provider: z.enum(['GITHUB', 'GITLAB', 'BITBUCKET']),
    repoName: z.string().min(1).max(255),
    repoOwner: z.string().min(1).max(255),
    repoUrl: z.string().url(),
    accessToken: z.string().optional(),
    defaultBranch: z.string().max(255).optional(),
    isPrivate: z.boolean().optional(),
  }),
  query: z.any().optional(),
});

export const updateRepositorySchema = z.object({
  params: z.any().optional(),
  body: z.object({
    repoName: z.string().min(1).max(255).optional(),
    repoUrl: z.string().url().optional(),
    accessToken: z.string().optional(),
    defaultBranch: z.string().max(255).optional(),
    isPrivate: z.boolean().optional(),
  }),
  query: z.any().optional(),
});

// ─── Environment ───

export const createEnvironmentSchema = z.object({
  params: z.any().optional(),
  body: z.object({
    name: z.string().min(1).max(100),
    type: z.enum(['DEVELOPMENT', 'STAGING', 'PRODUCTION']),
    branchName: z.string().max(255).optional(),
    deploymentUrl: z.string().url().optional(),
    description: z.string().max(500).optional(),
  }),
  query: z.any().optional(),
});

export const updateEnvironmentSchema = z.object({
  params: z.any().optional(),
  body: z.object({
    name: z.string().min(1).max(100).optional(),
    branchName: z.string().max(255).optional(),
    deploymentUrl: z.string().url().optional(),
    status: z.enum(['HEALTHY', 'DEGRADED', 'DOWN', 'UNKNOWN']).optional(),
    description: z.string().max(500).optional(),
  }),
  query: z.any().optional(),
});

// ─── Pipeline ───

export const createPipelineSchema = z.object({
  params: z.any().optional(),
  body: z.object({
    pipelineName: z.string().min(1).max(255),
    externalPipelineId: z.string().min(1).max(255),
  }),
  query: z.any().optional(),
});

export const createPipelineRunSchema = z.object({
  params: z.any().optional(),
  body: z.object({
    runNumber: z.number().int().positive(),
    status: z.enum(['QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED']),
    conclusion: z.string().max(255).optional(),
    branch: z.string().max(255).optional(),
    triggeredBy: z.string().max(255).optional(),
    startedAt: z.date().optional(),
    completedAt: z.date().optional(),
    externalUrl: z.string().url().optional(),
  }),
  query: z.any().optional(),
});

export const updatePipelineRunSchema = z.object({
  params: z.any().optional(),
  body: z.object({
    status: z.enum(['QUEUED', 'RUNNING', 'SUCCESS', 'FAILED', 'CANCELLED']).optional(),
    conclusion: z.string().max(255).optional(),
    completedAt: z.date().optional(),
  }),
  query: z.any().optional(),
});

// ─── Deployment ───

export const createDeploymentSchema = z.object({
  params: z.any().optional(),
  body: z.object({
    environmentId: z.string().uuid(),
    version: z.string().min(1).max(100),
    deployedBy: z.string().uuid().optional(),
    deploymentStatus: z.enum(['PENDING', 'IN_PROGRESS', 'SUCCESS', 'FAILED', 'ROLLED_BACK']).optional(),
    deploymentTime: z.date().optional(),
    commitSha: z.string().max(40).optional(),
    releaseNotes: z.string().max(5000).optional(),
  }),
  query: z.any().optional(),
});

export const updateDeploymentStatusSchema = z.object({
  params: z.any().optional(),
  body: z.object({
    status: z.enum(['PENDING', 'IN_PROGRESS', 'SUCCESS', 'FAILED', 'ROLLED_BACK']),
    deploymentTime: z.date().optional(),
  }),
  query: z.any().optional(),
});

// ─── Release ───

export const createReleaseSchema = z.object({
  params: z.any().optional(),
  body: z.object({
    releaseTag: z.string().min(1).max(100),
    releaseName: z.string().max(255).optional(),
    releaseNotes: z.string().max(5000).optional(),
    publishedAt: z.date().optional(),
  }),
  query: z.any().optional(),
});

// ─── Activities ───

export const linkActivityToTaskSchema = z.object({
  params: z.any().optional(),
  body: z.object({
    taskId: z.string().uuid(),
  }),
  query: z.any().optional(),
});

export const unlinkActivityFromTaskSchema = z.object({
  params: z.any().optional(),
  body: z.object({
    taskId: z.string().uuid(),
  }),
  query: z.any().optional(),
});

// ─── Query Parameters ───

export const paginationSchema = z.object({
  params: z.any().optional(),
  body: z.any().optional(),
  query: z.object({
    limit: z.string().transform(v => parseInt(v)).pipe(z.number().int().min(1).max(100)).optional(),
    offset: z.string().transform(v => parseInt(v)).pipe(z.number().int().min(0)).optional(),
  }).optional(),
});

export const activityFilterSchema = z.object({
  params: z.any().optional(),
  body: z.any().optional(),
  query: z.object({
    type: z.enum(['COMMIT', 'PR_OPENED', 'PR_MERGED', 'BRANCH_CREATED', 'RELEASE_PUBLISHED']).optional(),
    limit: z.string().transform(v => parseInt(v)).pipe(z.number().int().min(1).max(100)).optional(),
    offset: z.string().transform(v => parseInt(v)).pipe(z.number().int().min(0)).optional(),
  }).optional(),
});

// Export inferred types
export type CreateRepositoryInput = z.infer<typeof createRepositorySchema>;
export type UpdateRepositoryInput = z.infer<typeof updateRepositorySchema>;
export type CreateEnvironmentInput = z.infer<typeof createEnvironmentSchema>;
export type UpdateEnvironmentInput = z.infer<typeof updateEnvironmentSchema>;
export type CreatePipelineInput = z.infer<typeof createPipelineSchema>;
export type CreatePipelineRunInput = z.infer<typeof createPipelineRunSchema>;
export type UpdatePipelineRunInput = z.infer<typeof updatePipelineRunSchema>;
export type CreateDeploymentInput = z.infer<typeof createDeploymentSchema>;
export type UpdateDeploymentStatusInput = z.infer<typeof updateDeploymentStatusSchema>;
export type CreateReleaseInput = z.infer<typeof createReleaseSchema>;
