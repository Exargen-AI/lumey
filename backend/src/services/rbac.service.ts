import { UserRole } from '@prisma/client';
import prisma from '../config/database';
import { logger } from '../lib/logger';

// In-memory permission cache with TTL (5 minutes)
const CACHE_TTL_MS = 5 * 60 * 1000;
const permissionCache = new Map<string, { value: boolean; expiry: number }>();

function cacheKey(role: UserRole, permissionKey: string): string {
  return `${role}:${permissionKey}`;
}

export function invalidateCache() {
  permissionCache.clear();
}

export async function checkPermission(role: UserRole, permissionKey: string): Promise<boolean> {
  const key = cacheKey(role, permissionKey);
  const now = Date.now();

  const cached = permissionCache.get(key);
  if (cached && cached.expiry > now) {
    return cached.value;
  }

  const result = await prisma.rolePermission.findFirst({
    where: {
      role,
      granted: true,
      permission: { key: permissionKey },
    },
  });

  const granted = !!result;
  permissionCache.set(key, { value: granted, expiry: now + CACHE_TTL_MS });
  return granted;
}

/**
 * Per-USER permission check.
 *
 * Thin wrapper over `checkPermission(role, key)`, kept as the seam the
 * `authorize()` / `authorizeAny()` middleware call. It used to layer a
 * per-user additive grant for the global `extendedClientAccess` CLIENT
 * flag; that flag was retired in favour of the per-project
 * `ProjectMember.fullAccess` model (see `canViewProjectInternal`), so this
 * now simply defers to the role-level matrix. The wrapper stays so a
 * future per-user grant has one obvious place to live.
 */
export async function checkPermissionForUser(
  user: { role: UserRole },
  permissionKey: string,
): Promise<boolean> {
  return checkPermission(user.role, permissionKey);
}

/**
 * Per-PROJECT internal-visibility check (2026-06-02 — per-project client
 * full access).
 *
 * Returns true when `user` may see the FULL internal view of `projectId` —
 * every task (clientVisible=false included), decisions, and internal-task
 * comments — rather than the stripped client-visible subset. True when:
 *   1. the user's ROLE grants `task.view_internal` (staff: ADMIN / PM /
 *      ENGINEER / SUPER_ADMIN, or any role an admin elevates), OR
 *   2. the user has a `ProjectMember` row for THIS project with
 *      `fullAccess = true` — the per-project client grant.
 *
 * This is the single source of truth for project-scoped internal
 * visibility. Service code that gates on "can this user see internal work
 * in this project" MUST call this (not the role-level `checkPermission`),
 * so the per-project grant is honoured: `task.service` (listTasks /
 * getTask), the `taskAccess` middleware, the decisions read, and
 * `comment.service`.
 */
export async function canViewProjectInternal(
  user: { id?: string; role: UserRole },
  projectId: string,
): Promise<boolean> {
  // 1. Role-level grant (staff). Cached.
  if (await checkPermission(user.role, 'task.view_internal')) return true;

  // 2. Per-project client grant.
  if (!user.id) return false;
  const membership = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId: user.id, projectId } },
    select: { fullAccess: true },
  });
  return membership?.fullAccess === true;
}

export async function getAllPermissions() {
  return prisma.permission.findMany({
    orderBy: [{ category: 'asc' }, { key: 'asc' }],
  });
}

export async function getRolesWithPermissions() {
  const roles = Object.values(UserRole);
  const allPermissions = await prisma.permission.findMany({ orderBy: [{ category: 'asc' }, { key: 'asc' }] });
  const rolePermissions = await prisma.rolePermission.findMany();

  return roles.map((role) => ({
    role,
    permissions: allPermissions.map((perm) => {
      const rp = rolePermissions.find((rp) => rp.role === role && rp.permissionId === perm.id);
      return { ...perm, granted: rp?.granted ?? false };
    }),
  }));
}

export async function updateRolePermissions(
  role: UserRole,
  permissions: { permissionId: string; granted: boolean }[],
  actingUserId?: string,
) {
  // Super admin rbac.manage cannot be revoked
  if (role === UserRole.SUPER_ADMIN) {
    const rbacManage = await prisma.permission.findUnique({ where: { key: 'rbac.manage' } });
    if (rbacManage) {
      const attempt = permissions.find((p) => p.permissionId === rbacManage.id && !p.granted);
      if (attempt) throw new Error('Cannot revoke rbac.manage from SUPER_ADMIN');
    }
  }

  // Snapshot current grants so the activity log can record the precise diff
  // (QA finding #28 — RBAC mutations were silently happening with no audit).
  const before = await prisma.rolePermission.findMany({
    where: { role, permissionId: { in: permissions.map((p) => p.permissionId) } },
    select: { permissionId: true, granted: true },
  });
  const beforeMap = new Map(before.map((b) => [b.permissionId, b.granted]));

  for (const perm of permissions) {
    await prisma.rolePermission.upsert({
      where: { role_permissionId: { role, permissionId: perm.permissionId } },
      update: { granted: perm.granted },
      create: { role, permissionId: perm.permissionId, granted: perm.granted },
    });
  }

  invalidateCache();

  // Best-effort audit log. Lazy-imported to avoid a circular dep with
  // activity.service (which itself is allowed to do RBAC checks).
  if (actingUserId) {
    const changes = permissions
      .filter((p) => beforeMap.get(p.permissionId) !== p.granted)
      .map((p) => ({ permissionId: p.permissionId, from: beforeMap.get(p.permissionId) ?? false, to: p.granted }));
    if (changes.length > 0) {
      const { logActivity } = await import('./activity.service');
      await logActivity({
        userId: actingUserId,
        action: 'updated_rbac',
        targetType: 'role',
        targetId: role,
        details: { role, changes },
      }).catch((err) => {
        // Non-blocking: a failed audit log shouldn't undo the RBAC change
        // (it'd leave the system in a worse state). Log to console so ops
        // sees the gap.
        logger.warn({ err: err?.message }, '[rbac] audit log failed:');
      });
    }
  }
}
