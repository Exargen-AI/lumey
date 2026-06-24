import './../../../test/prismaMock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../../../test/prismaMock';
import { RunStatus, RunStepType } from '@prisma/client';

const { transitionSpy, appendStepSpy } = vi.hoisted(() => ({
  transitionSpy: vi.fn().mockResolvedValue({}),
  appendStepSpy: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../../services/agentRun.service', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  transitionRun: transitionSpy,
  appendStep: appendStepSpy,
}));

import { referenceAdapter } from './reference';

const ctx = {
  runId: 'r1',
  taskId: 't1',
  agentId: 'a1',
  task: { title: 'Build login', description: null, acceptanceCriteria: [] },
} as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('referenceAdapter', () => {
  it('reports honest capabilities', () => {
    expect(referenceAdapter.id).toBe('reference');
    expect(referenceAdapter.capabilities()).toEqual({
      selfHosted: true,
      memory: false,
      outcomes: false,
      multiAgent: false,
    });
  });

  it('drives the run RUNNING → step trace → AWAITING_REVIEW', async () => {
    await referenceAdapter.execute(ctx as never);

    expect(transitionSpy).toHaveBeenNthCalledWith(1, 'r1', RunStatus.RUNNING);
    expect(transitionSpy).toHaveBeenLastCalledWith(
      'r1',
      RunStatus.AWAITING_REVIEW,
      expect.objectContaining({ summary: expect.any(String) }),
    );

    const stepTypes = appendStepSpy.mock.calls.map((c) => (c[1] as { type: RunStepType }).type);
    expect(stepTypes).toEqual([
      RunStepType.PLAN,
      RunStepType.EDIT,
      RunStepType.TEST,
      RunStepType.REVIEW_REQUEST,
    ]);
  });

  it('cancel transitions a non-terminal run to CANCELLED', async () => {
    prismaMock.agentRun.findUnique.mockResolvedValue({ status: RunStatus.RUNNING } as never);
    await referenceAdapter.cancel('r1');
    expect(transitionSpy).toHaveBeenCalledWith('r1', RunStatus.CANCELLED);
  });

  it('cancel is a no-op on a terminal run', async () => {
    prismaMock.agentRun.findUnique.mockResolvedValue({ status: RunStatus.SUCCEEDED } as never);
    await referenceAdapter.cancel('r1');
    expect(transitionSpy).not.toHaveBeenCalled();
  });
});
