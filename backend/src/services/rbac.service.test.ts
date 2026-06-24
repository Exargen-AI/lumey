/**
 * Phase 2 of the baseline hardening plan — first service test, critical
 * tier (security primitive). Target coverage: ≥ 95%.
 *
 * What `rbac.service` does and what we're proving:
 *
 *   1. `checkPermission` — read-side gate used by every authorize() call.
 *      Hot path; cached for 5 minutes per (role, permissionKey). False is
 *      the default for missing rows (deny-by-default). Cache invalidates
 *      on every write.
 *
 *   2. `getAllPermissions` / `getRolesWithPermissions` — admin-RBAC UI
 *      feeders. Need stable ordering (category → key).
 *
 *   3. `updateRolePermissions` — admin-only RBAC mutation. Must:
 *        • Refuse to revoke `rbac.manage` from SUPER_ADMIN (system lockout
 *          guard).
 *        • Upsert each row idempotently.
 *        • Invalidate the cache (so the next checkPermission re-reads).
 *        • Log the diff to activity ONLY when something actually changed.
 *        • Tolerate audit-log failures without rolling back the change.
 */

// Wire up the shared Prisma mock BEFORE importing the service under test —
// vi.mock() is hoisted but the import order still matters for the prisma
// mock identity to flow into the service module.
import './../test/prismaMock';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserRole } from '@prisma/client';
import { prismaMock } from '../test/prismaMock';
import { makePermission, makeRolePermission } from '../test/factories';

// activity.service is lazy-imported by rbac.service; mock the dynamic
// import so we can spy on the audit hook without needing a real DB.
const logActivitySpy = vi.fn().mockResolvedValue(undefined);
vi.mock('./activity.service', () => ({
  __esModule: true,
  logActivity: logActivitySpy,
}));

// 2026-06-01 — rbac.service logs the audit-failure warning via the
// structured logger now, not console.warn. Mock it to assert on.
const { rbacLoggerMock } = vi.hoisted(() => ({
  rbacLoggerMock: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));
vi.mock('../lib/logger', () => ({ __esModule: true, logger: rbacLoggerMock, securityLogger: rbacLoggerMock }));

import {
  checkPermission,
  checkPermissionForUser,
  canViewProjectInternal,
  invalidateCache,
  getAllPermissions,
  getRolesWithPermissions,
  updateRolePermissions,
} from './rbac.service';

beforeEach(() => {
  invalidateCache();
  logActivitySpy.mockClear();
});

describe('checkPermission', () => {
  it('returns true when a granted row exists for the (role, key) pair', async () => {
    prismaMock.rolePermission.findFirst.mockResolvedValue(makeRolePermission({ granted: true }));

    await expect(checkPermission(UserRole.ADMIN, 'task.edit_any')).resolves.toBe(true);

    expect(prismaMock.rolePermission.findFirst).toHaveBeenCalledWith({
      where: { role: UserRole.ADMIN, granted: true, permission: { key: 'task.edit_any' } },
    });
  });

  it('returns false (deny by default) when no row exists', async () => {
    prismaMock.rolePermission.findFirst.mockResolvedValue(null);
    await expect(checkPermission(UserRole.CLIENT, 'task.edit_any')).resolves.toBe(false);
  });

  it('caches the result so the second call skips the DB', async () => {
    prismaMock.rolePermission.findFirst.mockResolvedValue(makeRolePermission({ granted: true }));

    await checkPermission(UserRole.ADMIN, 'task.view');
    await checkPermission(UserRole.ADMIN, 'task.view');

    expect(prismaMock.rolePermission.findFirst).toHaveBeenCalledTimes(1);
  });

  it('caches per (role, key) tuple — different keys do not share a slot', async () => {
    prismaMock.rolePermission.findFirst.mockResolvedValue(makeRolePermission({ granted: true }));

    await checkPermission(UserRole.ADMIN, 'task.view');
    await checkPermission(UserRole.ADMIN, 'task.delete');

    expect(prismaMock.rolePermission.findFirst).toHaveBeenCalledTimes(2);
  });

  it('invalidateCache() forces a re-read on the next call', async () => {
    prismaMock.rolePermission.findFirst.mockResolvedValue(makeRolePermission({ granted: true }));

    await checkPermission(UserRole.ADMIN, 'task.view');
    invalidateCache();
    await checkPermission(UserRole.ADMIN, 'task.view');

    expect(prismaMock.rolePermission.findFirst).toHaveBeenCalledTimes(2);
  });
});

// ─── checkPermissionForUser (2026-06-02) ─────────────────────────────
//
// The old global `extendedClientAccess` per-user additive grant was
// retired (full client access is now per-project — see
// `canViewProjectInternal`). `checkPermissionForUser` is now a thin
// pass-through to the role-level matrix, kept as the seam the authorize
// middleware calls. These tests pin that it simply mirrors
// `checkPermission(user.role, key)`.
describe('checkPermissionForUser — role-level pass-through', () => {
  it('returns true when the role grants the permission', async () => {
    prismaMock.rolePermission.findFirst.mockResolvedValue(makeRolePermission({ granted: true }));
    await expect(
      checkPermissionForUser({ role: UserRole.ADMIN }, 'decision.view'),
    ).resolves.toBe(true);
  });

  it('returns false when the role lacks the permission (no per-user widening)', async () => {
    prismaMock.rolePermission.findFirst.mockResolvedValue(null);
    await expect(
      checkPermissionForUser({ role: UserRole.CLIENT }, 'task.view_internal'),
    ).resolves.toBe(false);
    await expect(
      checkPermissionForUser({ role: UserRole.CLIENT }, 'decision.view'),
    ).resolves.toBe(false);
  });
});

describe('canViewProjectInternal — per-project full access', () => {
  const PROJECT_ID = 'proj-1';

  it('grants staff via the role-level task.view_internal (no membership lookup)', async () => {
    prismaMock.rolePermission.findFirst.mockResolvedValue(makeRolePermission({ granted: true }));

    await expect(
      canViewProjectInternal({ id: 'admin-1', role: UserRole.ADMIN }, PROJECT_ID),
    ).resolves.toBe(true);
    // Short-circuits before the membership query.
    expect(prismaMock.projectMember.findUnique).not.toHaveBeenCalled();
  });

  it('grants a CLIENT with a per-project membership.fullAccess=true', async () => {
    prismaMock.rolePermission.findFirst.mockResolvedValue(null);
    prismaMock.projectMember.findUnique.mockResolvedValue({ fullAccess: true } as any);

    await expect(
      canViewProjectInternal({ id: 'client-1', role: UserRole.CLIENT }, PROJECT_ID),
    ).resolves.toBe(true);
    expect(prismaMock.projectMember.findUnique).toHaveBeenCalledWith({
      where: { userId_projectId: { userId: 'client-1', projectId: PROJECT_ID } },
      select: { fullAccess: true },
    });
  });

  it('denies a CLIENT whose membership has fullAccess=false', async () => {
    prismaMock.rolePermission.findFirst.mockResolvedValue(null);
    prismaMock.projectMember.findUnique.mockResolvedValue({ fullAccess: false } as any);

    await expect(
      canViewProjectInternal({ id: 'client-1', role: UserRole.CLIENT }, PROJECT_ID),
    ).resolves.toBe(false);
  });

  it('denies a CLIENT who is not a member of the project (no membership row)', async () => {
    prismaMock.rolePermission.findFirst.mockResolvedValue(null);
    prismaMock.projectMember.findUnique.mockResolvedValue(null);

    await expect(
      canViewProjectInternal({ id: 'client-1', role: UserRole.CLIENT }, PROJECT_ID),
    ).resolves.toBe(false);
  });

  it('denies (without a membership lookup) when the user has no id', async () => {
    prismaMock.rolePermission.findFirst.mockResolvedValue(null);

    await expect(
      canViewProjectInternal({ role: UserRole.CLIENT }, PROJECT_ID),
    ).resolves.toBe(false);
    expect(prismaMock.projectMember.findUnique).not.toHaveBeenCalled();
  });
});

describe('getAllPermissions', () => {
  it('returns the full permission catalog sorted by (category, key)', async () => {
    const perms = [
      makePermission({ id: 'p1', key: 'task.view', category: 'task' }),
      makePermission({ id: 'p2', key: 'project.view', category: 'project' }),
    ];
    prismaMock.permission.findMany.mockResolvedValue(perms);

    const result = await getAllPermissions();

    expect(result).toEqual(perms);
    expect(prismaMock.permission.findMany).toHaveBeenCalledWith({
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    });
  });
});

describe('getRolesWithPermissions', () => {
  it('pivots all permissions across every UserRole, marking which are granted', async () => {
    const perm1 = makePermission({ id: 'p1', key: 'task.view' });
    const perm2 = makePermission({ id: 'p2', key: 'task.delete' });
    prismaMock.permission.findMany.mockResolvedValue([perm1, perm2]);
    prismaMock.rolePermission.findMany.mockResolvedValue([
      makeRolePermission({ role: UserRole.ADMIN, permissionId: 'p1', granted: true }),
      makeRolePermission({ role: UserRole.CLIENT, permissionId: 'p1', granted: false }),
    ]);

    const result = await getRolesWithPermissions();

    // One row per UserRole value, regardless of how many RolePermission rows exist.
    expect(result).toHaveLength(Object.values(UserRole).length);

    const admin = result.find((r) => r.role === UserRole.ADMIN);
    expect(admin?.permissions).toEqual([
      expect.objectContaining({ id: 'p1', granted: true }),
      expect.objectContaining({ id: 'p2', granted: false }),
    ]);

    const client = result.find((r) => r.role === UserRole.CLIENT);
    expect(client?.permissions).toEqual([
      expect.objectContaining({ id: 'p1', granted: false }),
      expect.objectContaining({ id: 'p2', granted: false }),
    ]);
  });
});

describe('updateRolePermissions', () => {
  it('refuses to revoke `rbac.manage` from SUPER_ADMIN', async () => {
    const rbacManage = makePermission({ id: 'rbac-manage-id', key: 'rbac.manage' });
    prismaMock.permission.findUnique.mockResolvedValue(rbacManage);

    await expect(
      updateRolePermissions(UserRole.SUPER_ADMIN, [
        { permissionId: rbacManage.id, granted: false },
      ]),
    ).rejects.toThrow(/cannot revoke rbac.manage/i);

    // No mutation should have run.
    expect(prismaMock.rolePermission.upsert).not.toHaveBeenCalled();
  });

  it('allows non-revoke updates on SUPER_ADMIN (granting another permission)', async () => {
    prismaMock.permission.findUnique.mockResolvedValue(
      makePermission({ id: 'rbac-manage-id', key: 'rbac.manage' }),
    );
    prismaMock.rolePermission.findMany.mockResolvedValue([]);

    await expect(
      updateRolePermissions(UserRole.SUPER_ADMIN, [{ permissionId: 'other-perm', granted: true }]),
    ).resolves.not.toThrow();

    expect(prismaMock.rolePermission.upsert).toHaveBeenCalledTimes(1);
  });

  it('upserts every supplied permission row exactly once', async () => {
    prismaMock.permission.findUnique.mockResolvedValue(null);
    prismaMock.rolePermission.findMany.mockResolvedValue([]);

    await updateRolePermissions(UserRole.PRODUCT_MANAGER, [
      { permissionId: 'p1', granted: true },
      { permissionId: 'p2', granted: false },
      { permissionId: 'p3', granted: true },
    ]);

    expect(prismaMock.rolePermission.upsert).toHaveBeenCalledTimes(3);
  });

  it('invalidates the cache so subsequent checks re-read', async () => {
    // Prime the cache.
    prismaMock.rolePermission.findFirst.mockResolvedValue(makeRolePermission({ granted: true }));
    await checkPermission(UserRole.ADMIN, 'task.view');

    // Trigger an update.
    prismaMock.permission.findUnique.mockResolvedValue(null);
    prismaMock.rolePermission.findMany.mockResolvedValue([]);
    await updateRolePermissions(UserRole.ADMIN, [{ permissionId: 'p1', granted: true }]);

    // Cache should be empty — the next check re-reads.
    prismaMock.rolePermission.findFirst.mockClear();
    await checkPermission(UserRole.ADMIN, 'task.view');
    expect(prismaMock.rolePermission.findFirst).toHaveBeenCalledTimes(1);
  });

  it('logs an audit entry when grants actually changed', async () => {
    prismaMock.permission.findUnique.mockResolvedValue(null);
    // Before state: p1 was previously granted=false.
    prismaMock.rolePermission.findMany.mockResolvedValue([
      makeRolePermission({ permissionId: 'p1', granted: false }),
    ]);

    await updateRolePermissions(
      UserRole.ADMIN,
      [{ permissionId: 'p1', granted: true }],
      'user-actor',
    );

    expect(logActivitySpy).toHaveBeenCalledTimes(1);
    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-actor',
        action: 'updated_rbac',
        targetType: 'role',
        targetId: UserRole.ADMIN,
        details: expect.objectContaining({
          role: UserRole.ADMIN,
          changes: [{ permissionId: 'p1', from: false, to: true }],
        }),
      }),
    );
  });

  it('records the `from` value as false when no prior row existed (new grant)', async () => {
    prismaMock.permission.findUnique.mockResolvedValue(null);
    // No prior row for 'p-new' — beforeMap.get() returns undefined → defaults to false.
    prismaMock.rolePermission.findMany.mockResolvedValue([]);

    await updateRolePermissions(
      UserRole.ADMIN,
      [{ permissionId: 'p-new', granted: true }],
      'user-actor',
    );

    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          changes: [{ permissionId: 'p-new', from: false, to: true }],
        }),
      }),
    );
  });

  it('skips the audit log when no grant actually changed (idempotent re-apply)', async () => {
    prismaMock.permission.findUnique.mockResolvedValue(null);
    prismaMock.rolePermission.findMany.mockResolvedValue([
      makeRolePermission({ permissionId: 'p1', granted: true }),
    ]);

    await updateRolePermissions(
      UserRole.ADMIN,
      [{ permissionId: 'p1', granted: true }],
      'user-actor',
    );

    expect(logActivitySpy).not.toHaveBeenCalled();
  });

  it('skips the audit log entirely when no actingUserId is supplied', async () => {
    prismaMock.permission.findUnique.mockResolvedValue(null);
    prismaMock.rolePermission.findMany.mockResolvedValue([
      makeRolePermission({ permissionId: 'p1', granted: false }),
    ]);

    await updateRolePermissions(UserRole.ADMIN, [{ permissionId: 'p1', granted: true }]);

    expect(logActivitySpy).not.toHaveBeenCalled();
  });

  it('does NOT roll back the RBAC change when the audit log fails', async () => {
    prismaMock.permission.findUnique.mockResolvedValue(null);
    prismaMock.rolePermission.findMany.mockResolvedValue([
      makeRolePermission({ permissionId: 'p1', granted: false }),
    ]);
    logActivitySpy.mockRejectedValueOnce(new Error('audit DB down'));
    rbacLoggerMock.warn.mockClear();

    await expect(
      updateRolePermissions(
        UserRole.ADMIN,
        [{ permissionId: 'p1', granted: true }],
        'user-actor',
      ),
    ).resolves.not.toThrow();

    expect(prismaMock.rolePermission.upsert).toHaveBeenCalledTimes(1);
    // Failure is logged on the structured logger (was console.warn).
    expect(rbacLoggerMock.warn).toHaveBeenCalledWith(
      { err: 'audit DB down' },
      expect.stringContaining('[rbac] audit log failed'),
    );
  });
});
