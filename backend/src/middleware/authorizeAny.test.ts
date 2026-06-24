/**
 * Phase 2.3 of the baseline hardening plan — critical-tier authz spine.
 *
 * `authorizeAny(...keys)` is the OR-of-N permission gate. The user
 * needs at least ONE of the listed permissions to pass. Used on
 * routes where multiple paths legitimately grant access (e.g.
 * "view task" needs either `task.view_any` OR `task.view_assigned`).
 *
 * The tests here lock in:
 *   - 401 before any permission check when req.user is missing.
 *   - Empty permission list = deny-all (no implicit pass).
 *   - Single match in N → next().
 *   - All N false → 403.
 *   - **Short-circuit / fan-out behavior** isn't required for security,
 *     but we DO assert all N are queried (Promise.all keeps cache warm
 *     for every key in the union).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// 2026-05-30: authorizeAny now calls checkPermissionForUser so the
// per-user extended CLIENT grant flows through. Mock both export
// surfaces so the import shape stays whole.
vi.mock('../services/rbac.service', () => ({
  __esModule: true,
  checkPermission: vi.fn(),
  checkPermissionForUser: vi.fn(),
}));

import { authorizeAny } from './authorizeAny';
import { checkPermission, checkPermissionForUser } from '../services/rbac.service';

const mockedCheckPermission = vi.mocked(checkPermissionForUser);
// Keep the legacy alias name so the existing test bodies don't need
// to be touched. The behaviour we're testing is identical — we're
// just routing the same assertions through the new export.
void checkPermission;

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
});

describe('authorizeAny middleware', () => {
  it('returns 401 when req.user is missing — no permission check fires', async () => {
    const { req, res, next, status, json } = buildContext(null);

    await authorizeAny('task.view_any', 'task.view_assigned')(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
    });
    expect(next).not.toHaveBeenCalled();
    expect(mockedCheckPermission).not.toHaveBeenCalled();
  });

  it('lets the request through when ANY permission resolves to true', async () => {
    // First key denies, second key grants. authorizeAny should pass.
    mockedCheckPermission
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const { req, res, next, status } = buildContext({ role: 'ENGINEER' });

    await authorizeAny('task.view_any', 'task.view_assigned')(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it('returns 403 when ALL permissions resolve to false', async () => {
    mockedCheckPermission.mockResolvedValue(false);
    const { req, res, next, status, json } = buildContext({ role: 'CLIENT' });

    await authorizeAny('task.edit_any', 'task.delete')(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Insufficient permissions' },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('queries every supplied permission key (no early short-circuit)', async () => {
    // The current impl uses Promise.all, which fans out all N checks.
    // That's the cache-warming behavior we want — every cell of the
    // (role, key) cache gets touched on this code path.
    mockedCheckPermission.mockResolvedValue(true);
    const { req, res, next } = buildContext({ role: 'ADMIN' });

    await authorizeAny('a.view', 'b.view', 'c.view')(req, res, next);

    expect(mockedCheckPermission).toHaveBeenCalledTimes(3);
    expect(mockedCheckPermission).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ role: 'ADMIN' }),
      'a.view',
    );
    expect(mockedCheckPermission).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ role: 'ADMIN' }),
      'b.view',
    );
    expect(mockedCheckPermission).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ role: 'ADMIN' }),
      'c.view',
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('treats an empty permission list as deny-all (no implicit pass)', async () => {
    // Defensive sanity. authorizeAny() with no args means "the route
    // declared no acceptable permissions" — almost certainly a bug,
    // and we'd rather 403 than silently grant access.
    const { req, res, next, status } = buildContext({ role: 'SUPER_ADMIN' });

    await authorizeAny()(req, res, next);

    expect(status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
    // No keys, no checks.
    expect(mockedCheckPermission).not.toHaveBeenCalled();
  });

  it('does NOT leak the requested permission keys in the 403 response body', async () => {
    mockedCheckPermission.mockResolvedValue(false);
    const { req, res, next, json } = buildContext({ role: 'ENGINEER' });

    await authorizeAny('rbac.manage', 'task.delete')(req, res, next);

    const body = json.mock.calls[0]?.[0] as any;
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('rbac.manage');
    expect(serialized).not.toContain('task.delete');
  });
});
