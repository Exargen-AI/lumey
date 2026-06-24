import prisma from '../config/database';
import { Deployment, Release, DeploymentStatus } from '@prisma/client';
import { NotFoundError } from '../utils/errors';

export interface DeploymentDTO {
  id: string;
  projectId: string;
  environmentId: string;
  repositoryId: string;
  version: string;
  deployedBy?: string;
  deploymentStatus: DeploymentStatus;
  deploymentTime?: Date;
  commitSha?: string;
  releaseNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReleaseDTO {
  id: string;
  repositoryId: string;
  repoOwner?: string;
  repoName?: string;
  releaseTag: string;
  releaseName?: string;
  releaseNotes?: string;
  publishedAt?: Date;
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDeploymentInput {
  environmentId: string;
  version: string;
  deployedBy?: string;
  deploymentStatus?: DeploymentStatus;
  deploymentTime?: Date;
  commitSha?: string;
  releaseNotes?: string;
}

export interface CreateReleaseInput {
  releaseTag: string;
  releaseName?: string;
  releaseNotes?: string;
  publishedAt?: Date;
  createdBy?: string;
}

/**
 * Deployment management service
 * Handles deployment tracking and monitoring
 */
export class DeploymentService {
  /**
   * Create a deployment
   */
  async createDeployment(
    projectId: string,
    repositoryId: string,
    input: CreateDeploymentInput,
  ): Promise<DeploymentDTO> {
    // Verify resources exist
    const [project, environment, repository] = await Promise.all([
      prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }),
      prisma.environment.findUnique({ where: { id: input.environmentId }, select: { id: true, projectId: true } }),
      prisma.repository.findUnique({ where: { id: repositoryId }, select: { id: true, projectId: true } }),
    ]);

    if (!project) throw new NotFoundError('Project not found');
    if (!environment) throw new NotFoundError('Environment not found');
    if (!repository) throw new NotFoundError('Repository not found');

    if (environment.projectId !== projectId) {
      throw new Error('Environment does not belong to this project');
    }

    const deployment = await prisma.deployment.create({
      data: {
        projectId,
        environmentId: input.environmentId,
        repositoryId,
        version: input.version,
        deployedBy: input.deployedBy,
        deploymentStatus: input.deploymentStatus || 'PENDING',
        deploymentTime: input.deploymentTime,
        commitSha: input.commitSha,
        releaseNotes: input.releaseNotes,
      },
    });

    return this.mapDeploymentToDTO(deployment);
  }

  /**
   * Get deployment by ID
   */
  async getDeployment(deploymentId: string): Promise<DeploymentDTO> {
    const deployment = await prisma.deployment.findUnique({
      where: { id: deploymentId },
    });

    if (!deployment) {
      throw new NotFoundError('Deployment not found');
    }

    return this.mapDeploymentToDTO(deployment);
  }

  /**
   * List deployments for an environment
   */
  async listDeployments(
    environmentId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<DeploymentDTO[]> {
    const deployments = await prisma.deployment.findMany({
      where: { environmentId },
      orderBy: { createdAt: 'desc' },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
    });

    return deployments.map(d => this.mapDeploymentToDTO(d));
  }

  /**
   * List deployments for a project
   */
  async listProjectDeployments(
    projectId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<DeploymentDTO[]> {
    const deployments = await prisma.deployment.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: options?.limit ?? 100,
      skip: options?.offset ?? 0,
    });

    return deployments.map(d => this.mapDeploymentToDTO(d));
  }

  /**
   * Update deployment status
   */
  async updateDeploymentStatus(
    deploymentId: string,
    status: DeploymentStatus,
    deploymentTime?: Date,
  ): Promise<DeploymentDTO> {
    const deployment = await prisma.deployment.findUnique({
      where: { id: deploymentId },
    });

    if (!deployment) {
      throw new NotFoundError('Deployment not found');
    }

    const updated = await prisma.deployment.update({
      where: { id: deploymentId },
      data: {
        deploymentStatus: status,
        deploymentTime: deploymentTime ?? deployment.deploymentTime,
      },
    });

    return this.mapDeploymentToDTO(updated);
  }

  /**
   * Get deployments by status
   */
  async getDeploymentsByStatus(projectId: string, status: DeploymentStatus): Promise<DeploymentDTO[]> {
    const deployments = await prisma.deployment.findMany({
      where: { projectId, deploymentStatus: status },
      orderBy: { createdAt: 'desc' },
    });

    return deployments.map(d => this.mapDeploymentToDTO(d));
  }

  /**
   * Map deployment to DTO
   */
  private mapDeploymentToDTO(deployment: Deployment): DeploymentDTO {
    return {
      id: deployment.id,
      projectId: deployment.projectId,
      environmentId: deployment.environmentId,
      repositoryId: deployment.repositoryId,
      version: deployment.version,
      deployedBy: deployment.deployedBy || undefined,
      deploymentStatus: deployment.deploymentStatus,
      deploymentTime: deployment.deploymentTime || undefined,
      commitSha: deployment.commitSha || undefined,
      releaseNotes: deployment.releaseNotes || undefined,
      createdAt: deployment.createdAt,
      updatedAt: deployment.updatedAt,
    };
  }
}

/**
 * Release management service
 * Handles release tracking
 */
export class ReleaseService {
  /**
   * Create a release
   */
  async createRelease(
    repositoryId: string,
    input: CreateReleaseInput,
  ): Promise<ReleaseDTO> {
    const repository = await prisma.repository.findUnique({
      where: { id: repositoryId },
    });

    if (!repository) {
      throw new NotFoundError('Repository not found');
    }

    const release = await prisma.release.create({
      data: {
        repositoryId,
        releaseTag: input.releaseTag,
        releaseName: input.releaseName,
        releaseNotes: input.releaseNotes,
        publishedAt: input.publishedAt,
        createdBy: input.createdBy,
      },
    });

    return this.mapToDTO(release);
  }

  /**
   * Get release by ID
   */
  async getRelease(releaseId: string): Promise<ReleaseDTO> {
    const release = await prisma.release.findUnique({
      where: { id: releaseId },
      include: {
        repository: {
          select: {
            repoOwner: true,
            repoName: true,
          },
        },
      },
    });

    if (!release) {
      throw new NotFoundError('Release not found');
    }

    return this.mapToDTO(release);
  }

  /**
   * List releases for a repository
   */
  async listReleases(
    repositoryId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<ReleaseDTO[]> {
    const releases = await prisma.release.findMany({
      where: { repositoryId },
      include: {
        repository: {
          select: {
            repoOwner: true,
            repoName: true,
          },
        },
      },
      orderBy: { publishedAt: 'desc' },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
    });

    return releases.map(r => this.mapToDTO(r));
  }

  /**
   * Get latest releases for a project
   */
  async getLatestReleases(projectId: string, limit: number = 20): Promise<ReleaseDTO[]> {
    const repositories = await prisma.repository.findMany({
      where: { projectId },
      select: { id: true },
    });

    const repositoryIds = repositories.map(r => r.id);

    const releases = await prisma.release.findMany({
      where: {
        repositoryId: {
          in: repositoryIds,
        },
      },
      include: {
        repository: {
          select: {
            repoOwner: true,
            repoName: true,
          },
        },
      },
      orderBy: { publishedAt: 'desc' },
      take: limit,
    });

    return releases.map(r => this.mapToDTO(r));
  }

  /**
   * Map to DTO
   */
  private mapToDTO(release: Release & { repository?: { repoOwner?: string; repoName?: string } }): ReleaseDTO {
    return {
      id: release.id,
      repositoryId: release.repositoryId,
      repoOwner: release.repository?.repoOwner || undefined,
      repoName: release.repository?.repoName || undefined,
      releaseTag: release.releaseTag,
      releaseName: release.releaseName || undefined,
      releaseNotes: release.releaseNotes || undefined,
      publishedAt: release.publishedAt || undefined,
      createdBy: release.createdBy || undefined,
      createdAt: release.createdAt,
      updatedAt: release.updatedAt,
    };
  }
}

export const deploymentService = new DeploymentService();
export const releaseService = new ReleaseService();
