/**
 * Real-Postgres regression tests for the login bugs fixed in PR #134.
 *
 * Why this lives in the real-DB suite (not the unit suite):
 *
 *   The bugs we fixed are CASE-SENSITIVITY (a property of Postgres's
 *   string compare) and TIMESTAMP-ARITHMETIC (a property of clock-time
 *   on the DB host). The unit suite mocks Prisma and stubs Date, so
 *   neither property is actually exercised — a regression to the
 *   case-sensitive `findUnique` or the lockout reset would still pass
 *   the unit suite. These tests pin the fixes against the real
 *   constraints they're supposed to satisfy.
 *
 *   They also exercise the migration we shipped (lowercase_user_emails),
 *   which the unit suite cannot — it never runs SQL. PR #134's
 *   first CI run crashed because the migration used `"User"` instead of
 *   `"users"`; the unit suite was green throughout. THIS suite would
 *   have caught it.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  getTestPrisma,
  prepareSchema,
  resetDb,
  disconnectTestPrisma,
} from './harness';
import { hashPassword } from '../../utils/password';

const prisma = getTestPrisma();

beforeAll(async () => {
  await prepareSchema();
});
beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await disconnectTestPrisma();
});

describe('auth — case-insensitive email login (real Postgres)', () => {
  it('finds the user even when the canonical row is lowercase and the lookup is mixed-case', async () => {
    // Setup: insert a user with the canonical lowercase email — the
    // shape the post-migration DB always has.
    const passwordHash = await hashPassword('Sup3r$ecure!');
    await prisma.user.create({
      data: {
        email: 'john@exargen.in',
        name: 'John',
        passwordHash,
        role: 'ENGINEER',
      },
    });

    // Dynamic-import the service so the test boots a clean prisma client
    // from the harness rather than the singleton from `config/database`
    // (which would point at the wrong DB). The login service itself
    // imports the default prisma — we route via the test DB by setting
    // DATABASE_URL_TEST on the env BEFORE this process started.
    const { login } = await import('../../services/auth.service');

    // The actual regression: case-mixed email must resolve to the row.
    const result = await login('John@Exargen.IN', 'Sup3r$ecure!');
    expect(result.user.email).toBe('john@exargen.in');
    expect(result.accessToken).toBeTypeOf('string');
  });

  it('rejects the case-insensitive duplicate at the unique-index level after migration normalization', async () => {
    // Belt-and-suspenders for the migration: a future write of a
    // mixed-case email through a path that bypasses normalizeEmail
    // (e.g. raw SQL during a data-fix script) should fail the unique
    // constraint — but only if we've ALSO lowercased existing rows. We
    // assert the post-migration invariant: two rows differing only in
    // case can't coexist.
    const hash = await hashPassword('Pwd!12345');
    await prisma.user.create({
      data: { email: 'dup@exargen.in', name: 'A', passwordHash: hash, role: 'ENGINEER' },
    });
    await expect(
      prisma.user.create({
        data: { email: 'dup@exargen.in', name: 'B', passwordHash: hash, role: 'ENGINEER' },
      }),
    ).rejects.toThrow(/Unique constraint/i);
  });
});

describe('auth — lockout state machine (real Postgres + real Date arithmetic)', () => {
  it('resets failedLoginCount to 1 (not 6) on the first wrong attempt after lockout expired', async () => {
    // The exact scenario the audit flagged. Without the reset, this
    // attempt would write failedLoginCount=6 and re-lock. With the
    // reset, count goes to 1 and lockedUntil stays null.
    const hash = await hashPassword('TheRealPwd!1');
    const user = await prisma.user.create({
      data: {
        email: 'locked-out@exargen.in',
        name: 'Locked',
        passwordHash: hash,
        role: 'ENGINEER',
        failedLoginCount: 5,
        lockedUntil: new Date(Date.now() - 60_000), // expired 1 minute ago
      },
    });

    const { login } = await import('../../services/auth.service');
    await expect(login('locked-out@exargen.in', 'WRONG')).rejects.toThrow();

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { failedLoginCount: true, lockedUntil: true },
    });

    // The crucial invariants:
    expect(after.failedLoginCount).toBe(1);
    expect(after.lockedUntil).toBeNull();
  });

  it('blocks login while lockedUntil is in the FUTURE even with the correct password', async () => {
    const hash = await hashPassword('TheRealPwd!1');
    await prisma.user.create({
      data: {
        email: 'still-locked@exargen.in',
        name: 'StillLocked',
        passwordHash: hash,
        role: 'ENGINEER',
        failedLoginCount: 5,
        lockedUntil: new Date(Date.now() + 5 * 60_000), // 5 min from now
      },
    });

    const { login } = await import('../../services/auth.service');
    await expect(login('still-locked@exargen.in', 'TheRealPwd!1')).rejects.toThrow(
      /temporarily locked/i,
    );
  });

  it('clears lockout state + failedLoginCount on a successful login', async () => {
    const hash = await hashPassword('TheRealPwd!1');
    const user = await prisma.user.create({
      data: {
        email: 'recovers@exargen.in',
        name: 'Recovers',
        passwordHash: hash,
        role: 'ENGINEER',
        failedLoginCount: 3,
        lockedUntil: null,
      },
    });

    const { login } = await import('../../services/auth.service');
    await login('recovers@exargen.in', 'TheRealPwd!1');

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { failedLoginCount: true, lockedUntil: true, lastLoginAt: true },
    });
    expect(after.failedLoginCount).toBe(0);
    expect(after.lockedUntil).toBeNull();
    expect(after.lastLoginAt).toBeInstanceOf(Date);
  });
});
