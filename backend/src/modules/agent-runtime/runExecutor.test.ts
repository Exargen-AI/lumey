import './../../test/prismaMock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../../test/prismaMock';
import { RunStatus } from '@prisma/client';

const { transitionRunSpy } = vi.hoisted(() => ({ transitionRunSpy: vi.fn().mockResolvedValue({}) }));
vi.mock('../../services/agentRun.service', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  transitionRun: transitionRunSpy,
}));

import { dispatchRun, failInterruptedRuns, isRunInflight, inflightRunCount } from './runExecutor';
import type { RuntimeAdapter, RunContext } from './runtimeAdapter';

const ctx: RunContext = { runId: 'r1', taskId: 't1', agentId: 'a1', task: { title: 't', description: null, acceptanceCriteria: [] } };

function adapter(execute: RuntimeAdapter['execute']): RuntimeAdapter {
  return {
    id: 'x',
    capabilities: () => ({ selfHosted: false, memory: false, outcomes: false, multiAgent: false }),
    execute,
    cancel: async () => undefined,
  };
}

beforeEach(() => vi.clearAllMocks());

describe('dispatchRun', () => {
  it('runs to completion and clears the inflight marker', async () => {
    await dispatchRun(adapter(async () => undefined), ctx);
    expect(isRunInflight('r1')).toBe(false);
    expect(transitionRunSpy).not.toHaveBeenCalled();
  });

  it('forces a non-terminal run to FAILED when execute throws', async () => {
    prismaMock.agentRun.findUnique.mockResolvedValue({ status: RunStatus.RUNNING } as never);
    await dispatchRun(adapter(async () => { throw new Error('boom'); }), ctx);
    expect(transitionRunSpy).toHaveBeenCalledWith('r1', RunStatus.FAILED, { error: 'boom' });
    expect(isRunInflight('r1')).toBe(false);
  });

  it('does not double-fail an already-terminal run', async () => {
    prismaMock.agentRun.findUnique.mockResolvedValue({ status: RunStatus.CANCELLED } as never);
    await dispatchRun(adapter(async () => { throw new Error('boom'); }), ctx);
    expect(transitionRunSpy).not.toHaveBeenCalled();
  });

  it('marks the run inflight while it executes', async () => {
    let release!: () => void;
    const promise = dispatchRun(adapter(() => new Promise<void>((r) => (release = r))), ctx);
    expect(isRunInflight('r1')).toBe(true);
    expect(inflightRunCount()).toBeGreaterThan(0);
    release();
    await promise;
    expect(isRunInflight('r1')).toBe(false);
  });
});

describe('failInterruptedRuns', () => {
  it('fails every RUNNING run and reports the count', async () => {
    prismaMock.agentRun.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }] as never);
    expect(await failInterruptedRuns()).toBe(2);
    expect(transitionRunSpy).toHaveBeenCalledWith('a', RunStatus.FAILED, { error: expect.stringContaining('restart') });
    expect(transitionRunSpy).toHaveBeenCalledWith('b', RunStatus.FAILED, expect.anything());
  });

  it('also reaps PAUSED runs (their in-memory transcript is lost on restart)', async () => {
    prismaMock.agentRun.findMany.mockResolvedValue([{ id: 'p' }] as never);
    await failInterruptedRuns();
    // the query must target both live states, not RUNNING alone
    expect(prismaMock.agentRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: [RunStatus.RUNNING, RunStatus.PAUSED] } },
      }),
    );
  });

  it('returns 0 when nothing is stale', async () => {
    prismaMock.agentRun.findMany.mockResolvedValue([] as never);
    expect(await failInterruptedRuns()).toBe(0);
  });
});
