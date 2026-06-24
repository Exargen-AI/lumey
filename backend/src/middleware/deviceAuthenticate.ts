/**
 * Pulse — Windows agent auth middleware (2026-05-28).
 *
 * Validates an `Authorization: Device <api-key>` header against the
 * `devices.apiKeyHash` column. Cleartext is never stored — only the
 * sha-256 hash — so the comparison is implicitly constant-time at the
 * DB level (exact hash equality).
 *
 * Sets `req.device` on success. Refuses any device whose `status` is
 * not `ACTIVE` (REVOKED, INACTIVE, PENDING_ENROLLMENT all return 401).
 *
 * Why a separate middleware (not authenticate + role check):
 *   - The Windows agent does NOT have a user JWT. It carries a long-
 *     lived per-device API key issued at enrollment.
 *   - Mixing the two in `authenticate` would force every route to know
 *     which is which. A dedicated middleware keeps the privilege
 *     boundaries cleanly separated:
 *       authenticate       → human/AGENT user routes (req.user)
 *       deviceAuthenticate → Pulse agent routes      (req.device)
 *
 * Routes that need EITHER (e.g., a future "current device for this
 * user" endpoint) compose them at the route layer; we deliberately do
 * not provide a union-auth middleware that would blur the boundary.
 */

import type { Request, Response, NextFunction } from 'express';
import { createHash, timingSafeEqual } from 'crypto';
import prisma from '../config/database';

const SCHEME = 'Device';

/**
 * Hash the cleartext API key as it's stored in the DB. Exposed so the
 * enrollment service can write the same hash it'll later be queried by.
 */
export function hashDeviceApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey, 'utf8').digest('hex');
}

/**
 * Length-checked constant-time string compare. Used as defence in depth
 * even though the DB lookup is by hash equality (an attacker who can
 * guess a valid hash has already bypassed the secret). Length mismatch
 * short-circuits to avoid a length-side-channel.
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function unauthorized(res: Response, message: string): void {
  res
    .status(401)
    .json({ success: false, error: { code: 'UNAUTHORIZED', message } });
}

export async function deviceAuthenticate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith(`${SCHEME} `)) {
      unauthorized(res, 'No device credentials');
      return;
    }

    const apiKey = authHeader.slice(SCHEME.length + 1).trim();
    // Cleartext key shape: `dev_<hex>` (set by the enrollment service).
    // Reject obviously malformed inputs before hitting the DB. The 12-
    // character minimum is well below the issued length but generous
    // enough to absorb future format changes.
    if (apiKey.length < 12 || apiKey.length > 200) {
      unauthorized(res, 'Malformed device credential');
      return;
    }

    const apiKeyHash = hashDeviceApiKey(apiKey);

    const device = await prisma.device.findUnique({ where: { apiKeyHash } });
    if (!device) {
      unauthorized(res, 'Invalid device credential');
      return;
    }

    // Defence in depth — the DB lookup is already exact match, but a
    // length-checked compare guards against a future change that moves
    // the lookup to a different column.
    if (!constantTimeEquals(device.apiKeyHash, apiKeyHash)) {
      unauthorized(res, 'Invalid device credential');
      return;
    }

    if (device.status !== 'ACTIVE') {
      unauthorized(res, 'Device is not active');
      return;
    }

    req.device = device;
    next();
  } catch {
    unauthorized(res, 'Device auth failed');
  }
}

/**
 * Wave 9 — remote kill-switch variant of `deviceAuthenticate`.
 *
 * Mounted ONLY on the heartbeat route. Lets a revoked device's
 * heartbeat through so the handler can respond `{revoked: true}`
 * instead of a generic 401. The agent reads that flag and exits
 * cleanly, breaking the "loop forever on 401s after revocation"
 * loop we used to have.
 *
 * Snapshot + enrollment endpoints still use the strict
 * `deviceAuthenticate` — we don't want a revoked agent uploading
 * fresh telemetry that pollutes scores.
 *
 * Security: we still verify the API key matches a real device row
 * (rejected when the key is unknown / truncated). The only relaxed
 * check is on `status` — revoked is treated as "authenticated, but
 * tell the agent to exit."
 */
export async function deviceAuthenticateAllowRevoked(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith(`${SCHEME} `)) {
      unauthorized(res, 'No device credentials');
      return;
    }
    const apiKey = authHeader.slice(SCHEME.length + 1).trim();
    if (apiKey.length < 12 || apiKey.length > 200) {
      unauthorized(res, 'Malformed device credential');
      return;
    }
    const apiKeyHash = hashDeviceApiKey(apiKey);
    const device = await prisma.device.findUnique({ where: { apiKeyHash } });
    if (!device) {
      unauthorized(res, 'Invalid device credential');
      return;
    }
    if (!constantTimeEquals(device.apiKeyHash, apiKeyHash)) {
      unauthorized(res, 'Invalid device credential');
      return;
    }
    // Allow REVOKED / INACTIVE through — the handler decides what to
    // do. We refuse only PENDING_ENROLLMENT, which means the device
    // never finished bootstrap (probably a key swap mid-enroll).
    if (device.status === 'PENDING_ENROLLMENT') {
      unauthorized(res, 'Device enrollment incomplete');
      return;
    }
    req.device = device;
    next();
  } catch {
    unauthorized(res, 'Device auth failed');
  }
}
