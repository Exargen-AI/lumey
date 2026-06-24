/**
 * Phase 2 of the baseline hardening plan — middleware critical tier.
 * `requireRoles` is the role-based authorization gate used on routes
 * where permission-key checks aren't granular enough. Target ≥ 95%.
 *
 * The whole behavior is just three states:
 *   1. No `req.user` (auth middleware ran but found no token) → 401
 *   2. `req.user.role` not in the allowed list → 403
 *   3. role match → next()
 *
 * Tiny surface, but every test here is a security assertion: an off-by-
 * one in the role-list check would silently widen access. Test the
 * boundary at every layer that touches authz.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requireRoles } from './requireRoles';

function buildContext(user?: { role: string } | null) {
  const req = { user } as unknown as Request;
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const res = { status } as unknown as Response;
  const next: NextFunction = vi.fn();
  return { req, res, next, status, json };
}

describe('requireRoles middleware', () => {
  it('calls next() when the user has one of the allowed roles', () => {
    const { req, res, next } = buildContext({ role: 'ADMIN' });
    requireRoles('ADMIN', 'SUPER_ADMIN')(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 401 when req.user is missing', () => {
    const { req, res, next, status, json } = buildContext(null);
    requireRoles('ADMIN')(req, res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when req.user is undefined', () => {
    const { req, res, next, status } = buildContext(undefined);
    requireRoles('ADMIN')(req, res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when role is authenticated but not in allowlist', () => {
    const { req, res, next, status, json } = buildContext({ role: 'ENGINEER' });
    requireRoles('ADMIN', 'SUPER_ADMIN')(req, res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Insufficient role access' },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('does NOT match on substring or case mismatch', () => {
    const { req, res, next, status } = buildContext({ role: 'admin' }); // lowercase
    requireRoles('ADMIN')(req, res, next);
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('treats an empty allowlist as deny-all (even for valid users)', () => {
    const { req, res, next, status } = buildContext({ role: 'SUPER_ADMIN' });
    requireRoles()(req, res, next);
    // No role can satisfy an empty allowlist — return 403.
    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('does not leak which role the user has in the 403 response body', () => {
    // Sanity: error message must not echo `req.user.role` (would help
    // an attacker confirm a session belongs to a privileged user).
    const { req, res, next, json } = buildContext({ role: 'ADMIN' });
    requireRoles('SUPER_ADMIN')(req, res, next);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Insufficient role access' },
    });
    expect(next).not.toHaveBeenCalled();
  });
});
