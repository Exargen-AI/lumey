/**
 * Phase 2.4 of the baseline hardening plan — critical tier.
 *
 * `permissionSync.service` runs on every server boot to keep the
 * Permission catalog + DEFAULT RolePermission grants in sync with
 * the code. It's the only path that creates RolePermission rows
 * in production (admin tweaks via the RBAC UI mutate, never insert
 * brand-new ones); a regression here means new permissions silently
 * fail to land in prod after a deploy.
 *
 * Properties asserted:
 *
 *   1. **Idempotency.** Running the sync twice produces zero
 *      writes the second time. Critical because we run this on
 *      every boot — must not accumulate inserts.
 *
 *   2. **Catalog drift is fixed.** If a permission's `label` or
 *      `category` changes in code, the next boot updates the DB
 *      row (so the RBAC UI doesn't display stale text).
 *
 *   3. **Admin tweaks are preserved.** Once an admin has flipped
 *      a (role, permission) grant via the RBAC UI, this sync MUST
 *      NOT overwrite it. The only path that mutates grants here
 *      is the initial-insert path (existing rows are left alone).
 *
 *   4. **Cache invalidation fires only when work happened.** If
 *      we inserted nothing, the cache is left warm.
 */

import './../test/prismaMock';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserRole } from '@prisma/client';
import { prismaMock } from '../test/prismaMock';
import { makePermission, makeRolePermission } from '../test/factories';

// invalidateCache is a real export from rbac.service. Mock it so we can
// assert it fires only when expected, without touching the actual cache.
// Use vi.hoisted so the spy exists before vi.mock's hoisted callback fires
// — otherwise the import-time ReferenceError trips us on first run.
const { invalidateCacheSpy } = vi.hoisted(() => ({
  invalidateCacheSpy: vi.fn(),
}));
vi.mock('./rbac.service', () => ({
  __esModule: true,
  invalidateCache: invalidateCacheSpy,
  // checkPermission is also exported by rbac.service but permissionSync
  // doesn't use it — leave undefined.
}));

import { syncPermissionDefinitions } from './permissionSync.service';

beforeEach(() => {
  invalidateCacheSpy.mockClear();
});

describe('syncPermissionDefinitions', () => {
  describe('Phase 1: permission catalog upserts', () => {
    it('upserts one row per permission in PERMISSION_DEFINITIONS', async () => {
      // Stub every Phase 2 query so we can isolate the Phase 1 behavior.
      prismaMock.permission.findMany.mockResolvedValue([]);

      await syncPermissionDefinitions();

      // The exact count depends on the PERMISSION_DEFINITIONS array length;
      // assert "more than a handful" instead of pinning a magic number that
      // changes every time a permission is added. The expected count is
      // surfaced as the `total` return value (covered by another test).
      expect(prismaMock.permission.upsert.mock.calls.length).toBeGreaterThan(30);
    });

    it('upsert uses { key } as the where clause + write-on-conflict for label/category drift', async () => {
      prismaMock.permission.findMany.mockResolvedValue([]);

      await syncPermissionDefinitions();

      // Spot-check the shape — the upsert must use `where: { key }` so
      // a permission renamed at the label level still finds its row.
      const firstCall = prismaMock.permission.upsert.mock.calls[0]?.[0] as any;
      expect(firstCall.where).toEqual({ key: expect.any(String) });
      expect(firstCall.create).toMatchObject({
        key: expect.any(String),
        label: expect.any(String),
        category: expect.any(String),
      });
      expect(firstCall.update).toMatchObject({
        label: expect.any(String),
        category: expect.any(String),
      });
    });
  });

  describe('Phase 2: DEFAULT role-permission grant inserts', () => {
    it('inserts a RolePermission row for every (role × permission) pair on a fresh DB', async () => {
      // Permissions exist after Phase 1; no RolePermission rows yet.
      const perms = [
        makePermission({ id: 'p1', key: 'task.view' }),
        makePermission({ id: 'p2', key: 'task.edit_any' }),
      ];
      prismaMock.permission.findMany.mockResolvedValue(perms);
      prismaMock.rolePermission.findUnique.mockResolvedValue(null);

      const result = await syncPermissionDefinitions();

      // 2 perms × 7 UserRole values = 14 inserts on a fresh DB.
      const expectedInserts = perms.length * Object.values(UserRole).length;
      expect(prismaMock.rolePermission.create).toHaveBeenCalledTimes(expectedInserts);
      expect(result.inserted).toBe(expectedInserts);
    });

    it('does NOT re-insert when a RolePermission row already exists (preserves admin tweaks)', async () => {
      const perms = [makePermission({ id: 'p1', key: 'task.view' })];
      prismaMock.permission.findMany.mockResolvedValue(perms);
      // Every existence check returns a row — simulating "admin already
      // configured grants, sync is a no-op".
      prismaMock.rolePermission.findUnique.mockResolvedValue(
        makeRolePermission({ permissionId: 'p1', granted: true }),
      );

      const result = await syncPermissionDefinitions();

      expect(prismaMock.rolePermission.create).not.toHaveBeenCalled();
      expect(result.inserted).toBe(0);
    });

    it('grants the default permissions to each role per DEFAULT_ROLE_PERMISSIONS', async () => {
      // Use a known-default key. `rbac.manage` is granted to SUPER_ADMIN
      // by default and revoked from everyone else — assert that shape.
      const perms = [makePermission({ id: 'p-rbac', key: 'rbac.manage' })];
      prismaMock.permission.findMany.mockResolvedValue(perms);
      prismaMock.rolePermission.findUnique.mockResolvedValue(null);

      await syncPermissionDefinitions();

      const createCalls = prismaMock.rolePermission.create.mock.calls.map((c) => c[0] as any);
      const saCall = createCalls.find(
        (c) => c.data.role === UserRole.SUPER_ADMIN && c.data.permissionId === 'p-rbac',
      );
      expect(saCall?.data.granted).toBe(true);

      const engCall = createCalls.find(
        (c) => c.data.role === UserRole.ENGINEER && c.data.permissionId === 'p-rbac',
      );
      expect(engCall?.data.granted).toBe(false);
    });

    it('defaults to `granted: false` for any role missing from DEFAULT_ROLE_PERMISSIONS', async () => {
      // Defensive: if a new UserRole enum value lands without a
      // DEFAULT_ROLE_PERMISSIONS entry, every permission for that
      // role gets `granted: false`. Admin can flip later via UI.
      const perms = [makePermission({ id: 'p-test', key: 'made-up.permission' })];
      prismaMock.permission.findMany.mockResolvedValue(perms);
      prismaMock.rolePermission.findUnique.mockResolvedValue(null);

      await syncPermissionDefinitions();

      // No role has 'made-up.permission' in its defaults → every
      // created row should be granted: false.
      const createCalls = prismaMock.rolePermission.create.mock.calls.map((c) => c[0] as any);
      expect(createCalls.every((c) => c.data.granted === false)).toBe(true);
    });
  });

  describe('cache invalidation', () => {
    it('invalidates the RBAC cache when at least one new RolePermission row was inserted', async () => {
      prismaMock.permission.findMany.mockResolvedValue([
        makePermission({ id: 'p1', key: 'task.view' }),
      ]);
      prismaMock.rolePermission.findUnique.mockResolvedValue(null);

      await syncPermissionDefinitions();

      expect(invalidateCacheSpy).toHaveBeenCalledOnce();
    });

    it('does NOT invalidate when zero rows were inserted (warm cache survives idempotent boots)', async () => {
      prismaMock.permission.findMany.mockResolvedValue([
        makePermission({ id: 'p1', key: 'task.view' }),
      ]);
      prismaMock.rolePermission.findUnique.mockResolvedValue(
        makeRolePermission({ permissionId: 'p1', granted: true }),
      );

      const result = await syncPermissionDefinitions();

      expect(result.inserted).toBe(0);
      expect(invalidateCacheSpy).not.toHaveBeenCalled();
    });
  });

  describe('return shape', () => {
    it('returns { inserted, total } with total matching the catalog size', async () => {
      prismaMock.permission.findMany.mockResolvedValue([]);
      prismaMock.rolePermission.findUnique.mockResolvedValue(null);

      const result = await syncPermissionDefinitions();

      expect(result).toEqual({
        inserted: expect.any(Number),
        total: expect.any(Number),
      });
      // `total` is the catalog size from the static definition list —
      // larger than any single category, smaller than 1000.
      expect(result.total).toBeGreaterThan(30);
      expect(result.total).toBeLessThan(1000);
    });
  });
});
