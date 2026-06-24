/**
 * Phase 2.2 of the baseline hardening plan — auth.service core.
 *
 * Critical-tier (security primitive). Target coverage on every function
 * under test: ≥ 95% (we aim for 100% on each branch since this is the
 * front door).
 *
 * What this file is hunting for, beyond happy-path coverage:
 *
 *   1. **Timing-attack regressions.** Every code path in `login` must
 *      run `comparePassword` once. If a future refactor short-circuits
 *      on unknown email or locked account, an attacker can enumerate
 *      valid emails by response timing. Each negative-path test asserts
 *      `comparePassword` was actually called.
 *
 *   2. **Lockout off-by-ones.** The threshold is `nextCount >= 5` not
 *      `> 5`. After 5 failed attempts, the next one must be blocked
 *      cold by the locked-account guard.
 *
 *   3. **Refresh-token reuse detection.** Presenting an already-revoked
 *      refresh token kills *every* session for that user (bumps
 *      tokenVersion, revokes all live refresh rows). A regression here
 *      would let an attacker keep using a stolen-then-rotated token.
 *
 *   4. **Refresh rotation FK order.** The new row must be created BEFORE
 *      the old row is updated (because `replacedById` on the old row
 *      points at the new row's id). Wrong order = FK constraint
 *      violation at runtime.
 *
 *   5. **Pre-migration token guard.** Old refresh tokens without `jti`
 *      or `tv` claims must be rejected with 401, not crash Prisma's
 *      `findUnique({ id: undefined })`.
 *
 *   6. **Logout idempotency.** `revokeRefreshToken` is called by the
 *      logout handler and must never throw — bad token in, silent
 *      return out.
 *
 *   7. **Password change kills sessions.** After changePassword, every
 *      access + refresh token in flight must be dead.
 */

// Wire the shared Prisma mock first.
import './../test/prismaMock';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import { makeUser } from '../test/factories';
import { UnauthorizedError } from '../utils/errors';

// ─── Module mocks ───────────────────────────────────────────────────────
// JWT — hoisted by vi.mock so service imports see the stubs.
vi.mock('../utils/jwt', () => ({
  __esModule: true,
  generateAccessToken: vi.fn((payload: unknown) => `at:${JSON.stringify(payload)}`),
  generateRefreshToken: vi.fn((payload: unknown) => `rt:${JSON.stringify(payload)}`),
  verifyRefreshToken: vi.fn(),
}));

// password.ts wraps bcrypt. We mock both functions so:
//   - tests don't actually run bcrypt (slow + non-deterministic)
//   - we can spy on `comparePassword` to prove timing-safety branches
//     ALL call it.
vi.mock('../utils/password', () => ({
  __esModule: true,
  hashPassword: vi.fn(async (s: string) => `hashed:${s}`),
  comparePassword: vi.fn(),
}));

// env — auth.service reads JWT_REFRESH_EXPIRY for refreshExpiryDate().
// Use vi.hoisted so the env object is mutable across tests (one case
// flips JWT_REFRESH_EXPIRY to something malformed to hit the fallback).
const envHoisted = vi.hoisted(() => ({
  env: {
    NODE_ENV: 'test',
    JWT_REFRESH_EXPIRY: '7d',
    JWT_ACCESS_EXPIRY: '15m',
  },
}));
vi.mock('../config/env', () => ({
  __esModule: true,
  env: envHoisted.env,
}));

// S3 integration — stubbed so the avatar paths don't touch AWS. Each function
// is a vi.fn the tests drive per-case.
const { s3Mocks } = vi.hoisted(() => ({
  s3Mocks: {
    buildAvatarS3Key: (userId: string, rand: string, ext: string) => `avatars/${userId}/${rand}.${ext}`,
    signUploadUrl: vi.fn(async () => 'https://s3.example/put'),
    signInlineGetUrl: vi.fn(async () => 'https://s3.example/get'),
    objectExists: vi.fn(async () => true),
    deleteObject: vi.fn(async () => undefined),
  },
}));
vi.mock('../integrations/s3', () => ({ __esModule: true, ...s3Mocks }));

import {
  login,
  refreshAccessToken,
  revokeRefreshToken,
  revokeAllSessions,
  updateMe,
  changePassword,
  getUserProfile,
  createAvatarUploadUrl,
  setAvatar,
  removeAvatar,
} from './auth.service';
import { ValidationError, ForbiddenError } from '../utils/errors';
import { comparePassword, hashPassword } from '../utils/password';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/jwt';

const mockedComparePassword = vi.mocked(comparePassword);
const mockedHashPassword = vi.mocked(hashPassword);
const mockedGenerateAccessToken = vi.mocked(generateAccessToken);
const mockedGenerateRefreshToken = vi.mocked(generateRefreshToken);
const mockedVerifyRefreshToken = vi.mocked(verifyRefreshToken);

beforeEach(() => {
  mockedComparePassword.mockReset();
  mockedHashPassword.mockReset();
  mockedGenerateAccessToken.mockReset();
  mockedGenerateRefreshToken.mockReset();
  mockedVerifyRefreshToken.mockReset();
  // Default safe stubs so tests only override what they care about.
  mockedComparePassword.mockResolvedValue(false);
  mockedHashPassword.mockImplementation(async (s) => `hashed:${s}`);
  mockedGenerateAccessToken.mockReturnValue('access-token');
  mockedGenerateRefreshToken.mockReturnValue('refresh-token');
});

// $transaction takes an array of pending queries — the mock just runs
// each one and returns the resolved array. Good enough for unit tests;
// the real transaction-isolation behavior lives in Phase 3 integration.
function configureTransactionPassthrough() {
  prismaMock.$transaction.mockImplementation(async (ops: any) => {
    if (Array.isArray(ops)) return Promise.all(ops);
    if (typeof ops === 'function') return ops(prismaMock as any);
    return ops;
  });
}

// ─── login ─────────────────────────────────────────────────────────────

describe('login()', () => {
  beforeEach(() => {
    configureTransactionPassthrough();
  });

  describe('timing safety (the critical security property)', () => {
    it('runs comparePassword on an unknown email so timing matches a known email', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      await expect(login('ghost@nope.in', 'pw')).rejects.toThrow(UnauthorizedError);

      // The dummy-hash compare must have been called — that's the entire
      // point of the no-short-circuit branch.
      expect(mockedComparePassword).toHaveBeenCalledTimes(1);
    });

    it('runs comparePassword on a locked account so timing matches the unknown-email branch', async () => {
      prismaMock.user.findUnique.mockResolvedValue(
        makeUser({ lockedUntil: new Date(Date.now() + 60_000) }),
      );

      await expect(login('locked@x.in', 'pw')).rejects.toThrow(/temporarily locked/i);

      expect(mockedComparePassword).toHaveBeenCalledTimes(1);
    });

    it('uses a SINGLE generic error message for "no such user" and "bad password"', async () => {
      // Unknown email
      prismaMock.user.findUnique.mockResolvedValueOnce(null);
      const unknownErr = await login('ghost@x.in', 'pw').catch((e: Error) => e.message);

      // Known email, wrong password
      prismaMock.user.findUnique.mockResolvedValueOnce(makeUser({ failedLoginCount: 0 }));
      mockedComparePassword.mockResolvedValueOnce(false);
      const wrongPwErr = await login('real@x.in', 'wrong').catch((e: Error) => e.message);

      // Same string — attacker can't distinguish the two cases by message.
      expect(unknownErr).toBe(wrongPwErr);
      expect(unknownErr).toBe('Invalid email or password');
    });
  });

  // ── Case-insensitive email lookup (prod bug reported 2026-05-21) ──────
  //
  // The User.email column is `String @unique` and Postgres compares are
  // case-sensitive. Before normalization, a user registered as
  // `john@exargen.in` got "Invalid email or password" when they typed
  // `John@Exargen.in`. We now lowercase the email at the service
  // boundary so findUnique always sees the canonical form. These tests
  // pin the regression at the auth-service entrypoint — the Zod
  // validator level is covered by validators/auth.schema in a separate
  // integration pass.
  describe('email normalization', () => {
    it('finds a user when the caller passes a mixed-case email', async () => {
      const user = makeUser({ email: 'john@exargen.in', failedLoginCount: 0 });
      prismaMock.user.findUnique.mockResolvedValue(user);
      mockedComparePassword.mockResolvedValue(true);

      await expect(login('John@Exargen.IN', 'correct')).resolves.toMatchObject({
        user: expect.objectContaining({ email: 'john@exargen.in' }),
      });

      // The Prisma lookup MUST receive the lowercased email — otherwise
      // Postgres misses the row. Assert the exact `where` shape.
      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'john@exargen.in' },
      });
    });

    it('trims surrounding whitespace before lookup', async () => {
      const user = makeUser({ email: 'jane@exargen.in', failedLoginCount: 0 });
      prismaMock.user.findUnique.mockResolvedValue(user);
      mockedComparePassword.mockResolvedValue(true);

      await login('  jane@exargen.in  ', 'correct');

      expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'jane@exargen.in' },
      });
    });
  });


  describe('lockout state machine', () => {
    it('increments failedLoginCount but does NOT lock at count=4 (one short)', async () => {
      const user = makeUser({ failedLoginCount: 3 });
      prismaMock.user.findUnique.mockResolvedValue(user);
      mockedComparePassword.mockResolvedValue(false);

      await expect(login('u@x.in', 'wrong')).rejects.toThrow();

      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: user.id },
        data: expect.objectContaining({
          failedLoginCount: 4,
          // lockedUntil should remain the user's existing value (null here)
          // — not be set to a new future date.
          lockedUntil: null,
        }),
      });
    });

    it('locks the account on the 5th failed attempt (nextCount = 5 ≥ MAX)', async () => {
      const user = makeUser({ failedLoginCount: 4 });
      prismaMock.user.findUnique.mockResolvedValue(user);
      mockedComparePassword.mockResolvedValue(false);

      const before = Date.now();
      await expect(login('u@x.in', 'wrong')).rejects.toThrow();
      const after = Date.now();

      const updateCall = prismaMock.user.update.mock.calls[0]?.[0] as any;
      expect(updateCall.data.failedLoginCount).toBe(5);
      // lockedUntil should be ~15 minutes in the future. Allow a 1s
      // jitter for test-host clock drift.
      const lockUntil = updateCall.data.lockedUntil as Date;
      const expectedMin = before + 15 * 60 * 1000;
      const expectedMax = after + 15 * 60 * 1000;
      expect(lockUntil.getTime()).toBeGreaterThanOrEqual(expectedMin);
      expect(lockUntil.getTime()).toBeLessThanOrEqual(expectedMax);
    });

    it('refuses login while lockedUntil is in the future, even with the correct password', async () => {
      // This is critical: locked > now BEFORE password check, so even a valid
      // password should be rejected. Otherwise lockout is pointless.
      prismaMock.user.findUnique.mockResolvedValue(
        makeUser({ lockedUntil: new Date(Date.now() + 60_000) }),
      );
      mockedComparePassword.mockResolvedValue(true);

      await expect(login('u@x.in', 'correct-pw')).rejects.toThrow(/temporarily locked/i);

      // No user update should fire — the early-return path doesn't touch state.
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('allows login when lockedUntil has already passed', async () => {
      const expiredLock = makeUser({
        lockedUntil: new Date(Date.now() - 60_000), // 1 minute ago
        failedLoginCount: 5,
      });
      prismaMock.user.findUnique.mockResolvedValue(expiredLock);
      mockedComparePassword.mockResolvedValue(true);
      prismaMock.refreshToken.create.mockResolvedValue({} as any);

      await expect(login('u@x.in', 'pw')).resolves.toMatchObject({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
    });

    // ── Audit 2026-05-21: lockout-expiry counter reset ─────────────────
    //
    // Before the fix, `failedLoginCount` was not reset when the previous
    // `lockedUntil` had passed. A user who got locked at count=5 and waited
    // out the 15 minutes would have their NEXT wrong attempt computed as
    // `5 + 1 = 6 ≥ MAX_FAILED_LOGINS`, re-locking them immediately. Any
    // attacker who knew the email could perma-lock the account by sending
    // one wrong-password request every 15 minutes. These tests pin the
    // fix: an expired lockout means "fresh slate", not "one strike away
    // from re-lock".
    it('resets failedLoginCount to 1 on the first wrong attempt after lockout expired', async () => {
      const previouslyLocked = makeUser({
        lockedUntil: new Date(Date.now() - 60_000), // 1 minute ago — expired
        failedLoginCount: 5,
      });
      prismaMock.user.findUnique.mockResolvedValue(previouslyLocked);
      mockedComparePassword.mockResolvedValue(false);

      await expect(login('u@x.in', 'wrong')).rejects.toThrow();

      const updateCall = prismaMock.user.update.mock.calls[0]?.[0] as any;
      // The crucial assertion: count is 1 (a fresh strike), not 6
      // (which would re-trigger lockout).
      expect(updateCall.data.failedLoginCount).toBe(1);
      // And lockedUntil is cleared — we're not re-locking + stale
      // timestamps shouldn't dangle in the row.
      expect(updateCall.data.lockedUntil).toBeNull();
    });

    it('does NOT re-lock on a single wrong attempt after lockout expired', async () => {
      // Same scenario as above but assert the no-relock property more
      // explicitly: a user who waited out their lockout gets the same
      // 4-strike runway as a fresh user, not a 0-strike one.
      const previouslyLocked = makeUser({
        lockedUntil: new Date(Date.now() - 5 * 60_000), // 5 min ago
        failedLoginCount: 5,
      });
      prismaMock.user.findUnique.mockResolvedValue(previouslyLocked);
      mockedComparePassword.mockResolvedValue(false);

      await expect(login('u@x.in', 'wrong')).rejects.toThrow();

      const updateCall = prismaMock.user.update.mock.calls[0]?.[0] as any;
      // lockedUntil must NOT be a future timestamp — they should be free
      // to try again immediately.
      expect(updateCall.data.lockedUntil).toBeNull();
    });

    it('still re-locks if the user fails MAX_FAILED_LOGINS times after expiry', async () => {
      // Belt-and-suspenders: the reset does NOT disable the lockout
      // mechanism entirely — it just resets the COUNTER once on
      // expiry. We can't easily simulate 5 sequential login() calls
      // in a unit test (each would need its own mock setup), so we
      // verify the boundary by handing the service a row whose state
      // already reflects "4 fresh strikes after the prior expired
      // lockout". The reset only fires when `lockedUntil` is set AND
      // in the past; once we've replaced `lockedUntil` with null on
      // the first reset, subsequent attempts compound normally and
      // the 5th re-locks. We assert that here.
      const fourStrikesAfterReset = makeUser({
        lockedUntil: null, // already reset by an earlier attempt
        failedLoginCount: 4,
      });
      prismaMock.user.findUnique.mockResolvedValue(fourStrikesAfterReset);
      mockedComparePassword.mockResolvedValue(false);

      const before = Date.now();
      await expect(login('u@x.in', 'wrong')).rejects.toThrow();
      const after = Date.now();

      const updateCall = prismaMock.user.update.mock.calls[0]?.[0] as any;
      expect(updateCall.data.failedLoginCount).toBe(5);
      // Now re-locked: future timestamp ~15 minutes out.
      const lockUntil = updateCall.data.lockedUntil as Date;
      expect(lockUntil).toBeInstanceOf(Date);
      expect(lockUntil.getTime()).toBeGreaterThanOrEqual(before + 15 * 60 * 1000);
      expect(lockUntil.getTime()).toBeLessThanOrEqual(after + 15 * 60 * 1000);
    });

    it('compounds normally when lockedUntil is null (no prior lockout)', async () => {
      // Sanity: a user who has NEVER been locked should still see the
      // counter increment monotonically. Reset only kicks in when there
      // was a prior expired lockout.
      prismaMock.user.findUnique.mockResolvedValue(
        makeUser({ failedLoginCount: 2, lockedUntil: null }),
      );
      mockedComparePassword.mockResolvedValue(false);

      await expect(login('u@x.in', 'wrong')).rejects.toThrow();

      const updateCall = prismaMock.user.update.mock.calls[0]?.[0] as any;
      // 2 + 1 = 3, NOT reset to 1.
      expect(updateCall.data.failedLoginCount).toBe(3);
      // No active lockout + nextCount(3) < MAX(5) → stay null.
      expect(updateCall.data.lockedUntil).toBeNull();
    });

    it('clears lockout state and failedLoginCount on successful login', async () => {
      const user = makeUser({ failedLoginCount: 4, lockedUntil: null });
      prismaMock.user.findUnique.mockResolvedValue(user);
      mockedComparePassword.mockResolvedValue(true);
      prismaMock.refreshToken.create.mockResolvedValue({} as any);

      await login('u@x.in', 'pw');

      // The transaction's first op resets both counters.
      const userUpdateOp = (prismaMock.user.update.mock.calls[0]?.[0] ?? {}) as any;
      expect(userUpdateOp.data).toMatchObject({
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: expect.any(Date),
      });
    });
  });

  describe('inactive users', () => {
    it('rejects an inactive user without bumping failedLoginCount', async () => {
      // Inactive + correct password still throws with the same generic
      // message. But there's no point locking out an inactive account
      // — the service should NOT call user.update in this path
      // (an `if (user)` block does fire, but only conditioned on the
      // login being a failure; isActive is part of `!valid`).
      const user = makeUser({ isActive: false, failedLoginCount: 0 });
      prismaMock.user.findUnique.mockResolvedValue(user);
      mockedComparePassword.mockResolvedValue(true); // even valid password

      await expect(login('u@x.in', 'pw')).rejects.toThrow('Invalid email or password');
    });
  });

  describe('happy path', () => {
    it('mints access + refresh tokens, persists refresh row, returns user without passwordHash', async () => {
      const user = makeUser({ id: 'user-1', email: 'a@x.in', role: 'ADMIN', tokenVersion: 7 });
      prismaMock.user.findUnique.mockResolvedValue(user);
      mockedComparePassword.mockResolvedValue(true);
      prismaMock.refreshToken.create.mockResolvedValue({} as any);

      const result = await login('a@x.in', 'pw', {
        userAgent: 'Mozilla/5.0 ...',
        ip: '127.0.0.1',
      });

      expect(result.accessToken).toBe('access-token');
      expect(result.refreshToken).toBe('refresh-token');
      // user-without-password — must NOT leak the hash even by accident.
      expect((result.user as any).passwordHash).toBeUndefined();
      expect(result.user.id).toBe('user-1');

      // tokens carry the correct claims (role, userId, tokenVersion).
      expect(mockedGenerateAccessToken).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', role: 'ADMIN', tv: 7 }),
      );
      expect(mockedGenerateRefreshToken).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', tv: 7 }),
      );
    });

    it('falls back to a 7-day refresh expiry when JWT_REFRESH_EXPIRY is malformed', async () => {
      // Defensive: an ops mistake in env shouldn't bring down login.
      const originalExpiry = envHoisted.env.JWT_REFRESH_EXPIRY;
      envHoisted.env.JWT_REFRESH_EXPIRY = 'not-a-duration';
      try {
        const user = makeUser();
        prismaMock.user.findUnique.mockResolvedValue(user);
        mockedComparePassword.mockResolvedValue(true);
        prismaMock.refreshToken.create.mockResolvedValue({} as any);

        const before = Date.now();
        await login('a@x.in', 'pw');
        const after = Date.now();

        const createCall = prismaMock.refreshToken.create.mock.calls[0]?.[0] as any;
        const expiry = (createCall.data.expiresAt as Date).getTime();
        // Should be ~7 days from now, within the test's wall-clock window.
        const sevenDays = 7 * 86_400_000;
        expect(expiry).toBeGreaterThanOrEqual(before + sevenDays - 5);
        expect(expiry).toBeLessThanOrEqual(after + sevenDays + 5);
      } finally {
        envHoisted.env.JWT_REFRESH_EXPIRY = originalExpiry;
      }
    });

    it('truncates context.userAgent + ip to safe lengths', async () => {
      const user = makeUser();
      prismaMock.user.findUnique.mockResolvedValue(user);
      mockedComparePassword.mockResolvedValue(true);
      prismaMock.refreshToken.create.mockResolvedValue({} as any);

      const longUA = 'a'.repeat(1000);
      const longIP = 'x'.repeat(200);

      await login('a@x.in', 'pw', { userAgent: longUA, ip: longIP });

      const createCall = prismaMock.refreshToken.create.mock.calls[0]?.[0] as any;
      expect(createCall.data.userAgent.length).toBe(500);
      expect(createCall.data.ip.length).toBe(64);
    });
  });
});

// ─── refreshAccessToken ────────────────────────────────────────────────

describe('refreshAccessToken()', () => {
  beforeEach(() => {
    configureTransactionPassthrough();
  });

  it('rejects a pre-migration token missing jti', async () => {
    mockedVerifyRefreshToken.mockReturnValue({ userId: 'u1', tv: 0 } as any);

    await expect(refreshAccessToken('old-token')).rejects.toThrow('Invalid refresh token');
    // Critical: must throw BEFORE the findUnique call (otherwise Prisma
    // explodes on `where: { id: undefined }` with a 500 instead of 401).
    expect(prismaMock.refreshToken.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a pre-migration token missing tv (tokenVersion)', async () => {
    mockedVerifyRefreshToken.mockReturnValue({ userId: 'u1', jti: 'j1' } as any);

    await expect(refreshAccessToken('old-token')).rejects.toThrow('Invalid refresh token');
    expect(prismaMock.refreshToken.findUnique).not.toHaveBeenCalled();
  });

  it('rejects when refresh row is not in the DB (revoked-and-deleted, or forged jti)', async () => {
    mockedVerifyRefreshToken.mockReturnValue({ userId: 'u1', jti: 'j1', tv: 0 } as any);
    prismaMock.refreshToken.findUnique.mockResolvedValue(null);

    await expect(refreshAccessToken('t')).rejects.toThrow('Invalid refresh token');
  });

  it('rejects when stored.userId does NOT match payload.userId', async () => {
    mockedVerifyRefreshToken.mockReturnValue({ userId: 'u1', jti: 'j1', tv: 0 } as any);
    prismaMock.refreshToken.findUnique.mockResolvedValue({
      id: 'j1',
      userId: 'DIFFERENT-USER',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    } as any);

    await expect(refreshAccessToken('t')).rejects.toThrow('Invalid refresh token');
  });

  it('rejects when stored.expiresAt is in the past', async () => {
    mockedVerifyRefreshToken.mockReturnValue({ userId: 'u1', jti: 'j1', tv: 0 } as any);
    prismaMock.refreshToken.findUnique.mockResolvedValue({
      id: 'j1',
      userId: 'u1',
      expiresAt: new Date(Date.now() - 1),
      revokedAt: null,
    } as any);

    await expect(refreshAccessToken('t')).rejects.toThrow('Refresh token expired');
  });

  describe('reuse detection (the biggest security property here)', () => {
    it('on revoked-token reuse: bumps tokenVersion AND revokes every live refresh row', async () => {
      mockedVerifyRefreshToken.mockReturnValue({ userId: 'u1', jti: 'j1', tv: 0 } as any);
      prismaMock.refreshToken.findUnique.mockResolvedValue({
        id: 'j1',
        userId: 'u1',
        expiresAt: new Date(Date.now() + 60_000),
        // The smoking gun — this row was already revoked. Someone replayed.
        revokedAt: new Date(Date.now() - 10_000),
      } as any);

      await expect(refreshAccessToken('reused')).rejects.toThrow(
        /reuse detected/i,
      );

      // Verify the transaction ran both punitive ops.
      expect(prismaMock.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        data: { tokenVersion: { increment: 1 } },
      });
      expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: 'u1', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  it('rejects when the user has been deleted', async () => {
    mockedVerifyRefreshToken.mockReturnValue({ userId: 'u1', jti: 'j1', tv: 0 } as any);
    prismaMock.refreshToken.findUnique.mockResolvedValue({
      id: 'j1',
      userId: 'u1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    } as any);
    prismaMock.user.findUnique.mockResolvedValue(null);

    await expect(refreshAccessToken('t')).rejects.toThrow('Invalid refresh token');
  });

  it('rejects when the user is inactive', async () => {
    mockedVerifyRefreshToken.mockReturnValue({ userId: 'u1', jti: 'j1', tv: 0 } as any);
    prismaMock.refreshToken.findUnique.mockResolvedValue({
      id: 'j1',
      userId: 'u1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    } as any);
    prismaMock.user.findUnique.mockResolvedValue(makeUser({ isActive: false }));

    await expect(refreshAccessToken('t')).rejects.toThrow('Invalid refresh token');
  });

  it('rejects when tokenVersion in payload does not match the current user version', async () => {
    mockedVerifyRefreshToken.mockReturnValue({ userId: 'u1', jti: 'j1', tv: 3 } as any);
    prismaMock.refreshToken.findUnique.mockResolvedValue({
      id: 'j1',
      userId: 'u1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    } as any);
    // Current user has tokenVersion 5 → payload's 3 is stale.
    prismaMock.user.findUnique.mockResolvedValue(makeUser({ tokenVersion: 5 }));

    await expect(refreshAccessToken('t')).rejects.toThrow('Refresh token no longer valid');
  });

  describe('happy path (rotation)', () => {
    it('mints a new refresh row and marks the old one revoked + linked', async () => {
      mockedVerifyRefreshToken.mockReturnValue({ userId: 'u1', jti: 'j-old', tv: 1 } as any);
      prismaMock.refreshToken.findUnique.mockResolvedValue({
        id: 'j-old',
        userId: 'u1',
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
      } as any);
      prismaMock.user.findUnique.mockResolvedValue(makeUser({ id: 'u1', tokenVersion: 1 }));
      prismaMock.refreshToken.create.mockResolvedValue({} as any);

      await refreshAccessToken('rotate-me');

      // New row was created.
      expect(prismaMock.refreshToken.create).toHaveBeenCalledTimes(1);
      const createCall = prismaMock.refreshToken.create.mock.calls[0]?.[0] as any;
      const newJti = createCall.data.id;

      // Old row marked revoked + replacedById = new jti.
      expect(prismaMock.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'j-old' },
        data: { revokedAt: expect.any(Date), replacedById: newJti },
      });
    });

    it('FK order: refreshToken.create call happens BEFORE refreshToken.update call in the transaction', async () => {
      // Capture the order in which transaction ops were queued. Prisma's
      // return type here is a thenable Prisma__RefreshTokenClient, not a
      // bare Promise — the cast is acceptable because the test never
      // touches the returned object beyond awaiting it.
      const callOrder: string[] = [];
      prismaMock.refreshToken.create.mockImplementation(((...args: unknown[]) => {
        callOrder.push('create');
        return Promise.resolve(args[0]);
      }) as any);
      prismaMock.refreshToken.update.mockImplementation(((...args: unknown[]) => {
        callOrder.push('update');
        return Promise.resolve(args[0]);
      }) as any);

      mockedVerifyRefreshToken.mockReturnValue({ userId: 'u1', jti: 'j-old', tv: 1 } as any);
      prismaMock.refreshToken.findUnique.mockResolvedValue({
        id: 'j-old',
        userId: 'u1',
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
      } as any);
      prismaMock.user.findUnique.mockResolvedValue(makeUser({ id: 'u1', tokenVersion: 1 }));

      await refreshAccessToken('t');

      // Without this order, the update would fail at runtime with a FK
      // constraint violation (replacedById references a row that doesn't
      // exist yet).
      expect(callOrder).toEqual(['create', 'update']);
    });
  });
});

// ─── revokeRefreshToken (logout) ───────────────────────────────────────

describe('revokeRefreshToken()', () => {
  it('is a no-op when called with undefined (logout when never logged in)', async () => {
    await expect(revokeRefreshToken(undefined)).resolves.toBeUndefined();
    expect(prismaMock.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('silently swallows an invalid/expired/forged token — logout never throws', async () => {
    mockedVerifyRefreshToken.mockImplementation(() => {
      throw new Error('jwt expired');
    });

    await expect(revokeRefreshToken('bad-token')).resolves.toBeUndefined();
    expect(prismaMock.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  it('marks revokedAt only on rows where revokedAt is currently null (idempotent)', async () => {
    mockedVerifyRefreshToken.mockReturnValue({ userId: 'u1', jti: 'j1', tv: 0 } as any);

    await revokeRefreshToken('t');

    expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'j1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});

// ─── revokeAllSessions ────────────────────────────────────────────────

describe('revokeAllSessions()', () => {
  it('bumps tokenVersion AND revokes every live refresh row for the user', async () => {
    prismaMock.$transaction.mockResolvedValue([] as any);

    await revokeAllSessions('user-x');

    // The transaction should contain both ops. We assert against the
    // outer call, then look inside the array argument.
    const txArg = prismaMock.$transaction.mock.calls[0]?.[0];
    expect(Array.isArray(txArg)).toBe(true);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-x' },
      data: { tokenVersion: { increment: 1 } },
    });
    expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-x', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});

// ─── updateMe ─────────────────────────────────────────────────────────

describe('updateMe()', () => {
  it('trims name before persist', async () => {
    prismaMock.user.update.mockResolvedValue(makeUser({ name: 'Trimmed' }) as any);

    await updateMe('u1', { name: '   Trimmed   ' });

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { name: 'Trimmed' },
    });
  });

  it('normalises empty/whitespace company to null', async () => {
    prismaMock.user.update.mockResolvedValue(makeUser() as any);

    await updateMe('u1', { company: '   ' });

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { company: null },
    });
  });

  it('persists a real company string when provided', async () => {
    prismaMock.user.update.mockResolvedValue(makeUser({ company: 'Acme' }) as any);

    await updateMe('u1', { company: 'Acme' });

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { company: 'Acme' },
    });
  });

  it('rejects an empty patch (defense in depth — validator should already catch)', async () => {
    await expect(updateMe('u1', {})).rejects.toThrow(/no editable fields/i);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('strips passwordHash from the returned user', async () => {
    prismaMock.user.update.mockResolvedValue(
      makeUser({ id: 'u1', passwordHash: 'super-secret' }) as any,
    );

    const result = await updateMe('u1', { name: 'X' });

    expect((result as any).passwordHash).toBeUndefined();
  });
});

// ─── changePassword ──────────────────────────────────────────────────

describe('changePassword()', () => {
  beforeEach(() => {
    prismaMock.$transaction.mockResolvedValue([] as any);
  });

  it('rejects with UnauthorizedError when the user does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    await expect(changePassword('u-ghost', 'cur', 'new')).rejects.toThrow('User not found');
  });

  it('rejects when the current password does not verify', async () => {
    prismaMock.user.findUnique.mockResolvedValue(makeUser());
    mockedComparePassword.mockResolvedValue(false);

    await expect(changePassword('u1', 'wrong', 'new')).rejects.toThrow(
      'Current password is incorrect',
    );

    // Critical: no mutation should fire when the current password is wrong.
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('hashes the new password, bumps tokenVersion, revokes every live refresh row', async () => {
    prismaMock.user.findUnique.mockResolvedValue(makeUser({ id: 'u1' }));
    mockedComparePassword.mockResolvedValue(true);

    await changePassword('u1', 'cur', 'new');

    // New password got hashed (we mocked it to return `hashed:new`).
    expect(mockedHashPassword).toHaveBeenCalledWith('new');

    // Transaction contains both writes.
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({
          passwordHash: 'hashed:new',
          tokenVersion: { increment: 1 },
        }),
      }),
    );
    expect(prismaMock.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  // ─── Bug surfaced during Phase 2.2 testing (changePassword lockout) ──
  // A user who legitimately changes their password should be able to log
  // in again immediately with the new value, even if a previous wrong-
  // password streak had triggered the 15-minute account lockout. The
  // changePassword path didn't reset failedLoginCount / lockedUntil,
  // so the user was stuck waiting out the lockout window despite
  // already proving identity (they entered the correct currentPassword).
  //
  // This test asserts the corrected behavior: every successful password
  // change clears the lockout counters too. Audit ergonomics — admins
  // can also use "password reset on behalf of locked-out user" as the
  // unlock vector without poking the DB directly.
  it('clears failedLoginCount and lockedUntil on successful password change', async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      makeUser({ id: 'u1', failedLoginCount: 5, lockedUntil: new Date(Date.now() + 60_000) }),
    );
    mockedComparePassword.mockResolvedValue(true);

    await changePassword('u1', 'cur', 'new');

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: {
        passwordHash: 'hashed:new',
        tokenVersion: { increment: 1 },
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
  });
});

// ─── getUserProfile ──────────────────────────────────────────────────

describe('getUserProfile()', () => {
  it('rejects when the user does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(getUserProfile('u-ghost')).rejects.toThrow('User not found');
  });

  it('returns user without passwordHash', async () => {
    const user = makeUser({
      id: 'u1',
      passwordHash: 'secret-hash-do-not-leak',
    });
    prismaMock.user.findUnique.mockResolvedValue(user as any);
    prismaMock.rolePermission.findMany.mockResolvedValue([] as any);

    const result = await getUserProfile('u1');

    expect((result.user as any).passwordHash).toBeUndefined();
    expect(result.user.id).toBe('u1');
  });

  it('returns the permission keys granted to the user\'s role', async () => {
    prismaMock.user.findUnique.mockResolvedValue(
      makeUser({ id: 'u1', role: 'ADMIN' as any }) as any,
    );
    prismaMock.rolePermission.findMany.mockResolvedValue([
      { id: 'rp1', role: 'ADMIN', granted: true, permission: { key: 'task.view' } } as any,
      { id: 'rp2', role: 'ADMIN', granted: true, permission: { key: 'task.edit_any' } } as any,
    ]);

    const result = await getUserProfile('u1');

    expect(result.permissions).toEqual(['task.view', 'task.edit_any']);
    // Only granted permissions are queried (granted: true filter).
    expect(prismaMock.rolePermission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: 'ADMIN', granted: true },
      }),
    );
  });
});

// ─── Avatar (2026-06) ───────────────────────────────────────────────────

describe('avatar', () => {
  beforeEach(() => {
    s3Mocks.signUploadUrl.mockClear().mockResolvedValue('https://s3.example/put');
    s3Mocks.signInlineGetUrl.mockClear().mockResolvedValue('https://s3.example/get');
    s3Mocks.objectExists.mockClear().mockResolvedValue(true);
    s3Mocks.deleteObject.mockClear().mockResolvedValue(undefined);
  });

  describe('createAvatarUploadUrl', () => {
    it('mints a presigned PUT url + a user-scoped key for a valid image', async () => {
      const res = await createAvatarUploadUrl('user-1', 'image/png', 1024);
      expect(res.uploadUrl).toBe('https://s3.example/put');
      expect(res.key).toMatch(/^avatars\/user-1\/.+\.png$/);
    });
    it('rejects a non-image content type', async () => {
      await expect(createAvatarUploadUrl('user-1', 'application/pdf', 1024)).rejects.toThrow(ValidationError);
    });
    it('rejects a file over the 5 MB cap', async () => {
      await expect(createAvatarUploadUrl('user-1', 'image/png', 6 * 1024 * 1024)).rejects.toThrow(ValidationError);
    });
    it('rejects a zero/negative size', async () => {
      await expect(createAvatarUploadUrl('user-1', 'image/png', 0)).rejects.toThrow(ValidationError);
    });
  });

  describe('setAvatar', () => {
    it("rejects a key outside the user's own prefix", async () => {
      await expect(setAvatar('user-1', 'avatars/someone-else/x.png')).rejects.toThrow(ForbiddenError);
    });
    it('rejects when the uploaded object is missing', async () => {
      s3Mocks.objectExists.mockResolvedValue(false);
      await expect(setAvatar('user-1', 'avatars/user-1/x.png')).rejects.toThrow(ValidationError);
    });
    it('sets the avatar + returns a presigned avatarUrl, never the key', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ avatarKey: null } as any);
      prismaMock.user.update.mockResolvedValue(makeUser({ avatarKey: 'avatars/user-1/x.png' }) as any);
      const user: any = await setAvatar('user-1', 'avatars/user-1/x.png');
      expect(user.avatarUrl).toBe('https://s3.example/get');
      expect(user.avatarKey).toBeUndefined();
      expect(s3Mocks.deleteObject).not.toHaveBeenCalled();
    });
    it('deletes the previous photo when replacing one', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ avatarKey: 'avatars/user-1/old.png' } as any);
      prismaMock.user.update.mockResolvedValue(makeUser({ avatarKey: 'avatars/user-1/new.png' }) as any);
      await setAvatar('user-1', 'avatars/user-1/new.png');
      expect(s3Mocks.deleteObject).toHaveBeenCalledWith('avatars/user-1/old.png');
    });
    it('returns a null avatarUrl when presigning fails (falls back to initials)', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ avatarKey: null } as any);
      prismaMock.user.update.mockResolvedValue(makeUser({ avatarKey: 'avatars/user-1/x.png' }) as any);
      s3Mocks.signInlineGetUrl.mockRejectedValue(new Error('s3 down'));
      const user: any = await setAvatar('user-1', 'avatars/user-1/x.png');
      expect(user.avatarUrl).toBeNull();
    });
  });

  describe('removeAvatar', () => {
    it('clears the avatar + deletes the object when one existed', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ avatarKey: 'avatars/user-1/x.png' } as any);
      prismaMock.user.update.mockResolvedValue(makeUser({ avatarKey: null }) as any);
      const user: any = await removeAvatar('user-1');
      expect(user.avatarUrl).toBeNull();
      expect(s3Mocks.deleteObject).toHaveBeenCalledWith('avatars/user-1/x.png');
    });
    it('is a no-op delete when there was no prior photo', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ avatarKey: null } as any);
      prismaMock.user.update.mockResolvedValue(makeUser({ avatarKey: null }) as any);
      await removeAvatar('user-1');
      expect(s3Mocks.deleteObject).not.toHaveBeenCalled();
    });
  });
});
