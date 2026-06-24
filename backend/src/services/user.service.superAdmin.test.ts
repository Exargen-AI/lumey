/**
 * 2026-05-23 — catastrophic-tier coverage for SUPER_ADMIN protection.
 *
 * The existing user.service.test.ts pins email normalization only. This
 * file covers the privilege-armor guards that prevent the two worst-case
 * scenarios:
 *
 *   1. WORKSPACE LOCKOUT — if the last active SUPER_ADMIN can be demoted
 *      or deactivated, the org permanently loses the ability to manage
 *      itself (no one can promote a replacement). The
 *      `assertNotLastSuperAdmin` helper runs inside a Serializable
 *      transaction to prevent two concurrent demotes from both reading
 *      "1 other admin remains" and both succeeding.
 *
 *   2. PRIVILEGE ESCALATION — if a non-SUPER_ADMIN can grant SUPER_ADMIN
 *      to themselves or others, the entire RBAC system collapses. The
 *      `assertCanChangeSuperAdminRole` helper requires the actor to ALSO
 *      be a SUPER_ADMIN before either side of a role change touches
 *      SUPER_ADMIN.
 *
 * Zero tests existed on these guards before this PR. They are exactly
 * the kind of code that no one notices until production is on fire.
 */

import './../test/prismaMock';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import { UserRole } from '@prisma/client';
import { ForbiddenError } from '../utils/errors';

const { logActivitySpy } = vi.hoisted(() => ({
  logActivitySpy: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./activity.service', () => ({
  __esModule: true,
  logActivity: logActivitySpy,
}));
vi.mock('../utils/password', () => ({
  __esModule: true,
  hashPassword: vi.fn(async (s: string) => `hashed:${s}`),
}));

import { updateUser, deactivateUser } from './user.service';

const SUPER_A_ID = 'super-a';
const SUPER_B_ID = 'super-b';
const ADMIN_ID = 'admin-1';
const ENGINEER_ID = 'engineer-1';

function userRow(id: string, role: UserRole, isActive = true) {
  return {
    id,
    email: `${id}@x.in`,
    name: id,
    passwordHash: 'hash',
    role,
    isActive,
    tokenVersion: 0,
    failedLoginCount: 0,
    lockedUntil: null,
    company: null,
    isSeedData: false,
    userType: 'HUMAN' as const,
    agentRole: null,
    agentSystemPromptPath: null,
    agentBudgetMonthlyUsdCents: null,
    agentActive: true,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any;
}

/**
 * Helper: mock prisma.user.findUnique to return rows by id. Avoids
 * brittle `mockResolvedValueOnce` ordering — the service code makes
 * multiple lookups (target, then actor inside each guard), and the
 * exact count depends on which guards fire. Id-aware mocking gives
 * the right row regardless of call order.
 */
function mockUsers(rows: Record<string, any>) {
  prismaMock.user.findUnique.mockImplementation(
    ((args: any) => Promise.resolve(rows[args?.where?.id] ?? null)) as any,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default $transaction: run the inner fn with prismaMock as the tx client.
  (prismaMock.$transaction as any).mockImplementation(async (fn: any, _opts?: any) => fn(prismaMock));
});

describe('updateUser — privilege escalation defense', () => {
  it('refuses ADMIN trying to promote ANOTHER user to SUPER_ADMIN', async () => {
    mockUsers({
      [ENGINEER_ID]: userRow(ENGINEER_ID, UserRole.ENGINEER),
      [ADMIN_ID]: userRow(ADMIN_ID, UserRole.ADMIN),
    });
    await expect(
      updateUser(ENGINEER_ID, { role: UserRole.SUPER_ADMIN }, ADMIN_ID),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses ADMIN trying to DEMOTE a SUPER_ADMIN to ADMIN', async () => {
    mockUsers({
      [SUPER_A_ID]: userRow(SUPER_A_ID, UserRole.SUPER_ADMIN),
      [ADMIN_ID]: userRow(ADMIN_ID, UserRole.ADMIN),
    });
    await expect(
      updateUser(SUPER_A_ID, { role: UserRole.ADMIN }, ADMIN_ID),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses ENGINEER trying to promote THEMSELVES (the worst case)', async () => {
    mockUsers({
      [ENGINEER_ID]: userRow(ENGINEER_ID, UserRole.ENGINEER),
    });
    await expect(
      updateUser(ENGINEER_ID, { role: UserRole.SUPER_ADMIN }, ENGINEER_ID),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('allows SUPER_ADMIN promoting an ADMIN to SUPER_ADMIN (happy path)', async () => {
    mockUsers({
      [ADMIN_ID]: userRow(ADMIN_ID, UserRole.ADMIN),
      [SUPER_A_ID]: userRow(SUPER_A_ID, UserRole.SUPER_ADMIN),
    });
    prismaMock.user.update.mockResolvedValue(userRow(ADMIN_ID, UserRole.SUPER_ADMIN) as any);

    const out = await updateUser(ADMIN_ID, { role: UserRole.SUPER_ADMIN }, SUPER_A_ID);
    expect(out.role).toBe(UserRole.SUPER_ADMIN);
  });

  it('refuses an INACTIVE SUPER_ADMIN from acting on another SUPER_ADMIN (deactivated admins lose privilege)', async () => {
    mockUsers({
      [SUPER_A_ID]: userRow(SUPER_A_ID, UserRole.SUPER_ADMIN),
      // Actor SUPER_B is "stored" as SUPER_ADMIN but isActive: false.
      [SUPER_B_ID]: userRow(SUPER_B_ID, UserRole.SUPER_ADMIN, false),
    });
    await expect(
      updateUser(SUPER_A_ID, { role: UserRole.ADMIN }, SUPER_B_ID),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('updateUser — self-demote refusal (irreversible footgun)', () => {
  it('refuses a SUPER_ADMIN demoting THEIR OWN role, even when others exist', async () => {
    mockUsers({
      [SUPER_A_ID]: userRow(SUPER_A_ID, UserRole.SUPER_ADMIN),
    });
    await expect(
      updateUser(SUPER_A_ID, { role: UserRole.ADMIN }, SUPER_A_ID),
    ).rejects.toThrow(/cannot demote your own Super Admin role/i);
  });
});

describe('updateUser — last-SUPER_ADMIN demotion lockout protection', () => {
  it('refuses demoting the ONLY remaining active SUPER_ADMIN (workspace lockout)', async () => {
    mockUsers({
      [SUPER_A_ID]: userRow(SUPER_A_ID, UserRole.SUPER_ADMIN),
      [SUPER_B_ID]: userRow(SUPER_B_ID, UserRole.SUPER_ADMIN),
    });
    prismaMock.user.count.mockResolvedValue(0); // no other active super-admins
    await expect(
      updateUser(SUPER_A_ID, { role: UserRole.ADMIN }, SUPER_B_ID),
    ).rejects.toThrow(/only remaining Super Admin/i);
  });

  it('allows demoting one SUPER_ADMIN when at least one OTHER remains active', async () => {
    mockUsers({
      [SUPER_A_ID]: userRow(SUPER_A_ID, UserRole.SUPER_ADMIN),
      [SUPER_B_ID]: userRow(SUPER_B_ID, UserRole.SUPER_ADMIN),
    });
    prismaMock.user.count.mockResolvedValue(1);
    prismaMock.user.update.mockResolvedValue(userRow(SUPER_A_ID, UserRole.ADMIN) as any);

    const out = await updateUser(SUPER_A_ID, { role: UserRole.ADMIN }, SUPER_B_ID);
    expect(out.role).toBe(UserRole.ADMIN);
  });

  it('runs the count + update inside a Serializable transaction (the QA A-H2 race fix)', async () => {
    mockUsers({
      [SUPER_A_ID]: userRow(SUPER_A_ID, UserRole.SUPER_ADMIN),
      [SUPER_B_ID]: userRow(SUPER_B_ID, UserRole.SUPER_ADMIN),
    });
    prismaMock.user.count.mockResolvedValue(1);
    prismaMock.user.update.mockResolvedValue(userRow(SUPER_A_ID, UserRole.ADMIN) as any);

    await updateUser(SUPER_A_ID, { role: UserRole.ADMIN }, SUPER_B_ID);

    const txCall = (prismaMock.$transaction as any).mock.calls[0];
    expect(txCall[1]).toEqual(
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
  });
});

describe('deactivateUser — self-deactivation + last-admin armor', () => {
  it('refuses an admin trying to deactivate THEIR OWN account (the accidental-lockout footgun)', async () => {
    mockUsers({ [ADMIN_ID]: userRow(ADMIN_ID, UserRole.ADMIN) });
    await expect(deactivateUser(ADMIN_ID, ADMIN_ID)).rejects.toThrow(/own account/i);
  });

  it('refuses ADMIN trying to deactivate a SUPER_ADMIN', async () => {
    mockUsers({
      [SUPER_A_ID]: userRow(SUPER_A_ID, UserRole.SUPER_ADMIN),
      [ADMIN_ID]: userRow(ADMIN_ID, UserRole.ADMIN),
    });
    await expect(deactivateUser(SUPER_A_ID, ADMIN_ID)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses deactivating the LAST active SUPER_ADMIN', async () => {
    mockUsers({
      [SUPER_A_ID]: userRow(SUPER_A_ID, UserRole.SUPER_ADMIN),
      [SUPER_B_ID]: userRow(SUPER_B_ID, UserRole.SUPER_ADMIN),
    });
    prismaMock.user.count.mockResolvedValue(0);
    await expect(deactivateUser(SUPER_A_ID, SUPER_B_ID)).rejects.toThrow(/only remaining/i);
  });

  it('happy path: SUPER_ADMIN deactivates ENGINEER → bumps tokenVersion + revokes refresh tokens', async () => {
    mockUsers({
      [ENGINEER_ID]: userRow(ENGINEER_ID, UserRole.ENGINEER),
      [SUPER_A_ID]: userRow(SUPER_A_ID, UserRole.SUPER_ADMIN),
    });
    prismaMock.user.update.mockResolvedValue({} as any);
    prismaMock.refreshToken.updateMany.mockResolvedValue({ count: 1 } as any);

    await deactivateUser(ENGINEER_ID, SUPER_A_ID);

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: ENGINEER_ID },
      data: expect.objectContaining({
        isActive: false,
        tokenVersion: { increment: 1 },
      }),
    });
    expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: ENGINEER_ID, revokedAt: null },
      data: expect.objectContaining({ revokedAt: expect.any(Date) }),
    });
  });
});
