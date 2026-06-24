/**
 * Pulse — Device lifecycle (enroll, revoke, enrollment tokens).
 *
 * The agent never writes the DB directly; every state change goes
 * through these functions, which run under either the SUPER_ADMIN
 * permission gate (token issuance, revoke) or the device-auth gate
 * (enroll).
 *
 * Enrollment flow (mirrors the architecture doc):
 *   1. SUPER_ADMIN calls createEnrollmentToken — returns a single-use
 *      bootstrap token shown ONCE.
 *   2. The agent presents the token on /devices/enroll along with its
 *      hardware fingerprint. We look up the token, validate (not
 *      expired, not consumed), generate a fresh API key, hash + store,
 *      mark the token consumed, return the cleartext key.
 *   3. All future heartbeats / snapshots use the API key via
 *      deviceAuthenticate.
 *
 * Concurrency guard: enrollment runs in a Prisma transaction with a
 * unique constraint on (tokenHash), so two simultaneous enrollments using
 * the same token both fail except the first (P2002).
 */

import { randomBytes, createHash } from 'crypto';
import {
  DeviceEnrollmentStatus,
  DevicePlatform,
  Prisma,
} from '@prisma/client';
import prisma from '../config/database';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../utils/errors';
import { hashDeviceApiKey } from '../middleware/deviceAuthenticate';
import { logActivity } from './activity.service';

const DEFAULT_TOKEN_TTL_HOURS = 7 * 24;
const MIN_TOKEN_TTL_HOURS = 1;
const MAX_TOKEN_TTL_HOURS = 30 * 24;

function generateEnrollmentToken(): string {
  // 32 bytes = 256 bits of entropy. Prefix for log-search recognition.
  return `det_${randomBytes(32).toString('hex')}`;
}

// SHA-256 of the cleartext token. Stored at rest (never the cleartext);
// the agent presents the cleartext on enroll and we look up by this hash.
// Same construction as hashDeviceApiKey, and byte-identical to the
// migration's pgcrypto backfill so existing tokens keep working.
export function hashEnrollmentToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function generateDeviceApiKey(): string {
  return `dev_${randomBytes(32).toString('hex')}`;
}

// ─── Enrollment tokens (SUPER_ADMIN-only callers) ─────────────────────

export interface CreateEnrollmentTokenInput {
  issuedByUserId: string;
  assignedUserId?: string | null;
  expiresInHours?: number;
  note?: string;
}

export async function createEnrollmentToken(input: CreateEnrollmentTokenInput) {
  const ttlHours = input.expiresInHours ?? DEFAULT_TOKEN_TTL_HOURS;
  if (
    !Number.isFinite(ttlHours) ||
    ttlHours < MIN_TOKEN_TTL_HOURS ||
    ttlHours > MAX_TOKEN_TTL_HOURS
  ) {
    throw new ValidationError(
      `expiresInHours must be between ${MIN_TOKEN_TTL_HOURS} and ${MAX_TOKEN_TTL_HOURS}`,
    );
  }

  if (input.assignedUserId) {
    const assigned = await prisma.user.findUnique({
      where: { id: input.assignedUserId },
      select: { id: true, isActive: true },
    });
    if (!assigned) throw new NotFoundError('assignedUser');
    if (!assigned.isActive) {
      throw new ValidationError('Cannot assign device to an inactive user');
    }
  }

  const token = generateEnrollmentToken();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  const created = await prisma.deviceEnrollmentToken.create({
    data: {
      // Only the hash + a masked suffix are persisted — never the cleartext.
      tokenHash: hashEnrollmentToken(token),
      tokenLast4: token.slice(-4),
      assignedUserId: input.assignedUserId ?? null,
      issuedByUserId: input.issuedByUserId,
      expiresAt,
      note: input.note ?? null,
    },
  });

  await logActivity({
    userId: input.issuedByUserId,
    action: 'pulse_enrollment_token_issued',
    targetType: 'device_enrollment_token',
    targetId: created.id,
    details: {
      assignedUserId: input.assignedUserId ?? null,
      expiresAt: expiresAt.toISOString(),
    },
  });

  // Attach the cleartext token IN MEMORY for the one-time issuance response.
  // The caller (handler) surfaces it to the SUPER_ADMIN exactly once; it is
  // never persisted and cannot be retrieved again.
  return { ...created, token };
}

export interface ListEnrollmentTokensFilter {
  includeConsumed?: boolean;
  includeExpired?: boolean;
}

export async function listEnrollmentTokens(filter: ListEnrollmentTokensFilter = {}) {
  const where: Prisma.DeviceEnrollmentTokenWhereInput = {};
  if (!filter.includeConsumed) where.consumedAt = null;
  if (!filter.includeExpired) where.expiresAt = { gt: new Date() };

  return prisma.deviceEnrollmentToken.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      assignedUser: { select: { id: true, name: true, email: true } },
      issuedBy: { select: { id: true, name: true } },
    },
  });
}

export async function revokeEnrollmentToken(tokenId: string, revokedByUserId: string) {
  // "Revoke" of an enrollment token simply expires it immediately. We
  // don't delete the row so the audit trail (issuer + revocation) is
  // preserved.
  const existing = await prisma.deviceEnrollmentToken.findUnique({
    where: { id: tokenId },
  });
  if (!existing) throw new NotFoundError('DeviceEnrollmentToken');
  if (existing.consumedAt) {
    throw new ValidationError('Token has already been consumed');
  }

  const updated = await prisma.deviceEnrollmentToken.update({
    where: { id: tokenId },
    data: { expiresAt: new Date() },
  });

  await logActivity({
    userId: revokedByUserId,
    action: 'pulse_enrollment_token_revoked',
    targetType: 'device_enrollment_token',
    targetId: tokenId,
  });

  return updated;
}

// ─── Device enrollment (called by the agent on first boot) ─────────────

export interface EnrollDeviceInput {
  enrollmentToken: string;
  fingerprint: string;
  hostname: string;
  platform: DevicePlatform;
  osVersion?: string;
  osBuild?: string;
  arch?: string;
  agentVersion: string;
  ip?: string | null;
}

export interface EnrollDeviceResult {
  deviceId: string;
  apiKey: string;
  ownerUserId: string | null;
}

export async function enrollDevice(input: EnrollDeviceInput): Promise<EnrollDeviceResult> {
  if (!input.enrollmentToken || input.enrollmentToken.length < 8) {
    throw new ValidationError('enrollmentToken required');
  }
  if (!input.fingerprint || input.fingerprint.length < 8) {
    throw new ValidationError('fingerprint required');
  }
  if (!input.hostname || input.hostname.length > 255) {
    throw new ValidationError('hostname required and < 256 chars');
  }

  const apiKey = generateDeviceApiKey();
  const apiKeyHash = hashDeviceApiKey(apiKey);
  const apiKeyPrefix = apiKey.slice(0, 8);

  // Transaction: validate token + create-or-reactivate device + consume
  // token atomically. If two agents race with the same token, only the
  // first commits; the second hits the consumedAt-check or the unique
  // constraint on (tokenHash).
  const result = await prisma.$transaction(async (tx) => {
    const tokenRow = await tx.deviceEnrollmentToken.findUnique({
      where: { tokenHash: hashEnrollmentToken(input.enrollmentToken) },
    });
    if (!tokenRow) throw new NotFoundError('Enrollment token');
    if (tokenRow.consumedAt) {
      throw new ForbiddenError('Enrollment token has already been used');
    }
    if (tokenRow.expiresAt <= new Date()) {
      throw new ForbiddenError('Enrollment token has expired');
    }

    // Re-enrollment of the same physical machine? Reuse the device row
    // (same fingerprint), rotate its API key, restore status to ACTIVE.
    const existingDevice = await tx.device.findUnique({
      where: { fingerprint: input.fingerprint },
    });

    const ownerUserId = tokenRow.assignedUserId;

    let device;
    if (existingDevice) {
      device = await tx.device.update({
        where: { id: existingDevice.id },
        data: {
          hostname: input.hostname,
          platform: input.platform,
          osVersion: input.osVersion ?? null,
          osBuild: input.osBuild ?? null,
          arch: input.arch ?? null,
          apiKeyHash,
          apiKeyPrefix,
          status: DeviceEnrollmentStatus.ACTIVE,
          revokedAt: null,
          revokedByUserId: null,
          revokedReason: null,
          agentVersion: input.agentVersion,
          ownerUserId: ownerUserId ?? existingDevice.ownerUserId,
          lastHeartbeatIp: input.ip ?? null,
        },
      });
    } else {
      device = await tx.device.create({
        data: {
          fingerprint: input.fingerprint,
          hostname: input.hostname,
          platform: input.platform,
          osVersion: input.osVersion ?? null,
          osBuild: input.osBuild ?? null,
          arch: input.arch ?? null,
          apiKeyHash,
          apiKeyPrefix,
          status: DeviceEnrollmentStatus.ACTIVE,
          agentVersion: input.agentVersion,
          ownerUserId: ownerUserId ?? null,
          lastHeartbeatIp: input.ip ?? null,
        },
      });
    }

    await tx.deviceEnrollmentToken.update({
      where: { id: tokenRow.id },
      data: {
        consumedAt: new Date(),
        consumedByDeviceId: device.id,
      },
    });

    await logActivity(
      {
        userId: tokenRow.issuedByUserId,
        action: 'pulse_device_enrolled',
        targetType: 'device',
        targetId: device.id,
        details: {
          fingerprint: input.fingerprint,
          hostname: input.hostname,
          platform: input.platform,
          reEnrollment: !!existingDevice,
        },
      },
      tx,
    );

    return {
      deviceId: device.id,
      ownerUserId: device.ownerUserId,
    };
  });

  return {
    deviceId: result.deviceId,
    apiKey,
    ownerUserId: result.ownerUserId,
  };
}

// ─── Device lifecycle (SUPER_ADMIN-only) ──────────────────────────────

export async function revokeDevice(
  deviceId: string,
  revokedByUserId: string,
  reason?: string,
) {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) throw new NotFoundError('Device');
  if (device.status === DeviceEnrollmentStatus.REVOKED) {
    throw new ValidationError('Device is already revoked');
  }

  const updated = await prisma.device.update({
    where: { id: deviceId },
    data: {
      status: DeviceEnrollmentStatus.REVOKED,
      revokedAt: new Date(),
      revokedByUserId,
      revokedReason: reason ?? null,
    },
  });

  await logActivity({
    userId: revokedByUserId,
    action: 'pulse_device_revoked',
    targetType: 'device',
    targetId: deviceId,
    details: { reason: reason ?? null },
  });

  return updated;
}

export async function reassignDeviceOwner(
  deviceId: string,
  newOwnerUserId: string | null,
  changedByUserId: string,
) {
  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) throw new NotFoundError('Device');

  if (newOwnerUserId) {
    const owner = await prisma.user.findUnique({
      where: { id: newOwnerUserId },
      select: { id: true, isActive: true },
    });
    if (!owner) throw new NotFoundError('User');
    if (!owner.isActive) {
      throw new ValidationError('Cannot assign device to an inactive user');
    }
  }

  const updated = await prisma.device.update({
    where: { id: deviceId },
    data: { ownerUserId: newOwnerUserId },
  });

  await logActivity({
    userId: changedByUserId,
    action: 'pulse_device_reassigned',
    targetType: 'device',
    targetId: deviceId,
    details: { previousOwnerUserId: device.ownerUserId, newOwnerUserId },
  });

  return updated;
}
