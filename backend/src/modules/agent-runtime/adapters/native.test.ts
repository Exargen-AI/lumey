import '../../../test/prismaMock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { RunStatus } from '@prisma/client';
import { prismaMock } from '../../../test/prismaMock';

const { appendStepSpy, transitionRunSpy } = vi.hoisted(() => ({
  appendStepSpy: vi.fn().mockResolvedValue({}),
  transitionRunSpy: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../../services/agentRun.service', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  appendStep: appendStepSpy,
  transitionRun: transitionRunSpy,
}));

import { createNativeAdapter } from './native';
import { WorktreeSandbox } from '../runtime/sandbox/worktreeSandbox';
import type { ModelClient, ModelResponse } from '../runtime/model/types';
import type { RunContext } from '../runtimeAdapter';

const CTX: RunContext = {
  runId: 'r1',
  taskId: 't1',
  agentId: 'a1',
  task: { title: 'Do a thing', description: null, acceptanceCriteria: [] },
};

function modelSaying(content: string): ModelClient {
  return {
    model: 'mock',
    async complete(): Promise<ModelResponse> {
      return { content, toolCalls: [], finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 1 }, model: 'mock' };
    },
    async *stream() {
      throw new Error('unused');
    },
  };
}

async function tempSandbox() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lumey-native-test-'));
  return WorktreeSandbox.forDir(dir, { owned: true });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('nativeAdapter.execute', () => {
  it('runs the loop and drives the run through the service to AWAITING_REVIEW', async () => {
    const adapter = createNativeAdapter({
      modelFactory: () => modelSaying('All done; please review.'),
      sandboxFactory: tempSandbox,
    });
    await adapter.execute(CTX);

    expect(transitionRunSpy).toHaveBeenNthCalledWith(1, 'r1', RunStatus.RUNNING);
    expect(transitionRunSpy).toHaveBeenLastCalledWith('r1', RunStatus.AWAITING_REVIEW, expect.objectContaining({ summary: expect.stringContaining('done') }));
    expect(appendStepSpy).toHaveBeenCalled();
    // run usage was persisted
    expect(prismaMock.agentRun.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ totalTokens: 1 }) }));
  });

  it('fails the run with a clear error when no model is configured', async () => {
    prismaMock.agentRun.findUnique.mockResolvedValue({ status: RunStatus.QUEUED } as never);
    const adapter = createNativeAdapter({
      modelFactory: () => {
        throw new Error('no model configured');
      },
    });
    await adapter.execute(CTX);

    expect(transitionRunSpy).toHaveBeenCalledWith('r1', RunStatus.FAILED, { error: 'no model configured' });
  });

  it('reports honest capabilities (self-hosted, single-agent)', () => {
    const adapter = createNativeAdapter({ modelFactory: () => modelSaying('x') });
    expect(adapter.id).toBe('native');
    expect(adapter.capabilities()).toMatchObject({ selfHosted: true, multiAgent: false });
  });
});

describe('nativeAdapter.cancel', () => {
  it('cancels a non-inflight, non-terminal run via the service', async () => {
    prismaMock.agentRun.findUnique.mockResolvedValue({ status: RunStatus.RUNNING } as never);
    const adapter = createNativeAdapter({ modelFactory: () => modelSaying('x') });
    await adapter.cancel('r1');
    expect(transitionRunSpy).toHaveBeenCalledWith('r1', RunStatus.CANCELLED);
  });

  it('is a no-op on an already-terminal run', async () => {
    prismaMock.agentRun.findUnique.mockResolvedValue({ status: RunStatus.SUCCEEDED } as never);
    const adapter = createNativeAdapter({ modelFactory: () => modelSaying('x') });
    await adapter.cancel('r1');
    expect(transitionRunSpy).not.toHaveBeenCalled();
  });
});
