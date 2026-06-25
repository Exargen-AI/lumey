import { describe, it, expect } from 'vitest';
import { createEmbeddingClient, embeddingClientFromEnv } from './embeddingClient';

function fakeFetch(body: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
  return Object.assign(fn, { calls });
}

describe('createEmbeddingClient', () => {
  it('embeds text via the OpenAI-compatible /embeddings endpoint', async () => {
    const f = fakeFetch({ data: [{ embedding: [0.1, 0.2, 0.3] }] });
    const client = createEmbeddingClient({ baseUrl: 'http://local/v1', model: 'nomic-embed-text', fetchImpl: f });
    expect(await client.embed('hello')).toEqual([0.1, 0.2, 0.3]);
    expect(f.calls[0].url).toBe('http://local/v1/embeddings');
    expect(JSON.parse(f.calls[0].init.body as string)).toEqual({ model: 'nomic-embed-text', input: ['hello'] });
  });

  it('embedMany returns one vector per input', async () => {
    const f = fakeFetch({ data: [{ embedding: [1, 0] }, { embedding: [0, 1] }] });
    const client = createEmbeddingClient({ baseUrl: 'http://local/v1', model: 'm', fetchImpl: f });
    expect(await client.embedMany(['a', 'b'])).toEqual([[1, 0], [0, 1]]);
  });

  it('throws on a non-ok response', async () => {
    const client = createEmbeddingClient({ baseUrl: 'http://local/v1', model: 'm', fetchImpl: fakeFetch({}, 500) });
    await expect(client.embed('x')).rejects.toThrow(/embedding request failed/);
  });

  it('requires baseUrl and model', () => {
    expect(() => createEmbeddingClient({ baseUrl: '', model: 'm' })).toThrow(/required/);
  });
});

describe('embeddingClientFromEnv', () => {
  it('returns null when no embedding model is configured (recall stays recency)', () => {
    expect(embeddingClientFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('builds a local client when LUMEY_EMBED_MODEL is set', () => {
    expect(embeddingClientFromEnv({ LUMEY_EMBED_MODEL: 'nomic-embed-text' } as NodeJS.ProcessEnv)?.model).toBe('nomic-embed-text');
  });
});
