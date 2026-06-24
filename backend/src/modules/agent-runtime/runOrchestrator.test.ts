import './../../test/prismaMock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../../test/prismaMock';
import { UserType } from '@prisma/client';
import { NotFoundError, ValidationError } from '../../utils/errors';

const { createRunSpy, transitionRunSpy } = vi.hoisted(() => ({
  createRunSpy: vi.fn(),
  transitionRunSpy: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../services/agentRun.service', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  createRun: createRunSpy,
  transitionRun: transitionRunSpy,
}));

import { startRun, cancelRun, resolveRunnerAgentId } from './runOrchestrator';
import { referenceAdapter } from './adapters/reference';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.task.findUnique.mockResolvedValue({
    id: 't1',
    title: 'Build login',
    description: null,
    acceptanceCriteria: [],
  } as never);
  prismaMock.user.findUnique.mockResolvedValue({ userType: UserType.AGENT } as never);
  createRunSpy.mockResolvedValue({ id: 'r1' });
});

describe('startRun', () => {
  it('creates a run and hands it to the adapter with task context', async () => {
    const exec = vi.spyOn(referenceAdapter, 'execute').mockResolvedValue();

    const run = await startRun({ taskId: 't1', agentId: 'a1' });

    expect(createRunSpy).toHaveBeenCalledWith({ taskId: 't1', agentId: 'a1', adapterId: 'reference' });
    expect(exec).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'r1', taskId: 't1', agentId: 'a1' }),
    );
    expect(run.id).toBe('r1');
    exec.mockRestore();
  });

  it('refuses to start a run for a non-agent user', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ userType: UserType.HUMAN } as never);
    await expect(startRun({ taskId: 't1', agentId: 'h1' })).rejects.toBeInstanceOf(ValidationError);
    expect(createRunSpy).not.toHaveBeenCalled();
  });

  it('throws NotFoundError for a missing task', async () => {
    prismaMock.task.findUnique.mockResolvedValue(null as never);
    await expect(startRun({ taskId: 'nope', agentId: 'a1' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws for an unknown adapter before creating a run', async () => {
    await expect(
      startRun({ taskId: 't1', agentId: 'a1', adapterId: 'bogus' }),
    ).rejects.toThrow(/unknown runtime adapter/);
    expect(createRunSpy).not.toHaveBeenCalled();
  });
});

describe('cancelRun', () => {
  it('delegates to the adapter that ran it', async () => {
    prismaMock.agentRun.findUnique.mockResolvedValue({ status: 'RUNNING', adapterId: 'reference' } as never);
    const cancelSpy = vi.spyOn(referenceAdapter, 'cancel').mockResolvedValue();
    await cancelRun('r1');
    expect(cancelSpy).toHaveBeenCalledWith('r1');
    cancelSpy.mockRestore();
  });

  it('is a no-op on an already-terminal run', async () => {
    prismaMock.agentRun.findUnique.mockResolvedValue({ status: 'SUCCEEDED', adapterId: 'reference' } as never);
    const cancelSpy = vi.spyOn(referenceAdapter, 'cancel').mockResolvedValue();
    expect(await cancelRun('r1')).toBeNull();
    expect(cancelSpy).not.toHaveBeenCalled();
    cancelSpy.mockRestore();
  });

  it('throws NotFoundError for a missing run', async () => {
    prismaMock.agentRun.findUnique.mockResolvedValue(null as never);
    await expect(cancelRun('nope')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('resolveRunnerAgentId', () => {
  it('prefers the task assignee when it is an active agent', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      assignee: { id: 'agent-assignee', userType: UserType.AGENT, agentActive: true },
    } as never);
    expect(await resolveRunnerAgentId('t1')).toBe('agent-assignee');
  });

  it('falls back to the first active agent when the assignee is a human', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      assignee: { id: 'human', userType: UserType.HUMAN, agentActive: false },
    } as never);
    prismaMock.user.findFirst.mockResolvedValue({ id: 'pool-agent' } as never);
    expect(await resolveRunnerAgentId('t1')).toBe('pool-agent');
  });

  it('returns null when the deployment has no agents', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ assignee: null } as never);
    prismaMock.user.findFirst.mockResolvedValue(null as never);
    expect(await resolveRunnerAgentId('t1')).toBeNull();
  });
});
