/**
 * 2026-05-23 — Layer 2 / agent control plane.
 *
 * Tests for the Idempotency-Key middleware. Combined with
 * `idempotency.service.test.ts` (service-layer contract), these tests
 * cover the request-level wiring: header parsing, cache hit replay,
 * res.json wrapping for capture, auth-required path, GET/HEAD bypass.
 */

import './../test/prismaMock';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import { idempotencyKey } from './idempotencyKey';

function makeReq(opts: {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  body?: any;
  user?: { id: string; role?: string };
  route?: { path: string };
  baseUrl?: string;
}) {
  const headers = opts.headers ?? {};
  return {
    method: opts.method ?? 'POST',
    body: opts.body ?? {},
    user: opts.user,
    route: opts.route,
    baseUrl: opts.baseUrl ?? '/api/v1',
    originalUrl: opts.path ?? '/api/v1/tasks',
    url: opts.path ?? '/tasks',
    header: (name: string) => headers[name.toLowerCase()],
  } as any;
}

function makeRes() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    status: vi.fn(function (this: any, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(function (this: any, body: any) {
      this._jsonBody = body;
      return this;
    }),
    setHeader: vi.fn(function (this: any, k: string, v: string) {
      this.headers[k] = v;
      return this;
    }),
  };
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('idempotencyKey — method gating', () => {
  it.each(['GET', 'HEAD', 'OPTIONS'])(
    '%s requests bypass the middleware regardless of header',
    async (method) => {
      const next = vi.fn();
      await idempotencyKey(
        makeReq({
          method,
          headers: { 'idempotency-key': 'abc' },
          user: { id: 'u1' },
        }),
        makeRes(),
        next,
      );
      expect(next).toHaveBeenCalledOnce();
      expect(prismaMock.idempotencyKey.findUnique).not.toHaveBeenCalled();
    },
  );

  it('POST without header bypasses (opt-in contract)', async () => {
    const next = vi.fn();
    await idempotencyKey(makeReq({ method: 'POST', user: { id: 'u1' } }), makeRes(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(prismaMock.idempotencyKey.findUnique).not.toHaveBeenCalled();
  });
});

describe('idempotencyKey — input validation', () => {
  it('400 on empty key string', async () => {
    const next = vi.fn();
    const res = makeRes();
    await idempotencyKey(
      makeReq({
        method: 'POST',
        headers: { 'idempotency-key': '   ' },
        user: { id: 'u1' },
      }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('400 on key longer than 255 chars', async () => {
    const next = vi.fn();
    const res = makeRes();
    await idempotencyKey(
      makeReq({
        method: 'POST',
        headers: { 'idempotency-key': 'x'.repeat(256) },
        user: { id: 'u1' },
      }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('idempotencyKey — auth gate', () => {
  it('401 when req.user is missing (idempotency is per-user, no scope without auth)', async () => {
    const next = vi.fn();
    const res = makeRes();
    await idempotencyKey(
      makeReq({
        method: 'POST',
        headers: { 'idempotency-key': 'abc' },
        user: undefined,
      }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('idempotencyKey — cache hit (replay)', () => {
  it('replays the stored response without calling next()', async () => {
    prismaMock.idempotencyKey.findUnique.mockResolvedValue({
      requestHash: expect.any(String), // bypassed by mock setup below
      statusCode: 201,
      responseBody: { success: true, data: { id: 'task-1' } },
      expiresAt: new Date(Date.now() + 60_000),
    } as any);

    // We need the requestHash to actually match for the hit branch.
    // Easier: stub findUnique with the canonical-hashed value of the
    // body we'll send. But computeRequestHash is deterministic, so
    // we can compute it inline.
    const { computeRequestHash } = await import('../services/idempotency.service');
    const expectedHash = computeRequestHash('POST', '/api/v1/tasks', { title: 'X' });
    prismaMock.idempotencyKey.findUnique.mockResolvedValue({
      requestHash: expectedHash,
      statusCode: 201,
      responseBody: { success: true, data: { id: 'task-1' } },
      expiresAt: new Date(Date.now() + 60_000),
    } as any);

    const next = vi.fn();
    const res = makeRes();
    await idempotencyKey(
      makeReq({
        method: 'POST',
        body: { title: 'X' },
        headers: { 'idempotency-key': 'abc' },
        user: { id: 'u1' },
        route: { path: '/tasks' },
      }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { id: 'task-1' } });
    // Stripe-style header signaling the replay
    expect(res.setHeader).toHaveBeenCalledWith('X-Idempotent-Replay', 'true');
  });
});

describe('idempotencyKey — cache miss (handler runs, response captured)', () => {
  it('calls next() and replaces res.json so the response can be captured', async () => {
    prismaMock.idempotencyKey.findUnique.mockResolvedValue(null);
    prismaMock.idempotencyKey.create.mockResolvedValue({} as any);

    const next = vi.fn();
    const res = makeRes();
    const originalJsonRef = res.json;
    const req = makeReq({
      method: 'POST',
      body: { title: 'X' },
      headers: { 'idempotency-key': 'abc' },
      user: { id: 'u1' },
      route: { path: '/tasks' },
    });

    await idempotencyKey(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    // The wrap: res.json is REPLACED with the capturing wrapper. The
    // original spy is no longer the value at res.json.
    expect(res.json).not.toBe(originalJsonRef);
  });

  it('captures the response and persists it (storage fires via vi.waitFor for the async settle)', async () => {
    prismaMock.idempotencyKey.findUnique.mockResolvedValue(null);
    prismaMock.idempotencyKey.create.mockResolvedValue({} as any);

    const next = vi.fn();
    const res = makeRes();
    const req = makeReq({
      method: 'POST',
      body: { title: 'X' },
      headers: { 'idempotency-key': 'abc' },
      user: { id: 'u1' },
      route: { path: '/tasks' },
    });

    await idempotencyKey(req, res, next);
    // Simulate the handler completing.
    res.statusCode = 201;
    res.json({ success: true, data: { id: 'task-1' } });

    // Wait for the fire-and-forget persist to land. vi.waitFor polls
    // up to its default 1s — plenty for a synchronous mock.
    await vi.waitFor(() => {
      expect(prismaMock.idempotencyKey.create).toHaveBeenCalled();
    });
    const createArgs = prismaMock.idempotencyKey.create.mock.calls[0]?.[0] as any;
    expect(createArgs.data.statusCode).toBe(201);
    expect(createArgs.data.responseBody).toEqual({ success: true, data: { id: 'task-1' } });
    expect(createArgs.data.key).toBe('abc');
    expect(createArgs.data.userId).toBe('u1');
  });
});

describe('idempotencyKey — hash-mismatch (key reused with different body)', () => {
  it('forwards ConflictError to next() so errorHandler renders 409', async () => {
    // Stored row has hash H1; incoming body produces H2 — middleware
    // throws via the service, caller (next) handles it.
    prismaMock.idempotencyKey.findUnique.mockResolvedValue({
      requestHash: 'some-OTHER-hash',
      statusCode: 201,
      responseBody: { some: 'thing' },
      expiresAt: new Date(Date.now() + 60_000),
    } as any);

    const next = vi.fn();
    const res = makeRes();
    await idempotencyKey(
      makeReq({
        method: 'POST',
        body: { title: 'new body' },
        headers: { 'idempotency-key': 'abc' },
        user: { id: 'u1' },
        route: { path: '/tasks' },
      }),
      res,
      next,
    );
    expect(next).toHaveBeenCalledOnce();
    const err = next.mock.calls[0]?.[0];
    expect(err?.statusCode).toBe(409);
  });
});
