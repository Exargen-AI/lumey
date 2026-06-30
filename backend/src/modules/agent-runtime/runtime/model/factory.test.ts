import { describe, it, expect, vi } from 'vitest';
import { createLocalModelClient, createFrontierModelClient, modelClientFromEnv, modelClientForContext } from './factory';

function captureFetch() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return Object.assign(fn, { calls });
}

const REQ = { messages: [{ role: 'user' as const, content: 'hi' }] };

describe('createLocalModelClient', () => {
  it('defaults to the local Ollama endpoint and sends no auth header', async () => {
    const f = captureFetch();
    await createLocalModelClient({ model: 'llama3.1', fetchImpl: f }).complete(REQ);
    expect(f.calls[0].url).toBe('http://localhost:11434/v1/chat/completions');
    expect((f.calls[0].init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('honours an explicit baseUrl (e.g. a vLLM server)', async () => {
    const f = captureFetch();
    await createLocalModelClient({ model: 'mixtral', baseUrl: 'http://gpu-box:8000/v1', fetchImpl: f }).complete(REQ);
    expect(f.calls[0].url).toBe('http://gpu-box:8000/v1/chat/completions');
  });
});

describe('createFrontierModelClient', () => {
  it('requires an API key', () => {
    expect(() =>
      createFrontierModelClient({ baseUrl: 'https://gw/v1', model: 'big', apiKey: '', fetchImpl: vi.fn() as unknown as typeof fetch }),
    ).toThrow(/apiKey/);
  });

  it('sends the bearer token', async () => {
    const f = captureFetch();
    await createFrontierModelClient({ baseUrl: 'https://gw/v1', model: 'big', apiKey: 'sk-live', fetchImpl: f }).complete(REQ);
    expect((f.calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer sk-live');
  });
});

describe('modelClientFromEnv', () => {
  it('builds a local client by default', () => {
    expect(modelClientFromEnv({ LUMEY_LOCAL_MODEL: 'llama3.1' } as NodeJS.ProcessEnv).model).toBe('llama3.1');
  });

  it('throws when no provider is configured at all', () => {
    expect(() => modelClientFromEnv({} as NodeJS.ProcessEnv)).toThrow(/no model provider configured/);
  });

  it('builds a frontier client when selected and fully configured', () => {
    const c = modelClientFromEnv({
      LUMEY_MODEL_BACKEND: 'frontier',
      LUMEY_FRONTIER_URL: 'https://gw/v1',
      LUMEY_FRONTIER_MODEL: 'big',
      LUMEY_FRONTIER_API_KEY: 'sk',
    } as NodeJS.ProcessEnv);
    expect(c.model).toBe('big');
  });

  it('falls back to a configured tier when the backend hint is unconfigured', () => {
    // backend hints frontier but only local is set — the router uses local.
    const c = modelClientFromEnv({ LUMEY_MODEL_BACKEND: 'frontier', LUMEY_LOCAL_MODEL: 'qwen' } as NodeJS.ProcessEnv);
    expect(c.model).toBe('qwen');
  });
});

describe('modelClientForContext (per-agent routing)', () => {
  const env = {
    LUMEY_LOCAL_MODEL: 'qwen',
    LUMEY_SELFHOSTED_MODEL: 'mixtral',
    LUMEY_SELFHOSTED_URL: 'https://gpu/v1',
  } as NodeJS.ProcessEnv;

  it("routes to the tier serving the agent's preferred model", () => {
    expect(modelClientForContext({ preferredModel: 'mixtral' }, env).model).toBe('mixtral');
  });

  it('falls back to the default tier when the preference is unknown', () => {
    expect(modelClientForContext({ preferredModel: 'nope' }, env).model).toBe('qwen');
  });
});
