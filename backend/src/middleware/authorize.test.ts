/**
 * Phase 2.3 of the baseline hardening plan — critical-tier authz spine.
 *
 * `authorize(permissionKey)` is the per-permission gate that runs after
 * `authenticate` populates `req.user`. It delegates the policy lookup
 * to `rbac.service.checkPermissionForUser` (2026-05-30 — switched from
 * `checkPermission(role, key)` so per-user additive grants like the
 * extended CLIENT access flag are honoured).
 *
 * The tests here lock in the contract between authorize and the rbac
 * layer:
 *   - 401 BEFORE the permission check when no user is attached.
 *   - The permission key is passed verbatim — no normalization, no
 *     prefix tricks.
 *   - The full user object is passed through — preserves role AND
 *     `extendedClientAccess` so the per-user grant works.
 *   - `false` from the rbac check → 403, `true` → next().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the rbac service entries this middleware touches. We mock both
// `checkPermission` (legacy, kept for back-compat with other callers)
// and `checkPermissionForUser` (the path the middleware now uses) so
// the import surface stays whole.
vi.mock('../services/rbac.service', () => ({
  __esModule: true,
  checkPermission: vi.fn(),
  checkPermissionForUser: vi.fn(),
}));

import { authorize } from './authorize';
import { checkPermission, checkPermissionForUser } from '../services/rbac.service';

const mockedCheckPermission = vi.mocked(checkPermission);
const mockedCheckPermissionForUser = vi.mocked(checkPermissionForUser);

function buildContext(user?: { role: string } | null) {
  const req: any = { user };
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const res = { status } as any;
  const next = vi.fn();
  return { req, res, next, status, json };
}

beforeEach(() => {
  mockedCheckPermission.mockReset();
  mockedCheckPermissionForUser.mockReset();
});

describe('authorize middleware', () => {
  it('returns 401 BEFORE the permission check when req.user is missing', async () => {
    const { req, res, next, status, json } = buildContext(null);

    await authorize('task.edit_any')(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
    });
    expect(next).not.toHaveBeenCalled();
    // Don't waste a DB / cache lookup when the request is anonymous.
    expect(mockedCheckPermissionForUser).not.toHaveBeenCalled();
  });

  it('calls checkPermissionForUser with the full user + permission key verbatim', async () => {
    mockedCheckPermissionForUser.mockResolvedValue(true);
    const { req, res, next } = buildContext({ role: 'PRODUCT_MANAGER' });

    await authorize('milestone.edit')(req, res, next);

    expect(mockedCheckPermissionForUser).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'PRODUCT_MANAGER' }),
      'milestone.edit',
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 403 when checkPermissionForUser resolves to false', async () => {
    mockedCheckPermissionForUser.mockResolvedValue(false);
    const { req, res, next, status, json } = buildContext({ role: 'CLIENT' });

    await authorize('task.delete')(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Insufficient permissions' },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('lets the request through when checkPermissionForUser resolves to true', async () => {
    mockedCheckPermissionForUser.mockResolvedValue(true);
    const { req, res, next, status } = buildContext({ role: 'SUPER_ADMIN' });

    await authorize('rbac.manage')(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it('does NOT leak the requested permission key in the 403 response body', async () => {
    // Same enumeration defense as authenticate: 403 must be generic.
    // An attacker who can probe routes shouldn't get back "you needed
    // task.delete" — that gives away the permission catalog shape.
    mockedCheckPermissionForUser.mockResolvedValue(false);
    const { req, res, next, json } = buildContext({ role: 'ENGINEER' });

    await authorize('rbac.manage')(req, res, next);

    const body = json.mock.calls[0]?.[0] as any;
    expect(JSON.stringify(body)).not.toContain('rbac.manage');
  });

});
