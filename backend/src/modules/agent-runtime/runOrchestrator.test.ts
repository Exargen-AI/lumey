import './../../test/prismaMock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../../test/prismaMock';
import { UserType } from '@prisma/client';
import { NotFoundError, ValidationError } from '../../utils/errors';

const { createRunSpy } = vi.hoisted(() => ({ createRunSpy: vi.fn() }));
vi.mock('../../services/agentRun.service', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  createRun: createRunSpy,
}));

import { startRun } from './runOrchestrator';
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

    expect(createRunSpy).toHaveBeenCalledWith({ taskId: 't1', agentId: 'a1' });
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
