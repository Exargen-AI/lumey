/**
 * Sweep #1 — task-link surface.
 *
 * Two real bugs surfaced + fixed in this PR; tests below pin the fix.
 *
 * ## Bug A — `deleteTaskLink` cross-project IDOR (HIGH)
 *
 *   Before: `DELETE /links/:linkId` only role-checked `task.edit_any`
 *   OR `task.edit_own`. The route can't apply `taskAccess` middleware
 *   because the URL key is a linkId, not a taskId — so there was NO
 *   membership check at either the route or the service layer. An
 *   ENGINEER (who has `task.edit_own` for tasks they're assigned) in
 *   Project A could DELETE any taskLink in Project B by knowing the
 *   linkId. UUIDs aren't guessable, but they leak via screenshots,
 *   audit logs, shared URLs.
 *
 *   After: `deleteTaskLink` accepts `userRole`, mirrors the
 *   `taskAccess` middleware shape — `project.view_all` bypasses;
 *   otherwise verifies the caller is a member of the source task's
 *   project. `createTaskLink` already enforces same-project for
 *   from/to, so the source-side check is sufficient.
 *
 * ## Bug B — `searchTasksForLinking` CLIENT enumeration (MEDIUM)
 *
 *   Before: the link-search autocomplete (`GET /projects/:id/task-link-
 *   search?q=...&exclude=...`) was gated only by `projectAccess`. CLIENT
 *   users are project members for projects they're invited to — they
 *   could hit this endpoint even though they can't CREATE links
 *   (link-creation requires `task.edit_any` / `task.edit_own`, which
 *   CLIENT lacks). The service returned task titles without filtering
 *   by `clientVisible`, so CLIENT could enumerate internal task titles
 *   via the autocomplete on a project they're in.
 *
 *   After: `searchTasksForLinking` accepts `userRole` and applies
 *   `clientVisible: true` for callers lacking `task.view_internal`.
 *   Same-shape fix as the milestone/decision activity-feed leaks in
 *   PR #117/#118.
 */

import './../test/prismaMock';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserRole, TaskLinkType } from '@prisma/client';
import { prismaMock } from '../test/prismaMock';

const { checkPermissionSpy } = vi.hoisted(() => ({
  checkPermissionSpy: vi.fn(),
}));

vi.mock('./rbac.service', () => ({
  __esModule: true,
  checkPermission: checkPermissionSpy,
}));

// Activity log is fire-and-forget for these tests — don't need to
// assert on its contents, just don't let it throw.
vi.mock('./activity.service', () => ({
  __esModule: true,
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

import { deleteTaskLink, searchTasksForLinking } from './taskLink.service';
import { ForbiddenError, NotFoundError } from '../utils/errors';

beforeEach(() => {
  checkPermissionSpy.mockReset();
  checkPermissionSpy.mockResolvedValue(false);
  // `prisma.$transaction(fn)` is invoked by deleteTaskLink to wrap the
  // delete + activity log in one transaction. The mock-extended Prisma
  // deep mock doesn't auto-implement $transaction callbacks; provide a
  // pass-through so the callback runs against the prismaMock client.
  (prismaMock.$transaction as any).mockImplementation(async (fn: any) => fn(prismaMock));
});

// ─── Bug A: deleteTaskLink cross-project IDOR ─────────────────────────

describe('deleteTaskLink — membership gate (cross-project IDOR fix)', () => {
  it('THROWS ForbiddenError when caller is NOT a member of the source task\'s project (ENGINEER bypass attempt)', async () => {
    // The pivotal scenario: ENGINEER role has `task.edit_own`, so they
    // pass the route-level `authorizeAny('task.edit_any',
    // 'task.edit_own')` gate. They are NOT a member of proj-2. They
    // discover linkId 'link-xpx' (via a screenshot from a teammate).
    // Before the fix: this call succeeded and the link was deleted.
    // After the fix: ForbiddenError before the delete fires.
    checkPermissionSpy.mockImplementation((_role, key: string) => {
      if (key === 'project.view_all') return Promise.resolve(false);
      return Promise.resolve(false);
    });
    prismaMock.taskLink.findUnique.mockResolvedValue({
      id: 'link-xpx',
      type: TaskLinkType.BLOCKS,
      fromTask: { id: 't-foreign', projectId: 'proj-2', title: 'Internal refactor' },
      toTask: { title: 'Sibling task', taskNumber: 99 },
    } as any);
    // Caller is NOT a member of proj-2.
    prismaMock.projectMember.findUnique.mockResolvedValue(null as any);

    await expect(deleteTaskLink('link-xpx', 'u-eng', UserRole.ENGINEER)).rejects.toBeInstanceOf(ForbiddenError);

    // CRITICAL: the actual delete must not have fired. Verify the
    // taskLink.delete mock was not invoked even though
    // taskLink.findUnique returned the link.
    expect(prismaMock.taskLink.delete).not.toHaveBeenCalled();
  });

  it('PROCEEDS with delete when caller IS a member of the source task\'s project (legitimate use)', async () => {
    checkPermissionSpy.mockImplementation((_role, key: string) => {
      if (key === 'project.view_all') return Promise.resolve(false);
      return Promise.resolve(false);
    });
    prismaMock.taskLink.findUnique.mockResolvedValue({
      id: 'link-1',
      type: TaskLinkType.RELATES_TO,
      fromTask: { id: 't-own', projectId: 'proj-1', title: 'Onboarding flow' },
      toTask: { title: 'Login redirect', taskNumber: 12 },
    } as any);
    prismaMock.projectMember.findUnique.mockResolvedValue({
      userId: 'u-eng',
      projectId: 'proj-1',
    } as any);

    await deleteTaskLink('link-1', 'u-eng', UserRole.ENGINEER);

    expect(prismaMock.taskLink.delete).toHaveBeenCalledWith({ where: { id: 'link-1' } });
  });

  it('SKIPS the membership check for SUPER_ADMIN (project.view_all bypass)', async () => {
    // Super-admins are by-design org-wide in the single-tenant
    // Exargen deployment model — `project.view_all` short-circuits
    // the membership lookup so they don't have to be explicit members
    // of every project to administer it.
    checkPermissionSpy.mockImplementation((_role, key: string) => {
      if (key === 'project.view_all') return Promise.resolve(true);
      return Promise.resolve(false);
    });
    prismaMock.taskLink.findUnique.mockResolvedValue({
      id: 'link-1',
      type: TaskLinkType.BLOCKS,
      fromTask: { id: 't-foreign', projectId: 'proj-99', title: 'Anywhere' },
      toTask: { title: 'Anywhere too', taskNumber: 1 },
    } as any);

    await deleteTaskLink('link-1', 'u-super', UserRole.SUPER_ADMIN);

    // The bypass means we never query projectMember; the delete fires.
    expect(prismaMock.projectMember.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.taskLink.delete).toHaveBeenCalled();
  });

  it('THROWS NotFoundError when the linkId does not exist (avoids leaking existence vs auth)', async () => {
    // Defensive: a 404 vs 403 distinction would let an attacker
    // distinguish "this linkId exists in a project I'm not in" from
    // "no such linkId." We return 404 from the unique lookup BEFORE
    // running the membership check, so the attacker just sees 404 in
    // both cases.
    checkPermissionSpy.mockImplementation(() => Promise.resolve(false));
    prismaMock.taskLink.findUnique.mockResolvedValue(null as any);

    await expect(deleteTaskLink('link-nope', 'u-eng', UserRole.ENGINEER)).rejects.toBeInstanceOf(NotFoundError);
    expect(prismaMock.projectMember.findUnique).not.toHaveBeenCalled();
  });
});

// ─── Bug B: searchTasksForLinking CLIENT enumeration ──────────────────

describe('searchTasksForLinking — clientVisible filter (CLIENT internal-title enumeration fix)', () => {
  it('ADDS clientVisible: true to the where clause for a CLIENT viewer (no task.view_internal)', async () => {
    // Pivotal scenario: CLIENT is a project member. Without the
    // filter, they can autocomplete-search for internal task titles
    // via this endpoint even though they can't actually create links.
    checkPermissionSpy.mockResolvedValue(false); // no view_internal
    prismaMock.task.findMany.mockResolvedValue([] as any);

    await searchTasksForLinking('proj-1', 'refactor', 't-source', UserRole.CLIENT);

    const findManyCall = prismaMock.task.findMany.mock.calls[0]?.[0] as any;
    // The CRITICAL assertion: where.clientVisible === true.
    expect(findManyCall.where.clientVisible).toBe(true);
  });

  it('OMITS the clientVisible filter for an ADMIN viewer (task.view_internal granted)', async () => {
    // ADMIN should be able to find both internal AND client-visible
    // tasks when building links — they're the ones triaging.
    checkPermissionSpy.mockImplementation((_role, key: string) => {
      if (key === 'task.view_internal') return Promise.resolve(true);
      return Promise.resolve(false);
    });
    prismaMock.task.findMany.mockResolvedValue([] as any);

    await searchTasksForLinking('proj-1', 'refactor', 't-source', UserRole.ADMIN);

    const findManyCall = prismaMock.task.findMany.mock.calls[0]?.[0] as any;
    expect(findManyCall.where.clientVisible).toBeUndefined();
  });

  it('still scopes by projectId + excludeId regardless of viewer role', async () => {
    // Invariant: the project-scope + self-exclude must hold for every
    // role. This protects against a future refactor that adds the
    // clientVisible filter but drops the projectId scope.
    checkPermissionSpy.mockResolvedValue(false);
    prismaMock.task.findMany.mockResolvedValue([] as any);

    await searchTasksForLinking('proj-1', 'login', 't-self', UserRole.CLIENT);

    const findManyCall = prismaMock.task.findMany.mock.calls[0]?.[0] as any;
    expect(findManyCall.where.projectId).toBe('proj-1');
    expect(findManyCall.where.id).toEqual({ not: 't-self' });
  });

  it('parses "FUR-12" style queries into a taskNumber OR clause', async () => {
    // Pure-function pinning of the existing taskNumber extraction
    // behavior — we don't want a future refactor that adds the
    // clientVisible filter to accidentally regress the number-search
    // shortcut.
    checkPermissionSpy.mockResolvedValue(false);
    prismaMock.task.findMany.mockResolvedValue([] as any);

    await searchTasksForLinking('proj-1', 'FUR-42', 't-self', UserRole.CLIENT);

    const findManyCall = prismaMock.task.findMany.mock.calls[0]?.[0] as any;
    expect(findManyCall.where.OR).toContainEqual({ taskNumber: 42 });
  });
});
