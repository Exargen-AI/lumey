import { describe, it, expect, vi } from 'vitest';
import { HttpTransport } from './transport';
import { LumeyAuthError, LumeyConnectionError, LumeyUnavailableError, BudgetExceededError } from './errors';

function fakeRes(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function queue(responses: Array<Response | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  return Object.assign(fn, { calls });
}

function transport(fetchImpl: typeof fetch, over = {}) {
  return new HttpTransport({ baseUrl: 'http://api/v1', token: 'tok', fetchImpl, sleepImpl: vi.fn().mockResolvedValue(undefined), ...over });
}

describe('HttpTransport', () => {
  it('unwraps the {success,data} envelope and sends auth', async () => {
    const f = queue([fakeRes(200, { success: true, data: { hello: 'world' } })]);
    const out = await transport(f).request('GET', '/thing');
    expect(out).toEqual({ hello: 'world' });
    expect((f.calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(f.calls[0].url).toBe('http://api/v1/thing');
  });

  it('builds a query string', async () => {
    const f = queue([fakeRes(200, { data: {} })]);
    await transport(f).request('GET', '/x', { query: { a: '1', skip: undefined, b: 2 } });
    expect(f.calls[0].url).toBe('http://api/v1/x?a=1&b=2');
  });

  it('adds an idempotency key on writes only', async () => {
    const f = queue([fakeRes(200, { data: {} }), fakeRes(200, { data: {} })]);
    const t = transport(f);
    await t.request('GET', '/r');
    await t.request('POST', '/w', { body: {} });
    expect((f.calls[0].init.headers as Record<string, string>)['idempotency-key']).toBeUndefined();
    expect((f.calls[1].init.headers as Record<string, string>)['idempotency-key']).toBeTruthy();
  });

  it('maps 401 to LumeyAuthError (no retry)', async () => {
    const f = queue([fakeRes(401, { error: { message: 'nope' } })]);
    await expect(transport(f).request('GET', '/x')).rejects.toBeInstanceOf(LumeyAuthError);
    expect(f.calls).toHaveLength(1);
  });

  it('maps a platform error code to a specific error class', async () => {
    const f = queue([fakeRes(409, { error: { code: 'BUDGET_EXCEEDED', message: 'over budget', runId: 'r9' } })]);
    const err = await transport(f).request('GET', '/x').catch((e) => e);
    expect(err).toBeInstanceOf(BudgetExceededError);
    expect((err as BudgetExceededError).runId).toBe('r9');
  });

  it('retries a 503 then succeeds', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const f = queue([fakeRes(503, { error: {} }), fakeRes(200, { data: { ok: true } })]);
    const out = await transport(f, { sleepImpl: sleep }).request('GET', '/x');
    expect(out).toEqual({ ok: true });
    expect(f.calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('exhausts retries on persistent 500', async () => {
    const f = queue([fakeRes(500, { error: {} })]);
    await expect(transport(f, { maxRetries: 2 }).request('GET', '/x')).rejects.toBeInstanceOf(LumeyUnavailableError);
    expect(f.calls).toHaveLength(3);
  });

  it('wraps a network failure as a retryable LumeyConnectionError', async () => {
    const f = queue([new TypeError('socket hang up')]);
    await expect(transport(f, { maxRetries: 0 }).request('GET', '/x')).rejects.toBeInstanceOf(LumeyConnectionError);
  });
});
