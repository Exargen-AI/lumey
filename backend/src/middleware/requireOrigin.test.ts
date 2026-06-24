/**
 * 2026-05-23 — S-tier coverage for the CSRF defence.
 *
 * Refuses state-changing requests without an Origin/Referer header. Modern
 * browsers send Origin on every cross-origin AND same-origin mutation —
 * its absence on a cookie-bearing request is a strong CSRF smoke signal.
 *
 * Zero tests existed before this PR. The middleware is the first wall
 * against forged state-changing requests; if it ever weakens, every
 * mutation in the app becomes vulnerable to CSRF.
 *
 * Invariants pinned:
 *   - GET / HEAD / OPTIONS pass unconditionally (read-only / preflight)
 *   - POST / PUT / PATCH / DELETE require Origin OR Referer
 *   - Without either: 403 with the documented error shape
 *   - Public CMS paths bypass (rendered by external sites with API keys)
 *   - Webhook path bypasses (HMAC inside handler is the trust boundary)
 *   - The middleware never `next()`s twice on a single call (no double-handling)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireOrigin } from './requireOrigin';

function makeReq(opts: {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
}) {
  return {
    method: opts.method ?? 'POST',
    path: opts.path ?? '/api/v1/tasks',
    headers: opts.headers ?? {},
  } as any;
}

function makeRes() {
  const res: any = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res;
}

describe('requireOrigin — read-only methods pass through', () => {
  it.each(['GET', 'HEAD', 'OPTIONS', 'get', 'head', 'options'])(
    'allows %s with no Origin / Referer (case-insensitive)',
    (method) => {
      const next = vi.fn();
      const res = makeRes();
      requireOrigin(makeReq({ method, headers: {} }), res, next);
      expect(next).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    },
  );
});

describe('requireOrigin — state-changing methods require Origin or Referer', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    '%s WITH Origin header → passes',
    (method) => {
      const next = vi.fn();
      const res = makeRes();
      requireOrigin(
        makeReq({ method, headers: { origin: 'http://localhost:5174' } }),
        res,
        next,
      );
      expect(next).toHaveBeenCalledOnce();
      expect(res.status).not.toHaveBeenCalled();
    },
  );

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    '%s with ONLY Referer (no Origin) → passes (some legacy browsers omit Origin)',
    (method) => {
      const next = vi.fn();
      const res = makeRes();
      requireOrigin(
        makeReq({ method, headers: { referer: 'http://localhost:5174/dashboard' } }),
        res,
        next,
      );
      expect(next).toHaveBeenCalledOnce();
    },
  );

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    '%s WITHOUT Origin or Referer → 403 (CSRF smoke signal)',
    (method) => {
      const next = vi.fn();
      const res = makeRes();
      requireOrigin(makeReq({ method, headers: {} }), res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Origin header required for this request' },
      });
    },
  );
});

describe('requireOrigin — carve-outs for trusted public paths', () => {
  it('lets a POST to the GitHub webhook path through without Origin (HMAC is the trust boundary)', () => {
    const next = vi.fn();
    const res = makeRes();
    requireOrigin(
      makeReq({
        method: 'POST',
        path: '/api/v1/integrations/github/webhook',
        headers: {},
      }),
      res,
      next,
    );
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('lets a POST under /api/v1/cms/public/* through without Origin (per-project API key auth)', () => {
    const next = vi.fn();
    const res = makeRes();
    requireOrigin(
      makeReq({
        method: 'POST',
        path: '/api/v1/cms/public/foo/bar',
        headers: {},
      }),
      res,
      next,
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('does NOT carve out paths that merely START with /api/v1 (must be a documented carve-out prefix)', () => {
    const next = vi.fn();
    const res = makeRes();
    // /api/v1/tasks looks innocuous but is a real mutating endpoint —
    // not on the carve-out list, must be rejected without Origin.
    requireOrigin(makeReq({ method: 'POST', path: '/api/v1/tasks', headers: {} }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('requireOrigin — defensive behaviour', () => {
  it('does not double-call next() when the request is rejected', () => {
    const next = vi.fn();
    const res = makeRes();
    requireOrigin(makeReq({ method: 'POST', headers: {} }), res, next);
    expect(next).not.toHaveBeenCalled();
  });

  it('does not double-call next() on the happy path', () => {
    const next = vi.fn();
    const res = makeRes();
    requireOrigin(
      makeReq({ method: 'POST', headers: { origin: 'http://localhost:5174' } }),
      res,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});
