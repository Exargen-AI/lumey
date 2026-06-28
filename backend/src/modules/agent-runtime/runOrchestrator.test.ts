import './../../test/prismaMock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../../test/prismaMock';
import { RunStatus, UserType } from '@prisma/client';
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

// pause/resume require the run to be executing *in this process*; control that
// gate while keeping the real dispatchRun (startRun's tests exercise it).
const { isRunInflightSpy } = vi.hoisted(() => ({ isRunInflightSpy: vi.fn().mockReturnValue(true) }));
vi.mock('./runExecutor', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  isRunInflight: isRunInflightSpy,
}));

import { startRun, cancelRun, pauseRun, resumeRun, resolveRunnerAgentId } from './runOrchestrator';
import { referenceAdapter } from './adapters/reference';
import { nativeAdapter } from './adapters/native';
import type { RuntimeAdapter } from './runtimeAdapter';

// pause/resume are optional on the seam; the native adapter implements them, so
// spy through a Required view to satisfy the types.
const native = nativeAdapter as Required<RuntimeAdapter>;

beforeEach(() => {
  vi.clearAllMocks();
  isRunInflightSpy.mockReturnValue(true);
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

describe('pauseRun', () => {
  it('flags the loop then records PAUSED for a running, in-flight, pausable run', async () => {
    prismaMock.agentRun.findUnique.mockResolvedValue({ status: 'RUNNING', adapterId: 'native' } as never);
    const pauseSpy = vi.spyOn(native, 'pause').mockResolvedValue();

    expect(await pauseRun('r1')).toBeNull();

    expect(pauseSpy).toHaveBeenCalledWith('r1');
    expect(transitionRunSpy).toHaveBeenCalledWith('r1', RunStatus.PAUSED, expect.objectContaining({ summary: expect.any(String) }));
    pauseSpy.mockRestore();
  });

  it('refuses to pause a run that is not RUNNING', async () => {
    prismaMock.agentRun.findUnique.mockResolvedValue({ status: 'AWAITING_REVIEW', adapterId: 'native' } as never);
    await expect(pauseRun('r1')).rejects.toBeInstanceOf(ValidationError);
    expect(transitionRunSpy).not.toHaveBeenCalled();
  });

  it('refuses to pause when the runtime cannot suspend (reference has no pause)', async () => {
    prismaMock.agentRun.findUnique.mockResolvedValue({ status: 'RUNNING', adapterId: 'reference' } as never);
    await expect(pauseRun('r1')).rejects.toBeInstanceOf(ValidationError);
    expect(transitionRunSpy).not.toHaveBeenCalled();
  });

  it('refuses to pause a run that is not executing on this server', async () => {
    prismaMock.agentRun.findUnique.mockResolvedValue({ status: 'RUNNING', adapterId: 'native' } as never);
    isRunInflightSpy.mockReturnValue(false);
    await expect(pauseRun('r1')).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws NotFoundError for a missing run', async () => {
    prismaMock.agentRun.findUnique.mockResolvedValue(null as never);
    await expect(pauseRun('nope')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('resumeRun', () => {
  it('records RUNNING before unblocking the loop (so later transitions stay legal)', async () => {
    prismaMock.agentRun.findUnique.mockResolvedValue({ status: 'PAUSED', adapterId: 'native' } as never);
    const order: string[] = [];
    transitionRunSpy.mockImplementation(async () => { order.push('transition'); return {}; });
    const resumeSpy = vi.spyOn(native, 'resume').mockImplementation(async () => { order.push('resume'); });

    expect(await resumeRun('r1')).toBeNull();

    expect(transitionRunSpy).toHaveBeenCalledWith('r1', RunStatus.RUNNING, expect.objectContaining({ summary: expect.any(String) }));
    expect(order).toEqual(['transition', 'resume']); // DB first, then unpark
    resumeSpy.mockRestore();
  });

  it('refuses to resume a run that is not PAUSED', async () => {
    prismaMock.agentRun.findUnique.mockResolvedValue({ status: 'RUNNING', adapterId: 'native' } as never);
    await expect(resumeRun('r1')).rejects.toBeInstanceOf(ValidationError);
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
