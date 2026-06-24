import prisma from '../config/database';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { GitProvider, RepositoryActivityType } from '@prisma/client';
import { GitProviderFactory } from './devops.provider.service';

export interface CreateRepositoryInput {
  provider: GitProvider;
  repoName: string;
  repoOwner: string;
  repoUrl: string;
  accessToken?: string;
  defaultBranch?: string;
  isPrivate?: boolean;
}

export interface UpdateRepositoryInput {
  repoName?: string;
  repoUrl?: string;
  accessToken?: string;
  defaultBranch?: string;
  isPrivate?: boolean;
}

export interface RepositoryDTO {
  id: string;
  projectId: string;
  provider: GitProvider;
  repoName: string;
  repoOwner: string;
  repoUrl: string;
  defaultBranch: string;
  isPrivate: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  lastSyncedAt?: Date;
  latestActivityType?: RepositoryActivityType;
  latestActivityTitle?: string;
  latestActivityUrl?: string;
}

/**
 * Repository management service
 * Handles CRUD operations for Git repository connections
 */
export class RepositoryService {
  /**
   * Create a new repository connection
   */
  async createRepository(
    projectId: string,
    userId: string,
    input: CreateRepositoryInput,
  ): Promise<RepositoryDTO> {
    // Verify project exists
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!project) {
      throw new NotFoundError('Project not found');
    }

    // Check for duplicate
    const existing = await prisma.repository.findUnique({
      where: {
        projectId_provider_repoOwner_repoName: {
          projectId,
          provider: input.provider,
          repoOwner: input.repoOwner,
          repoName: input.repoName,
        },
      },
    });
    if (existing) {
      throw new ConflictError('Repository already connected to this project');
    }

    // Validate the repository exists on the provider before storing it.
    const provider = GitProviderFactory.getProvider(input.provider, input.accessToken || undefined);
    const isValid = await provider.validateRepository(input.repoOwner, input.repoName);
    if (!isValid) {
      throw new ValidationError('Unable to validate repository on the selected provider');
    }

    const repository = await prisma.repository.create({
      data: {
        projectId,
        provider: input.provider,
        repoName: input.repoName,
        repoOwner: input.repoOwner,
        repoUrl: input.repoUrl,
        accessToken: input.accessToken || null,
        defaultBranch: input.defaultBranch || 'main',
        isPrivate: input.isPrivate || false,
        createdBy: userId,
      },
    });

    return this.mapToDTO(repository);
  }

  /**
   * Get repository by ID
   */
  async getRepository(repositoryId: string): Promise<RepositoryDTO> {
    const repository = await prisma.repository.findUnique({
      where: { id: repositoryId },
    });
    if (!repository) {
      throw new NotFoundError('Repository not found');
    }
    return this.mapToDTO(repository);
  }

  /**
   * List repositories for a project
   */
  async listRepositories(projectId: string): Promise<RepositoryDTO[]> {
    const repositories = await prisma.repository.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: {
        activities: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    return repositories.map(r => this.mapToDTO(r));
  }

  /**
   * Update repository
   */
  async updateRepository(
    repositoryId: string,
    input: UpdateRepositoryInput,
  ): Promise<RepositoryDTO> {
    const repository = await prisma.repository.findUnique({
      where: { id: repositoryId },
    });
    if (!repository) {
      throw new NotFoundError('Repository not found');
    }

    const updated = await prisma.repository.update({
      where: { id: repositoryId },
      data: {
        repoName: input.repoName ?? repository.repoName,
        repoUrl: input.repoUrl ?? repository.repoUrl,
        accessToken: input.accessToken ?? repository.accessToken,
        defaultBranch: input.defaultBranch ?? repository.defaultBranch,
        isPrivate: input.isPrivate ?? repository.isPrivate,
      },
    });

    return this.mapToDTO(updated);
  }

  /**
   * Delete repository
   */
  async deleteRepository(repositoryId: string): Promise<void> {
    const repository = await prisma.repository.findUnique({
      where: { id: repositoryId },
    });
    if (!repository) {
      throw new NotFoundError('Repository not found');
    }

    await prisma.repository.delete({
      where: { id: repositoryId },
    });
  }

  /**
   * Get repository by owner/name
   */
  async getRepositoryByOwnerAndName(
    projectId: string,
    provider: GitProvider,
    repoOwner: string,
    repoName: string,
  ): Promise<RepositoryDTO | null> {
    const repository = await prisma.repository.findUnique({
      where: {
        projectId_provider_repoOwner_repoName: {
          projectId,
          provider,
          repoOwner,
          repoName,
        },
      },
    });

    return repository ? this.mapToDTO(repository) : null;
  }

  /**
   * Map repository to DTO (excludes access token)
   */
  private mapToDTO(repository: any): RepositoryDTO {
    const latestActivity = repository.activities?.[0];

    return {
      id: repository.id,
      projectId: repository.projectId,
      provider: repository.provider,
      repoName: repository.repoName,
      repoOwner: repository.repoOwner,
      repoUrl: repository.repoUrl,
      defaultBranch: repository.defaultBranch,
      isPrivate: repository.isPrivate,
      createdAt: repository.createdAt,
      updatedAt: repository.updatedAt,
      createdBy: repository.createdBy,
      lastSyncedAt: latestActivity?.createdAt,
      latestActivityType: latestActivity?.activityType,
      latestActivityTitle: latestActivity?.title,
      latestActivityUrl: latestActivity?.activityUrl,
    };
  }

  /**
   * Get access token for API calls (internal use only)
   */
  async getAccessToken(repositoryId: string): Promise<string | null> {
    const repository = await prisma.repository.findUnique({
      where: { id: repositoryId },
      select: { accessToken: true },
    });
    return repository?.accessToken ?? null;
  }
}

export const repositoryService = new RepositoryService();
