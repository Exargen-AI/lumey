import { UserRole, type User, type Permission, type RolePermission } from '@prisma/client';

/**
 * Phase 2 of the baseline hardening plan. Object factories for backend
 * service unit tests.
 *
 * Each factory returns a fully-typed model object with sensible defaults
 * and a single optional `overrides` argument. Spread the override last so
 * tests can flip any field without re-stating the whole shape:
 *
 *     const admin = makeUser({ role: 'ADMIN' });
 *     const lockedOut = makeUser({ lockedUntil: new Date(Date.now() + 60_000) });
 *
 * These factories produce in-memory objects only — they don't touch the
 * DB. Use them as return values from `prismaMock.<model>.<method>` stubs.
 *
 * Keep this file small. Add a factory only when a third test would
 * otherwise hand-roll the same shape.
 */

let nextId = 1;
function genId(prefix = 'id'): string {
  return `${prefix}-${nextId++}`;
}

export function makeUser(overrides: Partial<User> = {}): User {
  const id = overrides.id ?? genId('user');
  const now = new Date();
  return {
    id,
    email: `${id}@test.local`,
    name: 'Test User',
    role: UserRole.ENGINEER,
    company: null,
    avatarKey: null,
    passwordHash: '$2b$12$abcdefghijklmnopqrstuv',
    isSeedData: false,
    isActive: true,
    failedLoginCount: 0,
    lockedUntil: null,
    legalName: null,
    tokenVersion: 0,
    onboardingRequired: true,
    onboardingCompletedAt: null,
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as User;
}

export function makePermission(overrides: Partial<Permission> = {}): Permission {
  const id = overrides.id ?? genId('perm');
  const now = new Date();
  return {
    id,
    key: overrides.key ?? `test.${id}`,
    label: 'Test permission',
    description: null,
    category: 'test',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as Permission;
}

export function makeRolePermission(overrides: Partial<RolePermission> = {}): RolePermission {
  const id = overrides.id ?? genId('rp');
  const now = new Date();
  return {
    id,
    role: UserRole.ADMIN,
    permissionId: overrides.permissionId ?? 'perm-1',
    granted: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as RolePermission;
}
