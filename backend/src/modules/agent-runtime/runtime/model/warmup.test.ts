import { describe, it, expect, vi } from 'vitest';
import { warmLocalModel } from './warmup';
import type { ModelClient } from './types';

function stubClient(complete: ModelClient['complete']): ModelClient {
  return { model: 'm', complete, async *stream() { throw new Error('unused'); } };
}

describe('warmLocalModel', () => {
  it('warms when a local model is configured', async () => {
    const complete = vi.fn().mockResolvedValue({ content: '', toolCalls: [], finishReason: 'stop', usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, model: 'm' });
    const make = vi.fn(() => stubClient(complete));
    const ok = await warmLocalModel({ LUMEY_LOCAL_MODEL: 'qwen' } as NodeJS.ProcessEnv, make);
    expect(ok).toBe(true);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: 1 }));
  });

  it('is a no-op when no local model is configured', async () => {
    const make = vi.fn();
    expect(await warmLocalModel({} as NodeJS.ProcessEnv, make as never)).toBe(false);
    expect(make).not.toHaveBeenCalled();
  });

  it('is a no-op for a frontier backend', async () => {
    const make = vi.fn();
    expect(await warmLocalModel({ LUMEY_MODEL_BACKEND: 'frontier', LUMEY_LOCAL_MODEL: 'x' } as NodeJS.ProcessEnv, make as never)).toBe(false);
    expect(make).not.toHaveBeenCalled();
  });

  it('returns false (never throws) when the model is unreachable', async () => {
    const make = () => stubClient(async () => { throw new Error('ECONNREFUSED'); });
    expect(await warmLocalModel({ LUMEY_LOCAL_MODEL: 'qwen' } as NodeJS.ProcessEnv, make)).toBe(false);
  });
});
