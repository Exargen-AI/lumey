import { Prisma, UserRole } from '@prisma/client';
import prisma from '../config/database';
import { LIST_QUERY_CAP } from '../constants/listLimits';
import { hashPassword } from '../utils/password';
import { NotFoundError, ConflictError, ForbiddenError } from '../utils/errors';
import { normalizeEmail } from '../utils/email';
import { logActivity } from './activity.service';
import { viewerCanSeeAgents } from '../lib/agentVisibility';

/**
 * Super-admin armor.
 *
 * Pankaj (the founder) is the canonical SUPER_ADMIN and the sole approver
 * for company-wide actions like leave. The role is the bedrock of the
 * permission system — every other role ladders down from it. So we
 * harden it against:
 *
 *   1. Demotion attack — an ADMIN flipping a SUPER_ADMIN's role down.
 *      Only a SUPER_ADMIN may modify another SUPER_ADMIN.
 *
 *   2. Promotion attack — an ADMIN promoting themselves (or anyone else)
 *      to SUPER_ADMIN. Only a SUPER_ADMIN may grant the role.
 *
 *   3. Lockout attack — deactivating, password-resetting, or otherwise
 *      kicking out a SUPER_ADMIN by anyone except another SUPER_ADMIN.
 *
 *   4. Lights-out attack — accidentally (or maliciously) deactivating /
 *      demoting the LAST active SUPER_ADMIN, which would lock the
 *      workspace out of any super-admin operation forever. We refuse
 *      these no matter who's asking.
 *
 * These run in addition to the route-level `authorize('user.*')` checks
 * — defense in depth so a permission misconfig can't bypass the guard.
 */

/** Throws if the actor lacks the privilege to act on a SUPER_ADMIN target. */
async function assertCanActOnSuperAdmin(actingUserId: string, targetUser: { role: UserRole }, action: string): Promise<void> {
  if (targetUser.role !== UserRole.SUPER_ADMIN) return;
  const actor = await prisma.user.findUnique({
    where: { id: actingUserId },
    select: { role: true, isActive: true },
  });
  if (!actor || !actor.isActive || actor.role !== UserRole.SUPER_ADMIN) {
    throw new ForbiddenError(`Only a Super Admin can ${action} another Super Admin`);
  }
}

/** Throws if the actor lacks the privilege to grant or revoke SUPER_ADMIN. */
async function assertCanChangeSuperAdminRole(actingUserId: string, fromRole: UserRole, toRole: UserRole): Promise<void> {
  // Either side touching SUPER_ADMIN demands SUPER_ADMIN actor.
  if (fromRole !== UserRole.SUPER_ADMIN && toRole !== UserRole.SUPER_ADMIN) return;
  const actor = await prisma.user.findUnique({
    where: { id: actingUserId },
    select: { role: true, isActive: true },
  });
  if (!actor || !actor.isActive || actor.role !== UserRole.SUPER_ADMIN) {
    throw new ForbiddenError('Only a Super Admin can grant or revoke the Super Admin role');
  }
}

/**
 * Throws if removing the target SUPER_ADMIN (by deactivation OR demotion)
 * would leave zero active SUPER_ADMINs in the workspace.
 *
 * QA finding A-H2: this MUST be called inside a `Serializable` transaction
 * AND on the SAME tx client that performs the subsequent update. Without
 * those two properties, two concurrent demote/deactivate ops can each
 * read `otherActive === 1`, both pass the guard, and both commit → zero
 * super-admins (lights-out). Postgres `Serializable` detects the
 * conflict on commit; the loser gets a serialization-failure error which
 * the caller surfaces as a retry/refusal.
 *
 * The `tx` parameter is the Prisma transaction client — pass `prisma` for
 * non-tx callers (which we don't have anymore for these mutations).
 */
async function assertNotLastSuperAdmin(
  tx: Prisma.TransactionClient | typeof prisma,
  targetUserId: string,
  action: 'deactivate' | 'demote',
): Promise<void> {
  const otherActive = await tx.user.count({
    where: {
      role: UserRole.SUPER_ADMIN,
      isActive: true,
      id: { not: targetUserId },
    },
  });
  if (otherActive === 0) {
    throw new ForbiddenError(
      `Refusing to ${action} the only remaining Super Admin. Promote another user to Super Admin first.`,
    );
  }
}

export async function listUsers(filters: any = {}, viewer?: { role: UserRole; canViewAgents?: boolean | null }) {
  const where: any = {};

  if (filters.role) where.role = filters.role;
  if (filters.isActive !== undefined) where.isActive = filters.isActive === 'true';
  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: 'insensitive' } },
      { email: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  // 2026-06-01 — Agent visibility lockdown. AGENT users are hidden from
  // the people/team list for any viewer not on the allowlist
  // (SUPER_ADMIN passes). `viewer` is optional so internal callers that
  // don't pass it default to the safe (hide-agents) behaviour.
  if (!viewer || !viewerCanSeeAgents(viewer)) {
    where.userType = { not: 'AGENT' };
  }

  return prisma.user.findMany({
    where,
    select: {
      id: true, name: true, email: true, role: true, company: true,
      isActive: true, lastLoginAt: true, createdAt: true, updatedAt: true,
      // 2026-06-01 — agent-visibility allowlist. `userType` lets the
      // SUPER_ADMIN grant UI offer only HUMAN users (you don't grant
      // agent-visibility to an agent), and `canViewAgents` pre-fills
      // the multi-select with who's currently granted.
      userType: true,
      canViewAgents: true,
      _count: { select: { projectMemberships: true } },
    },
    orderBy: { name: 'asc' },
    // Defensive ceiling (2026-06-01 hardening) — see constants/listLimits.
    take: LIST_QUERY_CAP,
  });
}

export async function getUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      projectMemberships: {
        include: { project: { select: { id: true, name: true, slug: true } } },
      },
    },
  });

  if (!user) throw new NotFoundError('User');
  const { passwordHash: _, ...userWithoutPassword } = user;
  return userWithoutPassword;
}

export async function createUser(data: any, actingUserId: string) {
  // Normalize email at the service boundary too — defense-in-depth on top of
  // the createUserSchema's `.transform(normalizeEmail)`. Without this, a
  // programmatic caller passing `{ email: 'John@Exargen.in' }` could create
  // a row that the case-insensitive duplicate check below would correctly
  // reject — but the row write itself would still go in as mixed-case,
  // re-introducing the prod login bug for that user. See utils/email.ts.
  data.email = normalizeEmail(data.email);
  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) throw new ConflictError('User with this email already exists');

  // Super-admin armor: only a SUPER_ADMIN can MINT another SUPER_ADMIN.
  // Without this, an ADMIN with `user.create` could provision a new user
  // with `role: SUPER_ADMIN` and self-elevate the workspace.
  if (data.role === UserRole.SUPER_ADMIN) {
    const actor = await prisma.user.findUnique({
      where: { id: actingUserId },
      select: { role: true, isActive: true },
    });
    if (!actor || !actor.isActive || actor.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenError('Only a Super Admin can create another Super Admin');
    }
  }

  // Agent-platform armor: only a SUPER_ADMIN can MINT an agent. Agents have
  // a different policy footprint (e.g. cannot transition tasks to Done) and
  // we want their creation to be a deliberate Super-Admin action, not
  // something an ADMIN with `user.create` can do.
  const isAgent = data.userType === 'AGENT';
  if (isAgent) {
    const actor = await prisma.user.findUnique({
      where: { id: actingUserId },
      select: { role: true, isActive: true },
    });
    if (!actor || !actor.isActive || actor.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenError('Only a Super Admin can create an agent user');
    }
  }

  const passwordHash = await hashPassword(data.password);

  const user = await prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      passwordHash,
      role: data.role,
      company: data.company || null,
      // Agent-platform fields. For humans these stay at their defaults
      // (userType=HUMAN, agent* nullable/zero/true).
      userType: isAgent ? 'AGENT' : 'HUMAN',
      agentRole: isAgent ? (data.agentRole ?? null) : null,
      agentSystemPromptPath: isAgent ? (data.agentSystemPromptPath ?? null) : null,
      agentBudgetMonthlyUsdCents:
        isAgent && typeof data.agentBudgetMonthlyUsdCents === 'number'
          ? data.agentBudgetMonthlyUsdCents
          : null,
      agentActive: isAgent ? (data.agentActive ?? true) : true,
    },
  });

  // Create project memberships
  if (data.projectIds && data.projectIds.length > 0) {
    await prisma.projectMember.createMany({
      data: data.projectIds.map((p: any) => ({
        userId: user.id,
        projectId: p.projectId,
        role: p.role,
      })),
    });
  }

  await logActivity({
    userId: actingUserId, action: 'created_user',
    targetType: 'user', targetId: user.id,
    details: { name: user.name, role: user.role, userType: user.userType, agentRole: user.agentRole },
  });

  const { passwordHash: _, ...userWithoutPassword } = user;
  return userWithoutPassword;
}

export async function updateUser(userId: string, data: any, actingUserId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError('User');

  // Email change path: normalize + check uniqueness against the lowercased
  // canonical form. The validator already lowercases route bodies; this is
  // defense-in-depth + guarantees the duplicate check sees the same value
  // that will be written. Skipped when `email` isn't in the patch (admin
  // edits don't always touch email).
  if (data.email !== undefined) {
    data.email = normalizeEmail(data.email);
    if (data.email !== user.email) {
      const clash = await prisma.user.findUnique({ where: { email: data.email } });
      if (clash && clash.id !== userId) {
        throw new ConflictError('User with this email already exists');
      }
    }
  }

  // ── Super-admin armor ─────────────────────────────────────────────────
  // Permission-only checks (caller's role) can run BEFORE the tx — they
  // don't depend on workspace state. The `assertNotLastSuperAdmin` count
  // MUST run inside the tx (QA A-H2): two concurrent demotes both seeing
  // "1 other active super-admin" would otherwise both succeed and leave
  // zero super-admins. Serializable isolation makes Postgres detect the
  // conflict on commit.
  await assertCanActOnSuperAdmin(actingUserId, user, 'update');

  if (data.role !== undefined && data.role !== user.role) {
    await assertCanChangeSuperAdminRole(actingUserId, user.role, data.role);
    // QA A-H3: a SUPER_ADMIN can promote ADMINs but cannot demote
    // themselves. Self-demote is an irreversible foot-gun (you lose the
    // ability to act on yourself, and there's no undo from a demoted
    // account). Even when other super-admins exist, refuse — the
    // founder needs to ask the other super-admin to do the demotion.
    if (
      userId === actingUserId &&
      user.role === UserRole.SUPER_ADMIN &&
      data.role !== UserRole.SUPER_ADMIN
    ) {
      throw new ForbiddenError(
        'You cannot demote your own Super Admin role. Ask another Super Admin to do it for you.',
      );
    }
  }

  // Reactivation of a SUPER_ADMIN — only SUPER_ADMIN can do it.
  if (data.isActive === true && user.role === UserRole.SUPER_ADMIN && !user.isActive) {
    await assertCanActOnSuperAdmin(actingUserId, user, 'reactivate');
  }
  // ──────────────────────────────────────────────────────────────────────

  // Agent-platform armor: agent fields (userType, agentRole,
  // agentSystemPromptPath, agentBudgetMonthlyUsdCents, agentActive) can only
  // be touched by a SUPER_ADMIN. If a non-super-admin caller passes any of
  // them in `data`, drop them silently — preserves the simpler API shape
  // for the existing edit-user form, while ensuring no one can flip a
  // human into an agent (or vice versa) via the admin UI.
  const agentFieldKeys = [
    'userType',
    'agentRole',
    'agentSystemPromptPath',
    'agentBudgetMonthlyUsdCents',
    'agentActive',
  ] as const;
  const callerHasAgentFields = agentFieldKeys.some((k) => k in data);
  if (callerHasAgentFields) {
    const actor = await prisma.user.findUnique({
      where: { id: actingUserId },
      select: { role: true, isActive: true },
    });
    if (!actor || !actor.isActive || actor.role !== UserRole.SUPER_ADMIN) {
      for (const k of agentFieldKeys) delete (data as any)[k];
    }
  }


  // 2026-06-01 — Agent visibility armor. `canViewAgents` adds the user
  // to the allowlist that can see AI agents + agent-owned work. Same
  // SUPER_ADMIN-only shape as the extended-client armor above: any
  // non-SUPER_ADMIN actor has the key silently stripped; SUPER_ADMIN's
  // value is coerced to a strict boolean before it's persisted.
  if ('canViewAgents' in data) {
    const actor = await prisma.user.findUnique({
      where: { id: actingUserId },
      select: { role: true, isActive: true },
    });
    if (!actor || !actor.isActive || actor.role !== UserRole.SUPER_ADMIN) {
      delete (data as any).canViewAgents;
    } else {
      (data as any).canViewAgents = (data as any).canViewAgents === true;
    }
  }

  const willDemoteSuperAdmin =
    data.role !== undefined &&
    user.role === UserRole.SUPER_ADMIN &&
    data.role !== UserRole.SUPER_ADMIN;

  const updated = await prisma.$transaction(
    async (tx) => {
      // Inside-tx last-admin guard. Skipped if the edit isn't a
      // SUPER_ADMIN demotion — keeps non-role edits cheap.
      if (willDemoteSuperAdmin) {
        await assertNotLastSuperAdmin(tx, userId, 'demote');
      }
      return tx.user.update({ where: { id: userId }, data });
    },
    // Serializable so the count + update are atomic against concurrent
    // demote/deactivate ops on other super-admins.
    willDemoteSuperAdmin
      ? { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      : undefined,
  );

  await logActivity({
    userId: actingUserId, action: 'updated_user',
    targetType: 'user', targetId: userId,
    // Surface the role change explicitly in the audit log — these events
    // matter most when post-mortem-ing "who became super-admin and when".
    details: {
      name: updated.name,
      ...(data.role !== undefined && data.role !== user.role
        ? { roleChanged: { from: user.role, to: updated.role } }
        : {}),
      ...(user.role === UserRole.SUPER_ADMIN ? { targetWasSuperAdmin: true } : {}),
    },
  });

  const { passwordHash: _, ...userWithoutPassword } = updated;
  return userWithoutPassword;
}

/**
 * Replace the agent-visibility allowlist in one shot (2026-06-01).
 *
 * SUPER_ADMIN picks, from a multi-select, exactly which users may see
 * AI agents. This sets `canViewAgents = true` for the supplied userIds
 * and `false` for every OTHER non-SUPER_ADMIN user — so de-selecting
 * someone revokes their access. SUPER_ADMINs are left untouched (they
 * see agents implicitly; their flag value is irrelevant).
 *
 * SUPER_ADMIN-only. Runs in a transaction so the allowlist can't end up
 * half-applied.
 */
export async function setAgentViewers(
  userIds: string[],
  actingUserId: string,
): Promise<{ granted: number; revoked: number }> {
  const actor = await prisma.user.findUnique({
    where: { id: actingUserId },
    select: { role: true, isActive: true },
  });
  if (!actor || !actor.isActive || actor.role !== UserRole.SUPER_ADMIN) {
    throw new ForbiddenError('Only a Super Admin can manage the agent-visibility allowlist');
  }

  // De-dupe + drop falsy ids defensively.
  const grantIds = Array.from(new Set(userIds.filter(Boolean)));

  return prisma.$transaction(async (tx) => {
    // Grant the selected users.
    const granted = grantIds.length
      ? await tx.user.updateMany({
          where: { id: { in: grantIds }, role: { not: UserRole.SUPER_ADMIN } },
          data: { canViewAgents: true },
        })
      : { count: 0 };

    // Revoke everyone else who currently has it (excluding SUPER_ADMINs
    // and the just-granted set).
    const revoked = await tx.user.updateMany({
      where: {
        canViewAgents: true,
        role: { not: UserRole.SUPER_ADMIN },
        id: { notIn: grantIds.length ? grantIds : ['__none__'] },
      },
      data: { canViewAgents: false },
    });

    return { granted: granted.count, revoked: revoked.count };
  });
}

export async function resetUserPassword(userId: string, newPassword: string, actingUserId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError('User');

  // Super-admin armor: only another SUPER_ADMIN can force-reset a
  // SUPER_ADMIN's password. Without this an ADMIN could lock the founder
  // out by issuing a reset, then taking over.
  await assertCanActOnSuperAdmin(actingUserId, user, 'reset the password of');

  const passwordHash = await hashPassword(newPassword);
  // Bump tokenVersion + revoke every refresh token in the same tx. Without
  // this, an admin-driven password reset (typical case: someone got phished,
  // forgot creds, etc.) would let any still-valid access token continue
  // working until its 15-min TTL elapsed AND any refresh token mint a new
  // one for up to 7 days. The whole point of an admin reset is to lock out
  // the user immediately. Mirrors what `changePassword` already does for
  // the self-serve flow (auth.service.ts:238).
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        tokenVersion: { increment: 1 },
        // Also clear any active lockout — the user just got new creds, no
        // reason to make them wait out the lockout window.
        failedLoginCount: 0,
        lockedUntil: null,
      },
    }),
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);

  await logActivity({
    userId: actingUserId, action: 'reset_password',
    targetType: 'user', targetId: userId,
    details: { name: user.name, sessionsRevoked: true },
  });
}

export async function deactivateUser(userId: string, actingUserId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new NotFoundError('User');

  // Self-deactivation guard: catches the "admin accidentally deactivates
  // their own account" footgun before any other checks run. The user
  // meant to deactivate someone else.
  if (userId === actingUserId) {
    throw new ForbiddenError('You cannot deactivate your own account. Ask another admin.');
  }

  // Super-admin armor: only another SUPER_ADMIN can deactivate a
  // SUPER_ADMIN. AND we never deactivate the LAST active SUPER_ADMIN
  // (would lock the workspace out of any super-admin operation forever).
  // The count check has to happen INSIDE the tx with Serializable
  // isolation (QA A-H2) — see comments on `assertNotLastSuperAdmin`.
  await assertCanActOnSuperAdmin(actingUserId, user, 'deactivate');

  const isSuperAdmin = user.role === UserRole.SUPER_ADMIN;

  // Soft-delete + immediate session kill in one tx.
  //
  // Previously deactivation only flipped `isActive: false`, which meant
  // a deactivated user with a still-valid access token kept working for
  // up to 15 minutes (the TTL), and a still-valid refresh token could
  // mint new access tokens for up to 7 days. tokenVersion bump kills
  // every issued access token (the `authenticate` middleware checks tv
  // match on every request); revokedAt on every active RefreshToken row
  // blocks future refresh.
  //
  // For SUPER_ADMIN deactivation we use Serializable + an inside-tx
  // count to defeat the "two concurrent deactivations both pass the
  // last-admin guard" race.
  await prisma.$transaction(
    async (tx) => {
      if (isSuperAdmin) {
        await assertNotLastSuperAdmin(tx, userId, 'deactivate');
      }
      await tx.user.update({
        where: { id: userId },
        data: { isActive: false, tokenVersion: { increment: 1 } },
      });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    },
    isSuperAdmin
      ? { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      : undefined,
  );

  await logActivity({
    userId: actingUserId, action: 'deactivated_user',
    targetType: 'user', targetId: userId,
    details: { name: user.name, sessionsRevoked: true },
  });
}
