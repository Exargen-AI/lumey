import jwt from 'jsonwebtoken';
import { env } from '../config/env';

interface AccessTokenPayload {
  userId: string;
  role: string;
  // Bumped on logout-everywhere / password-change / role-change. authenticate
  // middleware refuses any access token whose `tv` doesn't match the row.
  tv: number;
  // Orthogonal axis to `role`. 'human' | 'agent'. The few policies that
  // distinguish humans from autonomous agents (e.g., the Done-transition
  // gate) read this from req.user without a DB hit. Defaults to 'human' if
  // missing for backward-compat with tokens issued before this change —
  // those expire in ≤15 minutes anyway.
  ut?: 'human' | 'agent';
}

interface RefreshTokenPayload {
  userId: string;
  // jti = the row id in `refresh_tokens`. Lets us mark a single token revoked
  // without invalidating the whole chain, and detect reuse.
  jti: string;
  tv: number;
}

// 2026-06-01 hardening — pin the signing algorithm on BOTH sign and
// verify. We use symmetric HS256. jsonwebtoken v9 already rejects
// `alg:none`, but without an explicit `algorithms` allowlist on verify,
// introducing any asymmetric key later would open the classic RS/HS
// confusion attack (signing an HS256 token with the public key as the
// HMAC secret). Pinning now makes that impossible by construction.
const JWT_ALG: jwt.Algorithm = 'HS256';

export function generateAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    algorithm: JWT_ALG,
    expiresIn: env.JWT_ACCESS_EXPIRY as string | number,
  } as jwt.SignOptions);
}

export function generateRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    algorithm: JWT_ALG,
    expiresIn: env.JWT_REFRESH_EXPIRY as string | number,
  } as jwt.SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload & jwt.JwtPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: [JWT_ALG] }) as AccessTokenPayload & jwt.JwtPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload & jwt.JwtPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET, { algorithms: [JWT_ALG] }) as RefreshTokenPayload & jwt.JwtPayload;
}
