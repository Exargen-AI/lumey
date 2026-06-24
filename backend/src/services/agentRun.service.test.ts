import './../test/prismaMock';
import { describe, it, expect, beforeEach } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import { RunStatus, RunStepType } from '@prisma/client';
import {
  createRun,
  transitionRun,
  appendStep,
  getRun,
  listRunsForTask,
} from './agentRun.service';
import { ValidationError, NotFoundError } from '../utils/errors';

beforeEach(() => {
  // $transaction invokes its callback with the mock as the tx client.
  (prismaMock.$transaction as any).mockImplementation(async (cb: any) => cb(prismaMock));
  // Default: no prior events/steps → sequence starts at 1.
  prismaMock.runEvent.findFirst.mockResolvedValue(null as any);
  prismaMock.runStep.findFirst.mockResolvedValue(null as any);
  prismaMock.runEvent.create.mockResolvedValue({ id: 'ev' } as any);
});

describe('createRun', () => {
  it('creates a QUEUED run and records a run.created event at seq 1', async () => {
    prismaMock.agentRun.create.mockResolvedValue({ id: 'r1', taskId: 't1', agentId: 'a1' } as any);

    const run = await createRun({ taskId: 't1', agentId: 'a1' });

    expect(prismaMock.agentRun.create).toHaveBeenCalledWith({
      data: { taskId: 't1', agentId: 'a1', model: null },
    });
    expect(prismaMock.runEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ runId: 'r1', seq: 1, type: 'run.created' }),
    });
    expect(run.id).toBe('r1');
  });
});

describe('transitionRun', () => {
  it('moves QUEUED → RUNNING and stamps startedAt', async () => {
    prismaMock.agentRun.findUnique.mockResolvedValue({
      id: 'r1',
      taskId: 't1',
      status: RunStatus.QUEUED,
      startedAt: null,
    } as any);
    prismaMock.agentRun.update.mockResolvedValue({} as any);

    await transitionRun('r1', RunStatus.RUNNING);

    const data = (prismaMock.agentRun.update.mock.calls[0][0] as any).data;
    expect(data.status).toBe(RunStatus.RUNNING);
    expect(data.startedAt).toBeInstanceOf(Date);
    expect(data.endedAt).toBeUndefined();
  });

  it('stamps endedAt + summary on a terminal transition', async () => {
    prismaMock.agentRun.findUnique.mockResolvedValue({
      id: 'r1',
      taskId: 't1',
      status: RunStatus.RUNNING,
      startedAt: new Date(),
    } as any);
    prismaMock.agentRun.update.mockResolvedValue({} as any);

    await transitionRun('r1', RunStatus.SUCCEEDED, { summary: 'done' });

    const data = (prismaMock.agentRun.update.mock.calls[0][0] as any).data;
    expect(data.status).toBe(RunStatus.SUCCEEDED);
    expect(data.endedAt).toBeInstanceOf(Date);
    expect(data.summary).toBe('done');
  });

  it('rejects an illegal transition and does not write', async () => {
    prismaMock.agentRun.findUnique.mockResolvedValue({
      id: 'r1',
      taskId: 't1',
      status: RunStatus.SUCCEEDED,
    } as any);

    await expect(transitionRun('r1', RunStatus.RUNNING)).rejects.toBeInstanceOf(ValidationError);
    expect(prismaMock.agentRun.update).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the run is missing', async () => {
    prismaMock.agentRun.findUnique.mockResolvedValue(null as any);
    await expect(transitionRun('nope', RunStatus.RUNNING)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('appendStep', () => {
  it('records a step with the next per-run sequence (seq 3 after 2)', async () => {
    prismaMock.agentRun.findUnique.mockResolvedValue({ id: 'r1' } as any);
    prismaMock.runStep.findFirst.mockResolvedValue({ seq: 2 } as any);
    prismaMock.runStep.create.mockResolvedValue({ id: 's3', seq: 3, type: RunStepType.EDIT, title: 'x' } as any);

    const step = await appendStep('r1', { type: RunStepType.EDIT, title: 'x' });

    expect((prismaMock.runStep.create.mock.calls[0][0] as any).data.seq).toBe(3);
    expect(step.seq).toBe(3);
  });

  it('throws NotFoundError for a missing run', async () => {
    prismaMock.agentRun.findUnique.mockResolvedValue(null as any);
    await expect(appendStep('nope', { type: RunStepType.PLAN, title: 'x' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('getRun / listRunsForTask', () => {
  it('getRun throws NotFoundError when absent', async () => {
    prismaMock.agentRun.findUnique.mockResolvedValue(null as any);
    await expect(getRun('nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('listRunsForTask queries by task, newest first', async () => {
    prismaMock.agentRun.findMany.mockResolvedValue([] as any);
    await listRunsForTask('t1');
    expect(prismaMock.agentRun.findMany).toHaveBeenCalledWith({
      where: { taskId: 't1' },
      orderBy: { createdAt: 'desc' },
    });
  });
});
