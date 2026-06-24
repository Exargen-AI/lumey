/**
 * 2026-05-23 — S-tier coverage for the task-access middleware.
 *
 * Sits in front of every per-task endpoint (`/tasks/:id/*`) and enforces:
 *   1. User is authenticated
 *   2. Task exists
 *   3. User has `task.view_internal` OR task is client-visible
 *   4. User has `project.view_all` OR is a member of the task's project
 *
 * Zero tests existed before this PR. This is the gate that prevents
 * cross-tenant leakage: a client on Project A cannot read tasks on
 * Project B even if they know the task id. If this regressed silently,
 * sensitive data could be exposed.
 *
 * Invariants pinned:
 *   - 401 when req.user is missing
 *   - Passes through when no taskId in params (route-level checks then run)
 *   - 404 when task does not exist
 *   - 403 (Access denied) when task is internal AND user lacks
 *     task.view_internal
 *   - Passes when task is client-visible regardless of permission
 *   - 403 (Not a member) when user lacks project.view_all AND has no
 *     membership row for the task's project
 *   - Passes when user has project.view_all (admin elevation)
 *   - Passes when user has a project membership row
 */

import './../test/prismaMock';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../test/prismaMock';

const { checkPermissionSpy } = vi.hoisted(() => ({
  checkPermissionSpy: vi.fn(),
}));
// 2026-05-30: middleware now calls `checkPermissionForUser` for the
// `task.view_internal` gate (so per-user extended CLIENT grants land)
// while keeping `checkPermission` for `project.view_all`. Route both
// export names to the same spy — the unit tests below sequence
// mockResolvedValueOnce(...) calls assuming a single ordered
// permission stream, and the gate semantics are identical.
vi.mock('../services/rbac.service', () => ({
  __esModule: true,
  checkPermission: checkPermissionSpy,
  checkPermissionForUser: checkPermissionSpy,
  // taskAccess now uses the per-project helper for the internal gate.
  // Route it to the same single ordered spy stream the tests sequence.
  canViewProjectInternal: checkPermissionSpy,
}));

import { taskAccess } from './taskAccess';

const USER_ID = 'user-1';
const TASK_ID = 'task-1';
const PROJECT_ID = 'project-1';

function makeReq(opts: {
  userId?: string;
  role?: string;
  params?: Record<string, string>;
}) {
  return {
    user: opts.userId
      ? { id: opts.userId, role: opts.role ?? 'ENGINEER' }
      : undefined,
    params: opts.params ?? { id: TASK_ID },
  } as any;
}

function makeRes() {
  const res: any = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res;
}

beforeEach(() => {
  checkPermissionSpy.mockReset();
});

describe('taskAccess — authentication gate', () => {
  it('returns 401 when req.user is missing', async () => {
    const next = vi.fn();
    const res = makeRes();
    await taskAccess({ params: {} } as any, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
    });
  });

  it('passes through when no task id in params — the route-level checks then run', async () => {
    const next = vi.fn();
    const res = makeRes();
    await taskAccess(
      makeReq({ userId: USER_ID, params: {} }),
      res,
      next,
    );
    expect(next).toHaveBeenCalledOnce();
    expect(prismaMock.task.findUnique).not.toHaveBeenCalled();
  });
});

describe('taskAccess — task existence + visibility gate', () => {
  it('returns 404 when the task does not exist (prevents enumeration via 403)', async () => {
    prismaMock.task.findUnique.mockResolvedValue(null);
    const next = vi.fn();
    const res = makeRes();
    await taskAccess(makeReq({ userId: USER_ID }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('returns 403 (Access denied) when task is INTERNAL and caller lacks task.view_internal', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: TASK_ID,
      projectId: PROJECT_ID,
      clientVisible: false,
    } as any);
    checkPermissionSpy.mockResolvedValueOnce(false); // task.view_internal: NO

    const next = vi.fn();
    const res = makeRes();
    await taskAccess(makeReq({ userId: USER_ID, role: 'CLIENT' }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Access denied' },
    });
  });

  it('lets a CLIENT through when task is CLIENT-VISIBLE (cross-tenant safety: only their lane)', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: TASK_ID,
      projectId: PROJECT_ID,
      clientVisible: true,
    } as any);
    // task.view_internal: NO. project.view_all: NO. Has membership: YES.
    checkPermissionSpy
      .mockResolvedValueOnce(false) // task.view_internal
      .mockResolvedValueOnce(false); // project.view_all
    prismaMock.projectMember.findUnique.mockResolvedValue({
      userId: USER_ID,
      projectId: PROJECT_ID,
    } as any);

    const next = vi.fn();
    const res = makeRes();
    await taskAccess(makeReq({ userId: USER_ID, role: 'CLIENT' }), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('taskAccess — project membership gate', () => {
  beforeEach(() => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: TASK_ID,
      projectId: PROJECT_ID,
      clientVisible: false,
    } as any);
  });

  it('short-circuits past membership check when user has project.view_all (admin elevation)', async () => {
    checkPermissionSpy
      .mockResolvedValueOnce(true) // task.view_internal: YES
      .mockResolvedValueOnce(true); // project.view_all: YES

    const next = vi.fn();
    const res = makeRes();
    await taskAccess(makeReq({ userId: USER_ID, role: 'SUPER_ADMIN' }), res, next);
    expect(next).toHaveBeenCalledOnce();
    // CRITICAL: membership lookup is skipped — admin doesn't need to be
    // explicitly on every project to act. If this regressed, every admin
    // mutation would 403 unless they were manually added to projects.
    expect(prismaMock.projectMember.findUnique).not.toHaveBeenCalled();
  });

  it('passes when user is a member of the task\'s project', async () => {
    checkPermissionSpy
      .mockResolvedValueOnce(true) // task.view_internal
      .mockResolvedValueOnce(false); // project.view_all: NO
    prismaMock.projectMember.findUnique.mockResolvedValue({
      userId: USER_ID,
      projectId: PROJECT_ID,
    } as any);

    const next = vi.fn();
    const res = makeRes();
    await taskAccess(makeReq({ userId: USER_ID, role: 'ENGINEER' }), res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 403 (Not a member) when user is NOT on the task\'s project and lacks project.view_all', async () => {
    checkPermissionSpy
      .mockResolvedValueOnce(true) // task.view_internal: YES
      .mockResolvedValueOnce(false); // project.view_all: NO
    prismaMock.projectMember.findUnique.mockResolvedValue(null);

    const next = vi.fn();
    const res = makeRes();
    await taskAccess(makeReq({ userId: USER_ID, role: 'ENGINEER' }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Not a member of this project' },
    });
  });

  it('queries membership using the (userId, projectId) composite key (correct shape)', async () => {
    checkPermissionSpy
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    prismaMock.projectMember.findUnique.mockResolvedValue({} as any);

    await taskAccess(makeReq({ userId: USER_ID }), makeRes(), vi.fn());

    expect(prismaMock.projectMember.findUnique).toHaveBeenCalledWith({
      where: { userId_projectId: { userId: USER_ID, projectId: PROJECT_ID } },
    });
  });
});

describe('taskAccess — defensive double-call prevention', () => {
  it('does not call next() AND respond on the same request (no header-already-sent bugs)', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: TASK_ID,
      projectId: PROJECT_ID,
      clientVisible: false,
    } as any);
    checkPermissionSpy.mockResolvedValueOnce(false);

    const next = vi.fn();
    const res = makeRes();
    await taskAccess(makeReq({ userId: USER_ID, role: 'CLIENT' }), res, next);
    expect(next).toHaveBeenCalledTimes(0);
    expect(res.status).toHaveBeenCalledTimes(1);
  });
});
