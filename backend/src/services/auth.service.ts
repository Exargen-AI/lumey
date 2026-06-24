import { UserRole } from '@prisma/client';
import prisma from '../config/database';
import { hashPassword, comparePassword } from '../utils/password';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/jwt';
import { UnauthorizedError, ValidationError, ForbiddenError } from '../utils/errors';
import { env } from '../config/env';
import { normalizeEmail } from '../utils/email';
import { randomUUID } from 'crypto';
import { securityLogger } from '../lib/logger';
import { buildAvatarS3Key, signInlineGetUrl, signUploadUrl, objectExists, deleteObject } from '../integrations/s3';

// Avatar upload constraints. A fixed image-type allowlist + size cap keeps
// the presigned-PUT surface safe (the signature pins both, so S3 rejects a
// mismatching upload).
const AVATAR_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const AVATAR_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/**
 * Replace a user's private `avatarKey` with a fresh presigned `avatarUrl`
 * the client can render. The key never leaves the server; the URL is
 * short-lived and re-minted on each auth response.
 */
async function withAvatarUrl<T extends { avatarKey?: string | null }>(user: T) {
  const { avatarKey, ...rest } = user as any;
  let avatarUrl: string | null = null;
  if (avatarKey) {
    // signInlineGetUrl asserts S3 is configured and may fail transiently —
    // either way the client just falls back to initials, so swallow it.
    try {
      avatarUrl = await signInlineGetUrl(avatarKey);
    } catch {
      avatarUrl = null;
    }
  }
  return { ...rest, avatarUrl } as Omit<T, 'avatarKey'> & { avatarUrl: string | null };
}

// 5 fails / 15min triggers a 15min lockout. Reset on success or on lockout
// expiry. Server-side floor — augments the per-IP authLimiter middleware.
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

// A real bcrypt hash, computed lazily so login() against an unknown email
// runs a comparePassword that takes the same wall time as a real one.
// Without this, an attacker enumerates valid emails by response timing
// (QA finding #5). The cached value is the hash of an unguessable string —
// no one ever logs in with this password, so a chance match is impossible.
let dummyHashPromise: Promise<string> | null = null;
function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword(`__timing_safety_${randomUUID()}__`);
  }
  return dummyHashPromise;
}

function refreshExpiryDate(): Date {
  // Mirror env.JWT_REFRESH_EXPIRY ('7d' default) without bringing in a parser.
  // Slightly conservative: if env is malformed, default to 7 days.
  const raw = env.JWT_REFRESH_EXPIRY || '7d';
  const m = String(raw).match(/^(\d+)\s*([smhd])$/i);
  const ms = m
    ? parseInt(m[1], 10) * { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2].toLowerCase() as 's' | 'm' | 'h' | 'd']
    : 7 * 86_400_000;
  return new Date(Date.now() + ms);
}

export async function login(
  email: string,
  password: string,
  context: { userAgent?: string; ip?: string } = {},
) {
  // Defense-in-depth: the loginSchema validator already lowercases the email
  // before the handler sees it, but programmatic callers (seeds, tests,
  // future internal RPC) may bypass the route stack. Normalize here too so
  // `prisma.user.findUnique({ email })` always sees the canonical form and
  // the case-sensitive findUnique never misses an otherwise-valid user.
  // Reported 2026-05-21 as the "Invalid email or password" prod bug.
  const normalized = normalizeEmail(email);
  const user = await prisma.user.findUnique({ where: { email: normalized } });

  // Account lockout short-circuits BEFORE bcrypt to keep the lockout window
  // cheap to enforce. We still run a dummy compare so timing matches the
  // unknown-email branch.
  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    await comparePassword(password, await getDummyHash());
    throw new UnauthorizedError('Account temporarily locked. Try again later.');
  }

  // Branch parity: always run comparePassword so a missing user takes ~the
  // same wall time as a present one. The result is ignored on the missing
  // path; we throw the same generic message so an attacker can't distinguish
  // "no such email" from "bad password".
  let valid = false;
  if (user) {
    valid = await comparePassword(password, user.passwordHash);
  } else {
    // Burn the same bcrypt cost as a real comparison — DON'T short-circuit.
    await comparePassword(password, await getDummyHash());
  }

  if (!user || !user.isActive || !valid) {
    if (user) {
      // Track failures so the next 4 fast attempts trip the lockout. We don't
      // create rows for unknown emails — that would be its own enumeration
      // surface and there's nothing to lock out.
      //
      // Audit 2026-05-21: if a previous lockout already expired
      // (`lockedUntil` set but in the past — we passed the `lockedUntil > now`
      // guard above WITHOUT entering it), treat this attempt as a fresh
      // failure. Without this reset, `nextCount = 5 + 1 = 6 ≥ MAX` would
      // re-lock the user on the very first wrong password after expiry,
      // compounding 15 minutes onto every subsequent attempt — effectively
      // a perma-lock that an attacker who knows the email could maintain
      // for $0 by sending one wrong attempt every 15 minutes. We also null
      // out `lockedUntil` when we're not actively re-locking so stale
      // timestamps don't dangle in the row.
      const lockoutExpired = user.lockedUntil !== null && user.lockedUntil <= new Date();
      const baseCount = lockoutExpired ? 0 : user.failedLoginCount;
      const nextCount = baseCount + 1;
      const nowLocking = nextCount >= MAX_FAILED_LOGINS;
      const lockedUntil = nowLocking
        ? new Date(Date.now() + LOCKOUT_WINDOW_MS)
        : null;
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: nextCount, lockedUntil },
      });
      // 2026-06-01 hardening — security event logging. Previously a
      // credential-stuffing run left ZERO trace. Now every failed
      // attempt (and the lockout it eventually trips) is on the
      // security channel for alerting. We log the userId, not the
      // password; email is low-sensitivity and aids investigation.
      securityLogger.warn(
        { event: 'login_failed', userId: user.id, email: user.email, ip: context.ip, attempt: nextCount },
        'login failed',
      );
      if (nowLocking) {
        securityLogger.warn(
          { event: 'account_locked', userId: user.id, email: user.email, ip: context.ip, lockedUntil },
          'account locked after repeated failures',
        );
      }
    } else {
      // Unknown email — log the probe (no userId to record).
      securityLogger.warn({ event: 'login_failed', email, ip: context.ip, reason: 'unknown_or_inactive' }, 'login failed (unknown/inactive)');
    }
    throw new UnauthorizedError('Invalid email or password');
  }

  // Successful login: clear any pending lockout state, mint a refresh row.
  const jti = randomUUID();
  const expiresAt = refreshExpiryDate();

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    }),
    prisma.refreshToken.create({
      data: {
        id: jti,
        userId: user.id,
        expiresAt,
        userAgent: context.userAgent?.slice(0, 500),
        ip: context.ip?.slice(0, 64),
      },
    }),
  ]);

  const accessToken = generateAccessToken({
    userId: user.id,
    role: user.role,
    tv: user.tokenVersion,
    ut: user.userType === 'AGENT' ? 'agent' : 'human',
  });
  const refreshToken = generateRefreshToken({ userId: user.id, jti, tv: user.tokenVersion });

  securityLogger.info(
    { event: 'login_success', userId: user.id, email: user.email, ip: context.ip, role: user.role },
    'login success',
  );

  const { passwordHash: _, ...userWithoutPassword } = user;
  return { accessToken, refreshToken, user: await withAvatarUrl(userWithoutPassword) };
}

export async function refreshAccessToken(
  refreshTokenValue: string,
  context: { userAgent?: string; ip?: string } = {},
) {
  // Parse-then-lookup. JWT verification catches expired/forged tokens; the
  // DB lookup catches revoked-but-still-fresh ones (rotation/logout/reuse).
  const payload = verifyRefreshToken(refreshTokenValue);

  // Defensive check: reject pre-migration tokens that lack jti/tv. Without
  // this, `findUnique({ id: undefined })` blows up Prisma with a 500.
  if (!payload.jti || typeof payload.tv !== 'number') {
    throw new UnauthorizedError('Invalid refresh token');
  }

  const stored = await prisma.refreshToken.findUnique({ where: { id: payload.jti } });
  if (!stored || stored.userId !== payload.userId) {
    throw new UnauthorizedError('Invalid refresh token');
  }

  if (stored.expiresAt <= new Date()) {
    throw new UnauthorizedError('Refresh token expired');
  }

  // Reuse detection: if a revoked token is presented, the entire user-side
  // chain is treated as compromised. Bump tokenVersion (kills every issued
  // access token) and revoke every still-live refresh row for the user.
  if (stored.revokedAt !== null) {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: stored.userId },
        data: { tokenVersion: { increment: 1 } },
      }),
      prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    // 2026-06-01 hardening — the single highest-signal "you've been
    // breached" event in the system. A revoked refresh token being
    // replayed means the token was stolen; we nuke the whole chain
    // above and now also fire a CRITICAL-severity security log so it
    // can page someone. Previously this happened in total silence.
    securityLogger.error(
      { event: 'token_reuse_detected', userId: stored.userId, jti: payload.jti, ip: context.ip },
      'refresh token reuse detected — revoked all sessions',
    );
    throw new UnauthorizedError('Refresh token reuse detected. Please log in again.');
  }

  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user || !user.isActive) {
    throw new UnauthorizedError('Invalid refresh token');
  }

  // tokenVersion mismatch means the user logged out everywhere or changed
  // their password since this token was issued.
  if (payload.tv !== user.tokenVersion) {
    throw new UnauthorizedError('Refresh token no longer valid');
  }

  // Rotation: mint a new row and chain it to the old one. Done in a single
  // transaction so a partial write never leaves the user without a session.
  const newJti = randomUUID();
  const expiresAt = refreshExpiryDate();

  // FK order matters: replacedById on the old row points at the new row, so
  // the new row must exist first.
  await prisma.$transaction([
    prisma.refreshToken.create({
      data: {
        id: newJti,
        userId: user.id,
        expiresAt,
        userAgent: context.userAgent?.slice(0, 500),
        ip: context.ip?.slice(0, 64),
      },
    }),
    prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), replacedById: newJti },
    }),
  ]);

  const accessToken = generateAccessToken({
    userId: user.id,
    role: user.role,
    tv: user.tokenVersion,
    ut: user.userType === 'AGENT' ? 'agent' : 'human',
  });
  const refreshToken = generateRefreshToken({ userId: user.id, jti: newJti, tv: user.tokenVersion });
  return { accessToken, refreshToken };
}

/** Revoke a single refresh token (typical logout). Idempotent. */
export async function revokeRefreshToken(refreshTokenValue: string | undefined) {
  if (!refreshTokenValue) return;
  try {
    const payload = verifyRefreshToken(refreshTokenValue);
    await prisma.refreshToken.updateMany({
      where: { id: payload.jti, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  } catch {
    // Token already invalid — nothing to revoke. Silent return is fine; logout
    // should never error from the user's perspective.
  }
}

/** Revoke every refresh token for a user AND bump tokenVersion to kill access tokens. */
export async function revokeAllSessions(userId: string) {
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    }),
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}

/**
 * Patch the authenticated user's own profile. Narrower than the admin
 * `PUT /users/:id` path:
 *   - Only `name` and `company` are accepted; everything else is admin-only.
 *   - `name` is trimmed; an empty trim is rejected by the validator.
 *   - `company` accepts null to clear; an empty string is normalised to null
 *     so a future search index can rely on null === "not set" rather than
 *     also having to special-case ''.
 * Returns the trimmed user shape (no passwordHash) so the caller can sync
 * its auth store without a second /auth/me round-trip.
 */
export async function updateMe(
  userId: string,
  patch: { name?: string; company?: string | null },
) {
  const data: { name?: string; company?: string | null } = {};
  if (patch.name !== undefined) data.name = patch.name.trim();
  if (patch.company !== undefined) {
    const trimmed = (patch.company ?? '').toString().trim();
    data.company = trimmed === '' ? null : trimmed;
  }

  // Defense in depth: the validator already enforces at-least-one-field,
  // but this catches a future caller that bypasses the schema.
  if (Object.keys(data).length === 0) {
    throw new UnauthorizedError('No editable fields provided');
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data,
  });

  const { passwordHash: _, ...userWithoutPassword } = updated;
  return withAvatarUrl(userWithoutPassword);
}

/**
 * Mint a presigned PUT URL the client uses to upload an avatar straight to
 * S3 (bytes never touch the API). The returned `key` is echoed back to
 * `setAvatar` after the upload completes.
 */
export async function createAvatarUploadUrl(userId: string, contentType: string, sizeBytes: number) {
  const ext = AVATAR_EXT[contentType];
  if (!ext) throw new ValidationError('Avatar must be a PNG, JPEG, or WebP image');
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > AVATAR_MAX_BYTES) {
    throw new ValidationError('Avatar must be 5 MB or smaller');
  }
  const key = buildAvatarS3Key(userId, randomUUID(), ext);
  const uploadUrl = await signUploadUrl({ key, contentType, sizeBytes });
  return { uploadUrl, key };
}

/** Confirm an uploaded avatar and point the user at it. */
export async function setAvatar(userId: string, key: string) {
  // Never trust a client-supplied key — it must be one we minted for THIS
  // user, so a caller can't claim someone else's (or an arbitrary) object.
  if (!key.startsWith(`avatars/${userId}/`)) {
    throw new ForbiddenError('That avatar does not belong to you');
  }
  if (!(await objectExists(key))) {
    throw new ValidationError('Upload not found — please try again');
  }

  const before = await prisma.user.findUnique({ where: { id: userId }, select: { avatarKey: true } });
  const updated = await prisma.user.update({ where: { id: userId }, data: { avatarKey: key } });
  // Best-effort cleanup of the previous photo so we don't accrue orphans.
  if (before?.avatarKey && before.avatarKey !== key) {
    deleteObject(before.avatarKey).catch(() => { /* non-blocking */ });
  }
  const { passwordHash: _, ...rest } = updated;
  return withAvatarUrl(rest);
}

/** Remove the user's avatar (revert to initials). */
export async function removeAvatar(userId: string) {
  const before = await prisma.user.findUnique({ where: { id: userId }, select: { avatarKey: true } });
  const updated = await prisma.user.update({ where: { id: userId }, data: { avatarKey: null } });
  if (before?.avatarKey) deleteObject(before.avatarKey).catch(() => { /* non-blocking */ });
  const { passwordHash: _, ...rest } = updated;
  return withAvatarUrl(rest);
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  const valid = await comparePassword(currentPassword, user.passwordHash);
  if (!valid) {
    throw new UnauthorizedError('Current password is incorrect');
  }

  const newHash = await hashPassword(newPassword);
  // tokenVersion bump kills every still-valid access token; the matching
  // refreshToken updateMany kills the refresh side. After this returns, the
  // user has zero live sessions — the caller is expected to issue a fresh
  // access token in the response if they want to keep the active tab logged
  // in (see auth.handler.changePasswordHandler).
  //
  // Clearing failedLoginCount + lockedUntil here is the unlock vector for
  // users who walked through the wrong-password lockout but legitimately
  // know the current password (verified above). Without this, a locked-
  // out user who successfully changes their password is STILL locked
  // out of new logins for the rest of the 15-minute window — they
  // already proved identity, the lockout was for the OLD password, the
  // new password compose should reset the counter. Bug surfaced + fixed
  // in Phase 2.2.
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: newHash,
        tokenVersion: { increment: 1 },
        failedLoginCount: 0,
        lockedUntil: null,
      },
    }),
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}

export async function getUserProfile(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      projectMemberships: {
        include: {
          project: { select: { id: true, name: true, slug: true } },
        },
      },
    },
  });

  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  const rolePermissions = await prisma.rolePermission.findMany({
    where: { role: user.role, granted: true },
    include: { permission: { select: { key: true } } },
  });

  const permissions = rolePermissions.map((rp) => rp.permission.key);

  const { passwordHash: _, ...userWithoutPassword } = user;

  return { user: await withAvatarUrl(userWithoutPassword), permissions };
}
