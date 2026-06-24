import { describe, it, expect, vi } from 'vitest';
import { HttpModelClient } from './httpModelClient';
import {
  ModelAuthError,
  ModelProtocolError,
  ModelRateLimitError,
  ModelRequestError,
  ModelTimeoutError,
  ModelTransportError,
  ModelUnavailableError,
} from './errors';
import type { CompletionRequest } from './types';

/** A minimal fake Response good enough for the client's needs. */
function fakeJson(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
  } as unknown as Response;
}

function fakeStream(chunks: string[]): Response {
  const enc = new TextEncoder();
  async function* gen() {
    for (const c of chunks) yield enc.encode(c);
  }
  return { ok: true, status: 200, body: gen() } as unknown as Response;
}

/** A fetch stub that plays a queue of responses/errors and records its calls. */
function queueFetch(responses: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  return Object.assign(fn, { calls });
}

const REQ: CompletionRequest = { messages: [{ role: 'user', content: 'hi' }] };

function client(fetchImpl: typeof fetch, over: Record<string, unknown> = {}) {
  return new HttpModelClient({
    baseUrl: 'http://local/v1',
    model: 'm1',
    fetchImpl,
    sleepImpl: vi.fn().mockResolvedValue(undefined),
    ...over,
  });
}

describe('HttpModelClient.complete', () => {
  it('maps content, usage, finishReason, and served model', async () => {
    const f = queueFetch([
      fakeJson({
        model: 'm1-actual',
        choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
      }),
    ]);
    const res = await client(f).complete(REQ);
    expect(res).toEqual({
      content: 'hello',
      toolCalls: [],
      finishReason: 'stop',
      usage: { promptTokens: 7, completionTokens: 3, totalTokens: 10 },
      model: 'm1-actual',
    });
  });

  it('parses tool calls and reports tool_calls finish reason', async () => {
    const f = queueFetch([
      fakeJson({
        choices: [
          {
            message: {
              content: null,
              tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read', arguments: '{"path":"a.ts"}' } }],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }),
    ]);
    const res = await client(f).complete(REQ);
    expect(res.content).toBe('');
    expect(res.finishReason).toBe('tool_calls');
    expect(res.toolCalls).toEqual([{ id: 'c1', name: 'read', arguments: '{"path":"a.ts"}' }]);
  });

  it('sends an OpenAI-compatible body with tools, auth header, and the right URL', async () => {
    const f = queueFetch([fakeJson({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] })]);
    await client(f, { apiKey: 'sk-test' }).complete({
      messages: [{ role: 'user', content: 'go' }],
      tools: [{ name: 'grep', description: 'search', parameters: { type: 'object' } }],
      toolChoice: 'auto',
      temperature: 0.2,
      maxTokens: 256,
    });
    expect(f.calls[0].url).toBe('http://local/v1/chat/completions');
    expect((f.calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    const body = JSON.parse(f.calls[0].init.body as string);
    expect(body.model).toBe('m1');
    expect(body.stream).toBe(false);
    expect(body.tool_choice).toBe('auto');
    expect(body.tools[0].function.name).toBe('grep');
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(256);
  });

  it('serializes assistant tool calls and tool results back onto the wire', async () => {
    const f = queueFetch([fakeJson({ choices: [{ message: { content: 'done' }, finish_reason: 'stop' }] })]);
    await client(f).complete({
      messages: [
        { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'read', arguments: '{}' }] },
        { role: 'tool', content: 'file body', toolCallId: 'c1', name: 'read' },
      ],
    });
    const body = JSON.parse(f.calls[0].init.body as string);
    expect(body.messages[0].tool_calls[0]).toEqual({ id: 'c1', type: 'function', function: { name: 'read', arguments: '{}' } });
    expect(body.messages[1]).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'file body' });
  });

  it('throws ModelProtocolError on a 2xx with no choices', async () => {
    const f = queueFetch([fakeJson({ choices: [] })]);
    await expect(client(f).complete(REQ)).rejects.toBeInstanceOf(ModelProtocolError);
  });
});

describe('HttpModelClient error classification & retries', () => {
  it('maps 401 to a non-retryable ModelAuthError (no retry)', async () => {
    const f = queueFetch([fakeJson('nope', 401)]);
    await expect(client(f).complete(REQ)).rejects.toBeInstanceOf(ModelAuthError);
    expect(f.calls).toHaveLength(1);
  });

  it('maps a 400 to ModelRequestError carrying the body, no retry', async () => {
    const f = queueFetch([fakeJson('bad tool schema', 400)]);
    const err = await client(f).complete(REQ).catch((e) => e);
    expect(err).toBeInstanceOf(ModelRequestError);
    expect((err as ModelRequestError).message).toContain('bad tool schema');
    expect(f.calls).toHaveLength(1);
  });

  it('retries a 429 then succeeds', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const f = queueFetch([fakeJson('slow down', 429), fakeJson({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] })]);
    const res = await client(f, { sleepImpl: sleep }).complete(REQ);
    expect(res.content).toBe('ok');
    expect(f.calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('exhausts retries on persistent 503 and throws ModelUnavailableError', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const f = queueFetch([fakeJson('down', 503)]);
    await expect(client(f, { sleepImpl: sleep, maxRetries: 2 }).complete(REQ)).rejects.toBeInstanceOf(ModelUnavailableError);
    expect(f.calls).toHaveLength(3); // 1 + 2 retries
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('wraps a transport failure as a retryable ModelTransportError', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const f = queueFetch([new TypeError('socket hang up')]);
    await expect(client(f, { sleepImpl: sleep, maxRetries: 1 }).complete(REQ)).rejects.toBeInstanceOf(ModelTransportError);
    expect(f.calls).toHaveLength(2);
  });

  it('propagates a caller cancellation without wrapping or retrying', async () => {
    const abortErr = new DOMException('aborted', 'AbortError');
    const f = queueFetch([abortErr]);
    const signal = AbortSignal.abort();
    await expect(client(f).complete({ ...REQ, signal })).rejects.toBe(abortErr);
    expect(f.calls).toHaveLength(1);
  });

  it('raises ModelTimeoutError when the deadline fires', async () => {
    // A fetch that never resolves until its signal aborts → our timeout trips it.
    const hangFetch = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      })) as unknown as typeof fetch;
    await expect(client(hangFetch, { timeoutMs: 5, maxRetries: 0 }).complete(REQ)).rejects.toBeInstanceOf(ModelTimeoutError);
  });
});

describe('HttpModelClient.stream', () => {
  it('yields text deltas and a terminal finish reason', async () => {
    const f = queueFetch([
      fakeStream([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n',
        'data: [DONE]\n',
      ]),
    ]);
    const chunks = [];
    for await (const c of client(f).stream(REQ)) chunks.push(c);
    expect(chunks.map((c) => c.delta).join('')).toBe('Hello');
    expect(chunks.at(-1)?.finishReason).toBe('stop');
  });

  it('requests a streaming body with usage included', async () => {
    const f = queueFetch([fakeStream(['data: [DONE]\n'])]);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _ of client(f).stream(REQ)) { /* drain */ }
    const body = JSON.parse(f.calls[0].init.body as string);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });
});

describe('HttpModelClient construction', () => {
  it('requires baseUrl and model', () => {
    expect(() => new HttpModelClient({ baseUrl: '', model: 'm', fetchImpl: queueFetch([]) })).toThrow(/baseUrl/);
    expect(() => new HttpModelClient({ baseUrl: 'x', model: '', fetchImpl: queueFetch([]) })).toThrow(/model/);
  });
});
