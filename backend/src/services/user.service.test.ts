/**
 * Focused tests for the email-normalization slice of user.service.
 *
 * Why a dedicated file:
 *
 *   user.service has historically been covered by route-level integration
 *   tests rather than unit tests. The prod bug "case-sensitive email
 *   prevents login" (reported 2026-05-21) showed that we need precise
 *   unit-level pinning on the service entrypoints — not just the auth
 *   path. This file covers exactly:
 *
 *     - createUser normalizes the email at write time
 *     - createUser's duplicate check is case-insensitive
 *     - updateUser normalizes when email is in the patch
 *     - updateUser's duplicate check refuses a case-only collision
 *
 *   Broader user.service coverage (role armor, agent armor, last-super-admin
 *   guards, course auto-enrollment) is intentionally NOT recreated here —
 *   keeping the file laser-focused makes future regressions on the email
 *   path obvious.
 */

import './../test/prismaMock';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import { UserRole } from '@prisma/client';
import { ConflictError, ForbiddenError } from '../utils/errors';

// Activity log + course enrollment helpers — mocked so we don't need to
// stand up their full Prisma surface. The email-normalization assertions
// don't depend on them.
const { logActivitySpy, getMandatoryCoursesSpy, enrollSpy } = vi.hoisted(() => ({
  logActivitySpy: vi.fn().mockResolvedValue(undefined),
  getMandatoryCoursesSpy: vi.fn().mockResolvedValue([]),
  enrollSpy: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./activity.service', () => ({
  __esModule: true,
  logActivity: logActivitySpy,
}));
vi.mock('./course.service', () => ({
  __esModule: true,
  getMandatoryCoursesForRole: getMandatoryCoursesSpy,
}));
vi.mock('./enrollment.service', () => ({
  __esModule: true,
  enrollUserInCourse: enrollSpy,
}));
vi.mock('../utils/password', () => ({
  __esModule: true,
  hashPassword: vi.fn(async (s: string) => `hashed:${s}`),
}));

import { createUser, updateUser, setAgentViewers } from './user.service';

const ACTING_USER_ID = '00000000-0000-0000-0000-00000000000a';
const NEW_USER_ID = '00000000-0000-0000-0000-00000000000b';

function makeStoredUser(overrides: Partial<{ id: string; email: string; role: UserRole; isActive: boolean }> = {}) {
  return {
    id: overrides.id ?? NEW_USER_ID,
    email: overrides.email ?? 'jane@exargen.in',
    name: 'Jane',
    passwordHash: 'hashed',
    role: overrides.role ?? UserRole.ENGINEER,
    company: null,
    isActive: overrides.isActive ?? true,
    isSeedData: false,
    tokenVersion: 0,
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null,
    onboardingRequired: false,
    onboardingCompletedAt: null,
    legalName: null,
    userType: 'HUMAN' as const,
    agentRole: null,
    agentSystemPromptPath: null,
    agentBudgetMonthlyUsdCents: null,
    agentActive: true,
    createdAt: new Date('2026-05-01T00:00:00Z'),
    updatedAt: new Date('2026-05-01T00:00:00Z'),
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  (prismaMock.$transaction as any).mockImplementation(async (fn: any) => fn(prismaMock));
});

describe('createUser — email normalization (prod bug 2026-05-21)', () => {
  it('stores the email lowercased even when the caller passes mixed case', async () => {
    // The duplicate-check findUnique misses (no existing user) → we proceed
    // to create. We assert the email VALUE handed to prisma.user.create is
    // already canonicalized.
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue(makeStoredUser({ email: 'john@exargen.in' }));

    await createUser(
      {
        name: 'John',
        email: 'John@Exargen.IN',
        password: 'Sup3r$ecure!',
        role: UserRole.ENGINEER,
      },
      ACTING_USER_ID,
    );

    // Lookup must hit the lowercased email — otherwise the dedupe is a no-op
    // for users typing in mixed case.
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'john@exargen.in' },
    });

    // The create call must persist the lowercased form so the next login
    // attempt (which also normalizes) lands on the same row.
    const createArgs = prismaMock.user.create.mock.calls[0]?.[0] as any;
    expect(createArgs.data.email).toBe('john@exargen.in');
  });

  it('rejects a duplicate even when the existing email is lowercased and the new email is mixed case', async () => {
    // A row already exists as 'john@exargen.in'. Caller tries to create
    // 'JOHN@EXARGEN.IN'. Without normalization, findUnique misses and we'd
    // crash later on the unique-constraint violation OR (worse, if the
    // constraint isn't case-folded) create a duplicate row that can never
    // log in. With normalization, we get a clean ConflictError before write.
    prismaMock.user.findUnique.mockResolvedValue(makeStoredUser({ email: 'john@exargen.in' }));

    await expect(
      createUser(
        {
          name: 'John 2',
          email: 'JOHN@EXARGEN.IN',
          password: 'Sup3r$ecure!',
          role: UserRole.ENGINEER,
        },
        ACTING_USER_ID,
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    // No row should have been written.
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('trims whitespace around the email before persisting', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue(makeStoredUser({ email: 'spaced@exargen.in' }));

    await createUser(
      {
        name: 'Spaced',
        email: '  spaced@exargen.in  ',
        password: 'Sup3r$ecure!',
        role: UserRole.ENGINEER,
      },
      ACTING_USER_ID,
    );

    const createArgs = prismaMock.user.create.mock.calls[0]?.[0] as any;
    expect(createArgs.data.email).toBe('spaced@exargen.in');
  });
});

describe('updateUser — email normalization (admin path)', () => {
  it('lowercases the email patch before persisting', async () => {
    const existing = makeStoredUser({ email: 'oldemail@exargen.in' });
    // 1st findUnique → load target user
    // 2nd findUnique → dedupe check on the new (lowercased) email
    prismaMock.user.findUnique.mockResolvedValueOnce(existing);
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    prismaMock.user.update.mockResolvedValue({ ...existing, email: 'new@exargen.in' });

    await updateUser(NEW_USER_ID, { email: 'NEW@Exargen.IN' }, ACTING_USER_ID);

    // The lowercased value must be what gets queried for the dedupe...
    expect(prismaMock.user.findUnique).toHaveBeenNthCalledWith(2, {
      where: { email: 'new@exargen.in' },
    });
    // ...and what gets written.
    const updateCall = prismaMock.user.update.mock.calls[0]?.[0] as any;
    expect(updateCall.data.email).toBe('new@exargen.in');
  });

  it('refuses a case-only-different email collision', async () => {
    const target = makeStoredUser({ id: NEW_USER_ID, email: 'me@exargen.in' });
    const clash = makeStoredUser({
      id: '00000000-0000-0000-0000-00000000000c',
      email: 'taken@exargen.in',
    });
    prismaMock.user.findUnique.mockResolvedValueOnce(target);
    prismaMock.user.findUnique.mockResolvedValueOnce(clash);

    await expect(
      updateUser(NEW_USER_ID, { email: 'TAKEN@Exargen.IN' }, ACTING_USER_ID),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('does NOT run the dedupe query when email is unchanged after normalization', async () => {
    // Setting email to its own value (just with different casing) is a no-op
    // — skip the duplicate check entirely so we don't 409 ourselves.
    const existing = makeStoredUser({ email: 'same@exargen.in' });
    prismaMock.user.findUnique.mockResolvedValueOnce(existing);
    prismaMock.user.update.mockResolvedValue(existing);

    await updateUser(NEW_USER_ID, { email: 'Same@Exargen.IN' }, ACTING_USER_ID);

    // Only the initial "load target" findUnique should have fired — no
    // dedupe call.
    expect(prismaMock.user.findUnique).toHaveBeenCalledTimes(1);
  });
});

// ─── Agent visibility allowlist (2026-06-01) ──────────────────────────

describe('updateUser — canViewAgents armor', () => {
  it('strips canViewAgents from the patch when the actor is not SUPER_ADMIN', async () => {
    const actor = makeStoredUser({ role: UserRole.ADMIN });
    const target = makeStoredUser({ role: UserRole.ENGINEER });
    prismaMock.user.findUnique.mockResolvedValueOnce(target);
    prismaMock.user.findUnique.mockResolvedValueOnce(actor);
    prismaMock.user.update.mockResolvedValue(target);

    await updateUser(NEW_USER_ID, { canViewAgents: true }, ACTING_USER_ID);

    const updateCall = prismaMock.user.update.mock.calls[0]?.[0] as any;
    expect(updateCall.data.canViewAgents).toBeUndefined();
  });

  it('persists canViewAgents when the actor is SUPER_ADMIN', async () => {
    const actor = makeStoredUser({ role: UserRole.SUPER_ADMIN });
    const target = makeStoredUser({ role: UserRole.ENGINEER });
    prismaMock.user.findUnique.mockResolvedValueOnce(target);
    prismaMock.user.findUnique.mockResolvedValueOnce(actor);
    prismaMock.user.update.mockResolvedValue({ ...target, canViewAgents: true });

    await updateUser(NEW_USER_ID, { canViewAgents: true }, ACTING_USER_ID);

    const updateCall = prismaMock.user.update.mock.calls[0]?.[0] as any;
    expect(updateCall.data.canViewAgents).toBe(true);
  });
});

describe('setAgentViewers — bulk allowlist replace', () => {
  beforeEach(() => {
    (prismaMock.$transaction as any).mockImplementation(async (fn: any) => fn(prismaMock));
  });

  it('refuses a non-SUPER_ADMIN actor', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(makeStoredUser({ role: UserRole.ADMIN }));
    await expect(setAgentViewers(['u1'], ACTING_USER_ID)).rejects.toBeInstanceOf(ForbiddenError);
    expect(prismaMock.user.updateMany).not.toHaveBeenCalled();
  });

  it('grants the selected users and revokes everyone else (SUPER_ADMINs untouched)', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(makeStoredUser({ role: UserRole.SUPER_ADMIN }));
    (prismaMock.user.updateMany as any)
      .mockResolvedValueOnce({ count: 2 }) // grant
      .mockResolvedValueOnce({ count: 3 }); // revoke

    const result = await setAgentViewers(['u1', 'u2'], ACTING_USER_ID);

    expect(result).toEqual({ granted: 2, revoked: 3 });
    // Grant call targets the selected ids and excludes SUPER_ADMINs.
    const grantArgs = (prismaMock.user.updateMany as any).mock.calls[0][0];
    expect(grantArgs.where.id).toEqual({ in: ['u1', 'u2'] });
    expect(grantArgs.where.role).toEqual({ not: UserRole.SUPER_ADMIN });
    expect(grantArgs.data).toEqual({ canViewAgents: true });
    // Revoke call clears canViewAgents on everyone NOT in the granted set.
    const revokeArgs = (prismaMock.user.updateMany as any).mock.calls[1][0];
    expect(revokeArgs.where.id).toEqual({ notIn: ['u1', 'u2'] });
    expect(revokeArgs.data).toEqual({ canViewAgents: false });
  });

  it('revokes ALL non-super-admins when the selection is empty', async () => {
    prismaMock.user.findUnique.mockResolvedValueOnce(makeStoredUser({ role: UserRole.SUPER_ADMIN }));
    (prismaMock.user.updateMany as any).mockResolvedValueOnce({ count: 4 });

    const result = await setAgentViewers([], ACTING_USER_ID);
    expect(result).toEqual({ granted: 0, revoked: 4 });
    // No grant updateMany when the list is empty; only the revoke runs.
    expect((prismaMock.user.updateMany as any).mock.calls).toHaveLength(1);
  });
});
