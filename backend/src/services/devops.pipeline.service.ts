import prisma from '../config/database';
import { Pipeline, PipelineRun, PipelineStatus } from '@prisma/client';
import { NotFoundError, ConflictError } from '../utils/errors';

export interface PipelineDTO {
  id: string;
  repositoryId: string;
  pipelineName: string;
  externalPipelineId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PipelineRunDTO {
  id: string;
  pipelineId: string;
  runNumber: number;
  status: PipelineStatus;
  conclusion?: string;
  branch?: string;
  triggeredBy?: string;
  startedAt?: Date;
  completedAt?: Date;
  externalUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePipelineInput {
  pipelineName: string;
  externalPipelineId: string;
}

export interface CreatePipelineRunInput {
  runNumber: number;
  status: PipelineStatus;
  conclusion?: string;
  branch?: string;
  triggeredBy?: string;
  startedAt?: Date;
  completedAt?: Date;
  externalUrl?: string;
}

/**
 * Pipeline management service
 * Handles CI/CD pipeline tracking and monitoring
 */
export class PipelineService {
  /**
   * Create a pipeline
   */
  async createPipeline(
    repositoryId: string,
    input: CreatePipelineInput,
  ): Promise<PipelineDTO> {
    // Verify repository exists
    const repository = await prisma.repository.findUnique({
      where: { id: repositoryId },
      select: { id: true, provider: true },
    });

    if (!repository) {
      throw new NotFoundError('Repository not found');
    }

    // Check for duplicate
    const existing = await prisma.pipeline.findUnique({
      where: {
        repositoryId_externalPipelineId: {
          repositoryId,
          externalPipelineId: input.externalPipelineId,
        },
      },
    });

    if (existing) {
      throw new ConflictError('Pipeline already exists');
    }

    const pipeline = await prisma.pipeline.create({
      data: {
        repositoryId,
        provider: repository.provider,
        pipelineName: input.pipelineName,
        externalPipelineId: input.externalPipelineId,
      },
    });

    return this.mapPipelineToDTO(pipeline);
  }

  /**
   * Get pipeline by ID
   */
  async getPipeline(pipelineId: string): Promise<PipelineDTO> {
    const pipeline = await prisma.pipeline.findUnique({
      where: { id: pipelineId },
    });

    if (!pipeline) {
      throw new NotFoundError('Pipeline not found');
    }

    return this.mapPipelineToDTO(pipeline);
  }

  /**
   * List pipelines for a repository
   */
  async listPipelines(repositoryId: string): Promise<PipelineDTO[]> {
    const pipelines = await prisma.pipeline.findMany({
      where: { repositoryId },
      orderBy: { createdAt: 'desc' },
    });

    return pipelines.map(p => this.mapPipelineToDTO(p));
  }

  /**
   * Create a pipeline run
   */
  async createPipelineRun(
    pipelineId: string,
    input: CreatePipelineRunInput,
  ): Promise<PipelineRunDTO> {
    const pipeline = await prisma.pipeline.findUnique({
      where: { id: pipelineId },
    });

    if (!pipeline) {
      throw new NotFoundError('Pipeline not found');
    }

    // Check for duplicate run
    const existing = await prisma.pipelineRun.findUnique({
      where: {
        pipelineId_runNumber: {
          pipelineId,
          runNumber: input.runNumber,
        },
      },
    });

    if (existing) {
      throw new ConflictError('Pipeline run already exists');
    }

    const run = await prisma.pipelineRun.create({
      data: {
        pipelineId,
        runNumber: input.runNumber,
        status: input.status,
        conclusion: input.conclusion,
        branch: input.branch,
        triggeredBy: input.triggeredBy,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        externalUrl: input.externalUrl,
      },
    });

    return this.mapRunToDTO(run);
  }

  /**
   * Update pipeline run
   */
  async updatePipelineRun(
    runId: string,
    input: Partial<CreatePipelineRunInput>,
  ): Promise<PipelineRunDTO> {
    const run = await prisma.pipelineRun.findUnique({
      where: { id: runId },
    });

    if (!run) {
      throw new NotFoundError('Pipeline run not found');
    }

    const updated = await prisma.pipelineRun.update({
      where: { id: runId },
      data: {
        status: input.status ?? run.status,
        conclusion: input.conclusion ?? run.conclusion,
        completedAt: input.completedAt ?? run.completedAt,
      },
    });

    return this.mapRunToDTO(updated);
  }

  /**
   * Get pipeline run by ID
   */
  async getPipelineRun(runId: string): Promise<PipelineRunDTO> {
    const run = await prisma.pipelineRun.findUnique({
      where: { id: runId },
    });

    if (!run) {
      throw new NotFoundError('Pipeline run not found');
    }

    return this.mapRunToDTO(run);
  }

  /**
   * List pipeline runs
   */
  async listPipelineRuns(
    pipelineId: string,
    options?: {
      limit?: number;
      offset?: number;
    },
  ): Promise<PipelineRunDTO[]> {
    const runs = await prisma.pipelineRun.findMany({
      where: { pipelineId },
      orderBy: { createdAt: 'desc' },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
    });

    return runs.map(r => this.mapRunToDTO(r));
  }

  /**
   * Get latest run for a pipeline
   */
  async getLatestPipelineRun(pipelineId: string): Promise<PipelineRunDTO | null> {
    const run = await prisma.pipelineRun.findFirst({
      where: { pipelineId },
      orderBy: { createdAt: 'desc' },
    });

    return run ? this.mapRunToDTO(run) : null;
  }

  /**
   * Map pipeline to DTO
   */
  private mapPipelineToDTO(pipeline: Pipeline): PipelineDTO {
    return {
      id: pipeline.id,
      repositoryId: pipeline.repositoryId,
      pipelineName: pipeline.pipelineName,
      externalPipelineId: pipeline.externalPipelineId,
      createdAt: pipeline.createdAt,
      updatedAt: pipeline.updatedAt,
    };
  }

  /**
   * Map pipeline run to DTO
   */
  private mapRunToDTO(run: PipelineRun): PipelineRunDTO {
    return {
      id: run.id,
      pipelineId: run.pipelineId,
      runNumber: run.runNumber,
      status: run.status,
      conclusion: run.conclusion || undefined,
      branch: run.branch || undefined,
      triggeredBy: run.triggeredBy || undefined,
      startedAt: run.startedAt || undefined,
      completedAt: run.completedAt || undefined,
      externalUrl: run.externalUrl || undefined,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    };
  }
}

export const pipelineService = new PipelineService();
