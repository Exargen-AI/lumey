import { describe, it, expect, vi } from 'vitest';
import { createLocalModelClient, createFrontierModelClient } from './factory';

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
