import prisma from '../config/database';
import { EnvironmentType, EnvironmentStatus, Environment } from '@prisma/client';
import { NotFoundError, ConflictError } from '../utils/errors';

export interface EnvironmentDTO {
  id: string;
  projectId: string;
  name: string;
  type: EnvironmentType;
  branchName?: string;
  deploymentUrl?: string;
  status: EnvironmentStatus;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateEnvironmentInput {
  name: string;
  type: EnvironmentType;
  branchName?: string;
  deploymentUrl?: string;
  description?: string;
}

export interface UpdateEnvironmentInput {
  name?: string;
  branchName?: string;
  deploymentUrl?: string;
  status?: EnvironmentStatus;
  description?: string;
}

/**
 * Environment management service
 * Handles deployment environment configuration and monitoring
 */
export class EnvironmentService {
  /**
   * Create a new environment
   */
  async createEnvironment(
    projectId: string,
    input: CreateEnvironmentInput,
  ): Promise<EnvironmentDTO> {
    // Verify project exists
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });

    if (!project) {
      throw new NotFoundError('Project not found');
    }

    // Check for duplicate name
    const existing = await prisma.environment.findUnique({
      where: {
        projectId_name: {
          projectId,
          name: input.name,
        },
      },
    });

    if (existing) {
      throw new ConflictError('Environment with this name already exists');
    }

    const environment = await prisma.environment.create({
      data: {
        projectId,
        name: input.name,
        type: input.type,
        branchName: input.branchName,
        deploymentUrl: input.deploymentUrl,
        description: input.description,
        status: 'UNKNOWN' as EnvironmentStatus,
      },
    });

    return this.mapToDTO(environment);
  }

  /**
   * Get environment by ID
   */
  async getEnvironment(environmentId: string): Promise<EnvironmentDTO> {
    const environment = await prisma.environment.findUnique({
      where: { id: environmentId },
    });

    if (!environment) {
      throw new NotFoundError('Environment not found');
    }

    return this.mapToDTO(environment);
  }

  /**
   * List environments for a project
   */
  async listEnvironments(projectId: string): Promise<EnvironmentDTO[]> {
    const environments = await prisma.environment.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });

    return environments.map(e => this.mapToDTO(e));
  }

  /**
   * Update environment
   */
  async updateEnvironment(
    environmentId: string,
    input: UpdateEnvironmentInput,
  ): Promise<EnvironmentDTO> {
    const environment = await prisma.environment.findUnique({
      where: { id: environmentId },
    });

    if (!environment) {
      throw new NotFoundError('Environment not found');
    }

    // Check name uniqueness if updating name
    if (input.name && input.name !== environment.name) {
      const existing = await prisma.environment.findUnique({
        where: {
          projectId_name: {
            projectId: environment.projectId,
            name: input.name,
          },
        },
      });

      if (existing) {
        throw new ConflictError('Environment with this name already exists');
      }
    }

    const updated = await prisma.environment.update({
      where: { id: environmentId },
      data: {
        name: input.name ?? environment.name,
        branchName: input.branchName ?? environment.branchName,
        deploymentUrl: input.deploymentUrl ?? environment.deploymentUrl,
        status: input.status ?? environment.status,
        description: input.description ?? environment.description,
      },
    });

    return this.mapToDTO(updated);
  }

  /**
   * Delete environment
   */
  async deleteEnvironment(environmentId: string): Promise<void> {
    const environment = await prisma.environment.findUnique({
      where: { id: environmentId },
    });

    if (!environment) {
      throw new NotFoundError('Environment not found');
    }

    await prisma.environment.delete({
      where: { id: environmentId },
    });
  }

  /**
   * Get environments with latest deployment status
   */
  async getEnvironmentsWithStatus(projectId: string): Promise<(EnvironmentDTO & { latestDeployment?: any })[]> {
    const environments = await prisma.environment.findMany({
      where: { projectId },
      include: {
        deployments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            id: true,
            version: true,
            deploymentStatus: true,
            deploymentTime: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return environments.map(e => ({
      ...this.mapToDTO(e),
      latestDeployment: e.deployments[0] || null,
    }));
  }

  /**
   * Map to DTO
   */
  private mapToDTO(environment: Environment): EnvironmentDTO {
    return {
      id: environment.id,
      projectId: environment.projectId,
      name: environment.name,
      type: environment.type,
      branchName: environment.branchName || undefined,
      deploymentUrl: environment.deploymentUrl || undefined,
      status: environment.status,
      description: environment.description || undefined,
      createdAt: environment.createdAt,
      updatedAt: environment.updatedAt,
    };
  }
}

export const environmentService = new EnvironmentService();
