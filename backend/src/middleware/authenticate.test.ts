/**
 * Phase 2.3 of the baseline hardening plan — critical-tier authz spine.
 *
 * `authenticate` is the single chokepoint that turns an incoming HTTP
 * request into an authenticated `req.user`. Every route except /auth/*
 * and /health flows through it. Target coverage: 100% across the
 * board.
 *
 * Security properties asserted:
 *
 *   1. **Strict Bearer parsing.** Missing header, missing scheme,
 *      malformed prefix all 401 with no DB call.
 *
 *   2. **JWT verification gates the DB lookup.** Forged/expired/garbage
 *      tokens never reach Prisma — the `verifyAccessToken` throw is
 *      caught and turned into 401.
 *
 *   3. **`tokenVersion` invalidation.** Tokens issued before a
 *      `changePassword` or `revokeAllSessions` are rejected even
 *      though their JWT signature is still valid. Without this,
 *      "logout everywhere" is a lie.
 *
 *   4. **Inactive-user lockout.** A deactivated user with a valid
 *      token must not get past the gate.
 *
 *   5. **Missing `tv` claim.** Pre-migration tokens that have a
 *      valid signature but no `tv` claim are rejected (otherwise
 *      a numeric vs. undefined comparison would silently succeed).
 *
 *   6. **No information leak via error messages.** 401 message is
 *      generic — never echoes the userId, the role, or which guard
 *      failed.
 */

import './../test/prismaMock';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import { makeUser } from '../test/factories';

vi.mock('../utils/jwt', () => ({
  __esModule: true,
  verifyAccessToken: vi.fn(),
}));

import { authenticate } from './authenticate';
import { verifyAccessToken } from '../utils/jwt';

const mockedVerifyAccessToken = vi.mocked(verifyAccessToken);

function buildContext(headers: Record<string, string | undefined> = {}) {
  const req: any = { headers, user: undefined };
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const res = { status } as any;
  const next = vi.fn();
  return { req, res, next, status, json };
}

beforeEach(() => {
  mockedVerifyAccessToken.mockReset();
});

describe('authenticate middleware', () => {
  describe('header parsing', () => {
    it('returns 401 when no Authorization header is present', async () => {
      const { req, res, next, status, json } = buildContext({});

      await authenticate(req, res, next);

      expect(status).toHaveBeenCalledWith(401);
      expect(json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'No token provided' },
      });
      expect(next).not.toHaveBeenCalled();
      // Most importantly: no DB call. Don't waste a Prisma round-trip on
      // an obviously-anonymous request.
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
      // And no JWT verify either — short-circuit before touching the lib.
      expect(mockedVerifyAccessToken).not.toHaveBeenCalled();
    });

    it('returns 401 when Authorization header has no Bearer prefix', async () => {
      const { req, res, next, status } = buildContext({ authorization: 'Basic abc123' });

      await authenticate(req, res, next);

      expect(status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
      expect(mockedVerifyAccessToken).not.toHaveBeenCalled();
    });

    it('returns 401 on the exact "Bearer" string with no token after it', async () => {
      // authHeader.startsWith('Bearer ') requires the trailing space, so
      // "Bearer" alone is rejected at the prefix check.
      const { req, res, next, status } = buildContext({ authorization: 'Bearer' });

      await authenticate(req, res, next);

      expect(status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('JWT verification', () => {
    it('returns 401 when verifyAccessToken throws (forged / expired / garbage)', async () => {
      mockedVerifyAccessToken.mockImplementation(() => {
        throw new Error('jwt malformed');
      });
      const { req, res, next, status, json } = buildContext({ authorization: 'Bearer junk' });

      await authenticate(req, res, next);

      expect(status).toHaveBeenCalledWith(401);
      expect(json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid token' },
      });
      // Forged tokens must never touch the DB.
      expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it('catches a thrown findUnique (e.g. payload.userId === undefined → Prisma explodes)', async () => {
      // Defensive: a pre-migration JWT might lack `userId`. Prisma's
      // findUnique({ id: undefined }) throws — we want a clean 401, not
      // a 500.
      mockedVerifyAccessToken.mockReturnValue({} as any);
      prismaMock.user.findUnique.mockRejectedValue(new Error('invalid where'));
      const { req, res, next, status, json } = buildContext({ authorization: 'Bearer t' });

      await authenticate(req, res, next);

      expect(status).toHaveBeenCalledWith(401);
      expect(json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid token' },
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('user lookup', () => {
    it('returns 401 when the user is not in the DB (deleted after token issue)', async () => {
      mockedVerifyAccessToken.mockReturnValue({ userId: 'u-deleted', tv: 0 } as any);
      prismaMock.user.findUnique.mockResolvedValue(null);
      const { req, res, next, status, json } = buildContext({ authorization: 'Bearer t' });

      await authenticate(req, res, next);

      expect(status).toHaveBeenCalledWith(401);
      expect(json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid or inactive user' },
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when the user is inactive (admin deactivated them mid-session)', async () => {
      mockedVerifyAccessToken.mockReturnValue({ userId: 'u1', tv: 0 } as any);
      prismaMock.user.findUnique.mockResolvedValue(
        makeUser({ id: 'u1', isActive: false, tokenVersion: 0 }),
      );
      const { req, res, next, status } = buildContext({ authorization: 'Bearer t' });

      await authenticate(req, res, next);

      expect(status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('tokenVersion guard', () => {
    it('returns 401 when payload.tv is missing (pre-migration token)', async () => {
      mockedVerifyAccessToken.mockReturnValue({ userId: 'u1' } as any); // no tv
      prismaMock.user.findUnique.mockResolvedValue(makeUser({ id: 'u1', tokenVersion: 0 }));
      const { req, res, next, status, json } = buildContext({ authorization: 'Bearer t' });

      await authenticate(req, res, next);

      expect(status).toHaveBeenCalledWith(401);
      expect(json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Session no longer valid' },
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when payload.tv is not a number (string coercion guard)', async () => {
      // A future bug that issues tokens with `tv: "0"` (string) must not
      // accidentally pass the !== check via type coercion.
      mockedVerifyAccessToken.mockReturnValue({ userId: 'u1', tv: '0' } as any);
      prismaMock.user.findUnique.mockResolvedValue(makeUser({ id: 'u1', tokenVersion: 0 }));
      const { req, res, next, status } = buildContext({ authorization: 'Bearer t' });

      await authenticate(req, res, next);

      expect(status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });

    it('returns 401 when payload.tv does NOT match user.tokenVersion (revoked / password-changed)', async () => {
      mockedVerifyAccessToken.mockReturnValue({ userId: 'u1', tv: 3 } as any);
      prismaMock.user.findUnique.mockResolvedValue(makeUser({ id: 'u1', tokenVersion: 5 }));
      const { req, res, next, status } = buildContext({ authorization: 'Bearer t' });

      await authenticate(req, res, next);

      expect(status).toHaveBeenCalledWith(401);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('happy path', () => {
    it('populates req.user and calls next() when everything checks out', async () => {
      const user = makeUser({ id: 'u1', tokenVersion: 7, role: 'ADMIN' as any });
      mockedVerifyAccessToken.mockReturnValue({ userId: 'u1', tv: 7 } as any);
      prismaMock.user.findUnique.mockResolvedValue(user);
      const { req, res, next, status } = buildContext({ authorization: 'Bearer valid-token' });

      await authenticate(req, res, next);

      expect(req.user).toEqual(user);
      expect(next).toHaveBeenCalledOnce();
      expect(status).not.toHaveBeenCalled();
    });

    it('passes the token (everything after "Bearer ") to verifyAccessToken', async () => {
      const user = makeUser({ id: 'u1', tokenVersion: 0 });
      mockedVerifyAccessToken.mockReturnValue({ userId: 'u1', tv: 0 } as any);
      prismaMock.user.findUnique.mockResolvedValue(user);
      const { req, res, next } = buildContext({ authorization: 'Bearer specific-jwt-here' });

      await authenticate(req, res, next);

      expect(mockedVerifyAccessToken).toHaveBeenCalledWith('specific-jwt-here');
    });
  });

  describe('information disclosure', () => {
    it('does not echo the userId or role in any 401 response', async () => {
      // Sanity sweep — a regression that helpfully logs "User u-123 is locked"
      // to the response body would let an attacker confirm an account exists
      // by trying many tokens.
      mockedVerifyAccessToken.mockReturnValue({ userId: 'admin-user-123', tv: 0 } as any);
      prismaMock.user.findUnique.mockResolvedValue(
        makeUser({ id: 'admin-user-123', isActive: false, tokenVersion: 0, role: 'SUPER_ADMIN' as any }),
      );
      const { req, res, next, json } = buildContext({ authorization: 'Bearer t' });

      await authenticate(req, res, next);

      const body = json.mock.calls[0]?.[0] as any;
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain('admin-user-123');
      expect(serialized).not.toContain('SUPER_ADMIN');
    });
  });
});
