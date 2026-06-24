/**
 * Pulse productivity-score access gate — unit tests.
 *
 * Pins the SUPER_ADMIN-only invariant. If anyone in the future tries
 * to relax this gate ("oh, ADMIN should be allowed too") these tests
 * will fail, forcing a deliberate decision rather than a silent
 * permission drift.
 *
 * Covers:
 *   - 401 when no user
 *   - 403 with PRODUCTIVITY_SCORE_FORBIDDEN code for non-SUPER_ADMIN
 *     roles (ENGINEER, PM, DESIGNER, OPS, SALES, FOUNDER, ADMIN, CLIENT)
 *   - next() called for SUPER_ADMIN
 *   - Service-layer guard mirrors the middleware behaviour
 */

import { describe, it, expect, vi } from 'vitest';
import {
  requireProductivityScoreAccess,
  assertProductivityScoreAccess,
  ProductivityScoreAccessError,
} from './requireProductivityScoreAccess';
import type { Request, Response, NextFunction } from 'express';

function makeReqRes(user?: { role: string } | null) {
  const req = { user } as unknown as Request;
  const json = vi.fn();
  const res = {
    status: vi.fn(() => ({ json })),
  } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next, json };
}

const NON_SUPER_ADMIN_ROLES = [
  'ENGINEER',
  'PM',
  'DESIGNER',
  'OPS',
  'SALES',
  'FOUNDER',
  'ADMIN',
  'CLIENT',
  'EXECUTIVE',
  'GUEST',
];

describe('requireProductivityScoreAccess (middleware)', () => {
  it('returns 401 with UNAUTHORIZED when no user on the request', () => {
    const { req, res, next, json } = makeReqRes(null);
    requireProductivityScoreAccess(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'UNAUTHORIZED', message: expect.any(String) },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it.each(NON_SUPER_ADMIN_ROLES)(
    'returns 403 with PRODUCTIVITY_SCORE_FORBIDDEN for role=%s',
    (role) => {
      const { req, res, next, json } = makeReqRes({ role });
      requireProductivityScoreAccess(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(json).toHaveBeenCalledWith({
        success: false,
        error: expect.objectContaining({
          code: 'PRODUCTIVITY_SCORE_FORBIDDEN',
          // Message must explicitly call out SUPER_ADMIN so audit logs
          // make the intent obvious.
          message: expect.stringContaining('SUPER_ADMIN'),
        }),
      });
      expect(next).not.toHaveBeenCalled();
    },
  );

  it('calls next() for SUPER_ADMIN', () => {
    const { req, res, next } = makeReqRes({ role: 'SUPER_ADMIN' });
    requireProductivityScoreAccess(req, res, next);
    expect(res.status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
    // next() called with no arguments = no error.
    expect((next as unknown as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([]);
  });

  it('uses a code distinct from the generic role-check 403', () => {
    // Pinning the code name so log-search tooling can rely on it. If
    // someone renames the code, audit tooling has to be updated too —
    // this test catches that drift.
    const { req, res, json } = makeReqRes({ role: 'ENGINEER' });
    const next = vi.fn() as NextFunction;
    requireProductivityScoreAccess(req, res, next);
    const errBody = (json as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(errBody.error.code).toBe('PRODUCTIVITY_SCORE_FORBIDDEN');
    expect(errBody.error.code).not.toBe('FORBIDDEN'); // not the generic one
  });
});

describe('assertProductivityScoreAccess (service-layer guard)', () => {
  it('throws ProductivityScoreAccessError when user is null', () => {
    expect(() => assertProductivityScoreAccess(null)).toThrow(ProductivityScoreAccessError);
    expect(() => assertProductivityScoreAccess(undefined)).toThrow(ProductivityScoreAccessError);
  });

  it.each(NON_SUPER_ADMIN_ROLES)('throws for role=%s', (role) => {
    expect(() => assertProductivityScoreAccess({ role })).toThrow(
      ProductivityScoreAccessError,
    );
  });

  it('does not throw for SUPER_ADMIN', () => {
    expect(() => assertProductivityScoreAccess({ role: 'SUPER_ADMIN' })).not.toThrow();
  });

  it('thrown error carries the PRODUCTIVITY_SCORE_FORBIDDEN code and 403 status', () => {
    try {
      assertProductivityScoreAccess({ role: 'ENGINEER' });
    } catch (err) {
      expect(err).toBeInstanceOf(ProductivityScoreAccessError);
      const e = err as ProductivityScoreAccessError;
      expect(e.code).toBe('PRODUCTIVITY_SCORE_FORBIDDEN');
      expect(e.statusCode).toBe(403);
      return;
    }
    expect.fail('Expected ProductivityScoreAccessError');
  });

  it('narrows the type so callers do not have to re-check (compile-time check)', () => {
    // This block compiles only if the assertion narrows the type.
    // Runtime check is a smoke test of the same.
    function consumer(user: { role: string }): string {
      assertProductivityScoreAccess(user);
      // After the assertion, TS knows user.role is 'SUPER_ADMIN'.
      const r: 'SUPER_ADMIN' = user.role;
      return r;
    }
    expect(consumer({ role: 'SUPER_ADMIN' })).toBe('SUPER_ADMIN');
  });
});
