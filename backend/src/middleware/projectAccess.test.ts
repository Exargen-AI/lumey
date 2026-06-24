/**
 * 2026-05-23 catastrophic-tier coverage for `projectAccess` middleware.
 *
 * This is the gate guarding every per-project endpoint:
 *   /projects/:id/tasks         (kanban)
 *   /projects/:id/sprints       (sprint list, start, complete)
 *   /projects/:id/time-report   (analytics)
 *   /projects/:id/compliance    (client-facing compliance summary)
 *   /projects/:id/forecast      (projectForecast)
 *   /projects/:id/decisions, /epics, /milestones, /comments, /documents
 *   …and more (~30 endpoints share this gate)
 *
 * If projectAccess regresses, the worst case is **cross-tenant data
 * leak**: Client A on Project P1 hits /projects/P2/tasks and sees
 * Client B's tasks. Zero tests existed before this PR.
 *
 * Invariants pinned:
 *   - 401 when req.user is missing (auth gate)
 *   - 403 when caller is NOT a member AND lacks project.view_all
 *   - PASSES when caller has project.view_all (admin bypass)
 *   - PASSES when caller is in projectMember table for this projectId
 *   - 500 (CONFIG_ERROR) when the route forgot to mount with :id/:projectId
 *     (the QA #7 fix — must fail loudly, NOT silently allow access)
 *   - Reads :id first, then :projectId (precedence)
 *   - Composite-key shape on the membership query is correct
 *   - Active-status / project-exists are NOT this middleware's job (the
 *     authenticate middleware handles inactive users via tokenVersion;
 *     project existence isn't checked because admins with view_all need
 *     to read any id without a pre-flight 404)
 */

import './../test/prismaMock';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../test/prismaMock';

const { checkPermissionSpy } = vi.hoisted(() => ({
  checkPermissionSpy: vi.fn(),
}));
vi.mock('../services/rbac.service', () => ({
  __esModule: true,
  checkPermission: checkPermissionSpy,
}));

// 2026-06-01 — projectAccess logs the misconfig via the structured
// logger now, not console.error. Mock it to assert on.
const { paLoggerMock } = vi.hoisted(() => ({
  paLoggerMock: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));
vi.mock('../lib/logger', () => ({ __esModule: true, logger: paLoggerMock, securityLogger: paLoggerMock }));

import { projectAccess } from './projectAccess';

function makeReq(opts: {
  userId?: string;
  role?: string;
  params?: Record<string, string>;
  method?: string;
  originalUrl?: string;
}) {
  return {
    user: opts.userId ? { id: opts.userId, role: opts.role ?? 'ENGINEER' } : undefined,
    params: opts.params ?? {},
    method: opts.method ?? 'GET',
    originalUrl: opts.originalUrl ?? '/api/v1/projects/p1/tasks',
  } as any;
}

function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as any;
}

beforeEach(() => {
  checkPermissionSpy.mockReset();
  // Silence the [projectAccess] console.error for the misconfig test.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('projectAccess — authentication gate', () => {
  it('returns 401 + canonical error shape when req.user is missing', async () => {
    const next = vi.fn();
    const res = makeRes();
    await projectAccess({ params: { id: 'p1' } } as any, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
    });
  });

  it('does NOT query membership when caller is unauthenticated (no leak via timing or db load)', async () => {
    await projectAccess({ params: { id: 'p1' } } as any, makeRes(), vi.fn());
    expect(prismaMock.projectMember.findUnique).not.toHaveBeenCalled();
    expect(checkPermissionSpy).not.toHaveBeenCalled();
  });
});

describe('projectAccess — admin bypass (project.view_all)', () => {
  it('passes through WITHOUT checking membership when caller has project.view_all', async () => {
    checkPermissionSpy.mockResolvedValueOnce(true);
    const next = vi.fn();
    const res = makeRes();
    await projectAccess(makeReq({ userId: 'admin-1', role: 'SUPER_ADMIN', params: { id: 'p1' } }), res, next);
    expect(next).toHaveBeenCalledOnce();
    // CRITICAL: membership lookup is skipped so an admin can act on a
    // project they're not formally on. If this regresses, admins are
    // locked out of every project they didn't manually add themselves to.
    expect(prismaMock.projectMember.findUnique).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('asks RBAC for project.view_all specifically (not a different permission key)', async () => {
    checkPermissionSpy.mockResolvedValueOnce(true);
    await projectAccess(makeReq({ userId: 'u1', params: { id: 'p1' } }), makeRes(), vi.fn());
    expect(checkPermissionSpy).toHaveBeenCalledWith('ENGINEER', 'project.view_all');
  });
});

describe('projectAccess — membership gate', () => {
  beforeEach(() => {
    // Default: no admin bypass.
    checkPermissionSpy.mockResolvedValue(false);
  });

  it('passes when caller has a projectMember row for this projectId', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue({ id: 'pm-1' } as any);
    const next = vi.fn();
    const res = makeRes();
    await projectAccess(makeReq({ userId: 'u-1', params: { id: 'p1' } }), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('queries with composite key (userId, projectId) — not by either field alone', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue({ id: 'pm-1' } as any);
    await projectAccess(makeReq({ userId: 'u-1', params: { id: 'p1' } }), makeRes(), vi.fn());
    expect(prismaMock.projectMember.findUnique).toHaveBeenCalledWith({
      where: { userId_projectId: { userId: 'u-1', projectId: 'p1' } },
    });
  });

  it('returns 403 + canonical error when caller is NOT a member', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue(null);
    const next = vi.fn();
    const res = makeRes();
    await projectAccess(makeReq({ userId: 'stranger', params: { id: 'p1' } }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Not a member of this project' },
    });
  });

  it('the catastrophic case: a CLIENT cannot hit projects they are not a member of', async () => {
    // Even though CLIENT_A and CLIENT_B might both authenticate and even
    // legitimately use the system, A asking for B's project must 403.
    prismaMock.projectMember.findUnique.mockResolvedValue(null);
    const next = vi.fn();
    const res = makeRes();
    await projectAccess(
      makeReq({ userId: 'client-a', role: 'CLIENT', params: { id: 'project-of-client-b' } }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('projectAccess — param resolution (:id vs :projectId)', () => {
  beforeEach(() => {
    checkPermissionSpy.mockResolvedValue(false);
    prismaMock.projectMember.findUnique.mockResolvedValue({ id: 'pm' } as any);
  });

  it('reads :id when present', async () => {
    await projectAccess(makeReq({ userId: 'u', params: { id: 'from-id' } }), makeRes(), vi.fn());
    expect(prismaMock.projectMember.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId_projectId: { userId: 'u', projectId: 'from-id' } } }),
    );
  });

  it('falls back to :projectId when :id is absent', async () => {
    await projectAccess(
      makeReq({ userId: 'u', params: { projectId: 'from-projectId' } }),
      makeRes(),
      vi.fn(),
    );
    expect(prismaMock.projectMember.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_projectId: { userId: 'u', projectId: 'from-projectId' } },
      }),
    );
  });

  it(':id takes precedence over :projectId when both are present', async () => {
    await projectAccess(
      makeReq({ userId: 'u', params: { id: 'from-id', projectId: 'from-projectId' } }),
      makeRes(),
      vi.fn(),
    );
    expect(prismaMock.projectMember.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_projectId: { userId: 'u', projectId: 'from-id' } },
      }),
    );
  });
});

describe('projectAccess — misconfiguration (QA #7 fix: must fail loudly, not silently allow)', () => {
  it('returns 500 CONFIG_ERROR when NEITHER :id NOR :projectId is present', async () => {
    checkPermissionSpy.mockResolvedValueOnce(false); // not admin
    const next = vi.fn();
    const res = makeRes();
    await projectAccess(makeReq({ userId: 'u', params: {} }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: { code: 'CONFIG_ERROR', message: 'Project access misconfigured' },
    });
  });

  it('does NOT query membership when the route is misconfigured (defensive — avoids a (userId, undefined) lookup)', async () => {
    checkPermissionSpy.mockResolvedValueOnce(false);
    await projectAccess(makeReq({ userId: 'u', params: {} }), makeRes(), vi.fn());
    expect(prismaMock.projectMember.findUnique).not.toHaveBeenCalled();
  });

  it('logs the misconfiguration via the structured logger so it shows up in monitoring', async () => {
    paLoggerMock.error.mockClear();
    checkPermissionSpy.mockResolvedValueOnce(false);
    await projectAccess(
      makeReq({
        userId: 'u',
        params: {},
        method: 'POST',
        originalUrl: '/api/v1/foo/bar',
      }),
      makeRes(),
      vi.fn(),
    );
    expect(paLoggerMock.error).toHaveBeenCalled();
    const [ctx, msg] = paLoggerMock.error.mock.calls.at(-1) as [any, string];
    expect(msg).toContain('projectAccess');
    expect(ctx.method).toBe('POST');
    expect(ctx.path).toBe('/api/v1/foo/bar');
  });

  it('but admin bypass still works even on a misconfigured route (graceful degradation)', async () => {
    checkPermissionSpy.mockResolvedValueOnce(true); // project.view_all
    const next = vi.fn();
    const res = makeRes();
    await projectAccess(makeReq({ userId: 'admin', role: 'SUPER_ADMIN', params: {} }), res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('projectAccess — defensive single-call invariant', () => {
  it('on the misconfig path: next() is NOT called AND response IS sent (no double-handling)', async () => {
    checkPermissionSpy.mockResolvedValueOnce(false);
    const next = vi.fn();
    const res = makeRes();
    await projectAccess(makeReq({ userId: 'u', params: {} }), res, next);
    expect(next).toHaveBeenCalledTimes(0);
    expect(res.status).toHaveBeenCalledTimes(1);
  });

  it('on the 403 path: next() is NOT called AND response IS sent', async () => {
    checkPermissionSpy.mockResolvedValueOnce(false);
    prismaMock.projectMember.findUnique.mockResolvedValue(null);
    const next = vi.fn();
    const res = makeRes();
    await projectAccess(makeReq({ userId: 'u', params: { id: 'p1' } }), res, next);
    expect(next).toHaveBeenCalledTimes(0);
    expect(res.status).toHaveBeenCalledTimes(1);
  });

  it('on the happy path: next() is called EXACTLY once AND response is NOT sent', async () => {
    checkPermissionSpy.mockResolvedValueOnce(false);
    prismaMock.projectMember.findUnique.mockResolvedValue({} as any);
    const next = vi.fn();
    const res = makeRes();
    await projectAccess(makeReq({ userId: 'u', params: { id: 'p1' } }), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
