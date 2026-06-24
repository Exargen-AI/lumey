/**
 * Pulse — device.service tests (2026-05-28).
 *
 * Covers the privilege-and-lifecycle boundary:
 *   - Enrollment token issuance + TTL validation + SUPER_ADMIN audit log
 *   - Enrollment exchange: token expiry, single-use, re-enrollment of
 *     the same fingerprint reuses the device row
 *   - Revoke flips status, sets revokedBy/revokedAt, writes activity log
 *   - Reassign refuses inactive owners
 */

import './../test/prismaMock';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../utils/errors';

const { logActivitySpy } = vi.hoisted(() => ({
  logActivitySpy: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./activity.service', () => ({
  __esModule: true,
  logActivity: logActivitySpy,
}));

import {
  createEnrollmentToken,
  enrollDevice,
  revokeDevice,
  reassignDeviceOwner,
  hashEnrollmentToken,
} from './device.service';

const ADMIN_ID = 'admin-1';
const USER_ID = 'user-1';
const DEVICE_ID = 'device-1';

beforeEach(() => {
  vi.clearAllMocks();
  // Default transaction implementation — services that use $transaction
  // get the mock client as the tx argument.
  (prismaMock.$transaction as any).mockImplementation(async (fn: any) => fn(prismaMock));
});

// ─── createEnrollmentToken ────────────────────────────────────────────

describe('createEnrollmentToken — TTL validation', () => {
  it('rejects expiresInHours < 1', async () => {
    await expect(
      createEnrollmentToken({ issuedByUserId: ADMIN_ID, expiresInHours: 0 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects expiresInHours > 720 (30 days)', async () => {
    await expect(
      createEnrollmentToken({ issuedByUserId: ADMIN_ID, expiresInHours: 721 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('defaults to 7 days when expiresInHours is omitted', async () => {
    prismaMock.deviceEnrollmentToken.create.mockResolvedValue({
      id: 'tok-1',
      tokenHash: 'hash_xxx',
      tokenLast4: 'xxxx',
      assignedUserId: null,
      issuedByUserId: ADMIN_ID,
      expiresAt: new Date(),
      consumedAt: null,
      consumedByDeviceId: null,
      note: null,
      createdAt: new Date(),
    } as any);

    await createEnrollmentToken({ issuedByUserId: ADMIN_ID });
    const args = prismaMock.deviceEnrollmentToken.create.mock.calls[0]?.[0] as any;
    const ttl = (args.data.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60);
    expect(ttl).toBeGreaterThan(167); // ~7 days, allow ~1h drift
    expect(ttl).toBeLessThan(169);
  });
});

describe('createEnrollmentToken — assigned-user validation', () => {
  it('throws NotFoundError when assignedUserId does not exist', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(
      createEnrollmentToken({ issuedByUserId: ADMIN_ID, assignedUserId: 'ghost' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects assignment to an inactive user', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      id: USER_ID,
      isActive: false,
    } as any);
    await expect(
      createEnrollmentToken({ issuedByUserId: ADMIN_ID, assignedUserId: USER_ID }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('createEnrollmentToken — audit', () => {
  it('writes a pulse_enrollment_token_issued activity', async () => {
    prismaMock.deviceEnrollmentToken.create.mockResolvedValue({
      id: 'tok-1',
      tokenHash: 'hash_xxx',
      tokenLast4: 'xxxx',
      assignedUserId: null,
      issuedByUserId: ADMIN_ID,
      expiresAt: new Date(),
      consumedAt: null,
      consumedByDeviceId: null,
      note: null,
      createdAt: new Date(),
    } as any);

    await createEnrollmentToken({ issuedByUserId: ADMIN_ID });

    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: ADMIN_ID,
        action: 'pulse_enrollment_token_issued',
        targetType: 'device_enrollment_token',
      }),
    );
  });
});

// ─── enrollDevice ─────────────────────────────────────────────────────

const FINGERPRINT = 'a'.repeat(64);
const HOSTNAME = 'LAPTOP-XYZ';

function validEnrollInput() {
  return {
    enrollmentToken: 'det_' + 'a'.repeat(64),
    fingerprint: FINGERPRINT,
    hostname: HOSTNAME,
    platform: 'WINDOWS' as const,
    agentVersion: '0.1.0',
  };
}

describe('enrollDevice — input validation', () => {
  it('rejects missing token', async () => {
    await expect(
      enrollDevice({ ...validEnrollInput(), enrollmentToken: '' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects missing fingerprint', async () => {
    await expect(
      enrollDevice({ ...validEnrollInput(), fingerprint: 'a' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects empty hostname', async () => {
    await expect(
      enrollDevice({ ...validEnrollInput(), hostname: '' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('enrollDevice — token lifecycle', () => {
  it('refuses unknown token (404)', async () => {
    prismaMock.deviceEnrollmentToken.findUnique.mockResolvedValue(null);
    await expect(enrollDevice(validEnrollInput())).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses already-consumed token (403)', async () => {
    prismaMock.deviceEnrollmentToken.findUnique.mockResolvedValue({
      id: 'tok-1',
      tokenHash: 'hash_xxx',
      tokenLast4: 'xxxx',
      issuedByUserId: ADMIN_ID,
      assignedUserId: null,
      consumedAt: new Date(),
      expiresAt: new Date(Date.now() + 1_000_000),
    } as any);
    await expect(enrollDevice(validEnrollInput())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses expired token (403)', async () => {
    prismaMock.deviceEnrollmentToken.findUnique.mockResolvedValue({
      id: 'tok-1',
      tokenHash: 'hash_xxx',
      tokenLast4: 'xxxx',
      issuedByUserId: ADMIN_ID,
      assignedUserId: null,
      consumedAt: null,
      expiresAt: new Date(Date.now() - 1_000),
    } as any);
    await expect(enrollDevice(validEnrollInput())).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('enrollDevice — create vs re-enroll', () => {
  function validTokenRow(overrides: Partial<Record<string, unknown>> = {}) {
    return {
      id: 'tok-1',
      tokenHash: 'hash_xxx',
      tokenLast4: 'xxxx',
      issuedByUserId: ADMIN_ID,
      assignedUserId: USER_ID,
      consumedAt: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      ...overrides,
    } as any;
  }

  it('creates a new Device row when fingerprint is unknown', async () => {
    prismaMock.deviceEnrollmentToken.findUnique.mockResolvedValue(validTokenRow());
    prismaMock.device.findUnique.mockResolvedValue(null);
    prismaMock.device.create.mockResolvedValue({
      id: DEVICE_ID,
      fingerprint: FINGERPRINT,
      ownerUserId: USER_ID,
    } as any);
    prismaMock.deviceEnrollmentToken.update.mockResolvedValue({} as any);

    const result = await enrollDevice(validEnrollInput());

    expect(prismaMock.device.create).toHaveBeenCalled();
    expect(prismaMock.device.update).not.toHaveBeenCalled();
    expect(result.deviceId).toBe(DEVICE_ID);
    expect(result.apiKey).toMatch(/^dev_/);
    expect(result.ownerUserId).toBe(USER_ID);
  });

  it('reuses the same Device row when fingerprint is already known (re-enroll)', async () => {
    prismaMock.deviceEnrollmentToken.findUnique.mockResolvedValue(validTokenRow());
    prismaMock.device.findUnique.mockResolvedValue({
      id: DEVICE_ID,
      fingerprint: FINGERPRINT,
      ownerUserId: USER_ID,
    } as any);
    prismaMock.device.update.mockResolvedValue({
      id: DEVICE_ID,
      fingerprint: FINGERPRINT,
      ownerUserId: USER_ID,
    } as any);
    prismaMock.deviceEnrollmentToken.update.mockResolvedValue({} as any);

    const result = await enrollDevice(validEnrollInput());

    expect(prismaMock.device.create).not.toHaveBeenCalled();
    expect(prismaMock.device.update).toHaveBeenCalled();
    expect(result.deviceId).toBe(DEVICE_ID);
  });

  it('marks the token consumed and links to the new device', async () => {
    prismaMock.deviceEnrollmentToken.findUnique.mockResolvedValue(validTokenRow());
    prismaMock.device.findUnique.mockResolvedValue(null);
    prismaMock.device.create.mockResolvedValue({
      id: DEVICE_ID,
      fingerprint: FINGERPRINT,
      ownerUserId: USER_ID,
    } as any);
    prismaMock.deviceEnrollmentToken.update.mockResolvedValue({} as any);

    await enrollDevice(validEnrollInput());

    const tokenUpdateArgs = prismaMock.deviceEnrollmentToken.update.mock.calls[0]?.[0] as any;
    expect(tokenUpdateArgs.data.consumedByDeviceId).toBe(DEVICE_ID);
    expect(tokenUpdateArgs.data.consumedAt).toBeInstanceOf(Date);
  });
});

// ─── enrollment-token hashing at rest (2026-06-01 hardening M7) ────────

describe('enrollment-token hashing (at rest)', () => {
  it('persists only the SHA-256 hash + last-4 (never the cleartext) and returns the cleartext once', async () => {
    // The returned row's contents don't matter here — we assert on the
    // create CALL ARGS (what gets persisted) and on the service-attached
    // cleartext (`result.token`), which the service generates itself.
    prismaMock.deviceEnrollmentToken.create.mockResolvedValue({
      id: 'tok-1',
      tokenHash: 'ignored',
      tokenLast4: 'xxxx',
      assignedUserId: null,
      issuedByUserId: ADMIN_ID,
      expiresAt: new Date(),
      consumedAt: null,
      consumedByDeviceId: null,
      note: null,
      createdAt: new Date(),
    } as any);

    const result = (await createEnrollmentToken({ issuedByUserId: ADMIN_ID })) as any;

    const createArgs = prismaMock.deviceEnrollmentToken.create.mock.calls[0]?.[0] as any;
    // The cleartext is NEVER part of the persisted row.
    expect(createArgs.data.token).toBeUndefined();
    // We persist a 64-hex sha256 + a 4-char display suffix.
    expect(createArgs.data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(createArgs.data.tokenLast4).toHaveLength(4);
    // The one-time cleartext we return hashes to the stored hash and ends
    // with the stored suffix — proving the round-trip the agent relies on.
    expect(result.token).toMatch(/^det_[a-f0-9]{64}$/);
    expect(hashEnrollmentToken(result.token)).toBe(createArgs.data.tokenHash);
    expect(result.token.slice(-4)).toBe(createArgs.data.tokenLast4);
  });

  it('enrollDevice looks the token up by its hash, not the cleartext', async () => {
    prismaMock.deviceEnrollmentToken.findUnique.mockResolvedValue(null);
    const input = validEnrollInput();

    await expect(enrollDevice(input)).rejects.toBeInstanceOf(NotFoundError);

    const where = (prismaMock.deviceEnrollmentToken.findUnique.mock.calls[0]?.[0] as any).where;
    expect(where.tokenHash).toBe(hashEnrollmentToken(input.enrollmentToken));
    expect(where.token).toBeUndefined();
  });
});

// ─── revokeDevice ─────────────────────────────────────────────────────

describe('revokeDevice', () => {
  it('throws NotFoundError when device id is unknown', async () => {
    prismaMock.device.findUnique.mockResolvedValue(null);
    await expect(revokeDevice('ghost', ADMIN_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses to revoke an already-revoked device', async () => {
    prismaMock.device.findUnique.mockResolvedValue({
      id: DEVICE_ID,
      status: 'REVOKED',
    } as any);
    await expect(revokeDevice(DEVICE_ID, ADMIN_ID)).rejects.toBeInstanceOf(ValidationError);
  });

  it('sets status=REVOKED + revokedBy + revokedAt and logs the action', async () => {
    prismaMock.device.findUnique.mockResolvedValue({
      id: DEVICE_ID,
      status: 'ACTIVE',
    } as any);
    prismaMock.device.update.mockResolvedValue({
      id: DEVICE_ID,
      status: 'REVOKED',
    } as any);

    await revokeDevice(DEVICE_ID, ADMIN_ID, 'employee left');

    const updateArgs = prismaMock.device.update.mock.calls[0]?.[0] as any;
    expect(updateArgs.data.status).toBe('REVOKED');
    expect(updateArgs.data.revokedByUserId).toBe(ADMIN_ID);
    expect(updateArgs.data.revokedAt).toBeInstanceOf(Date);
    expect(updateArgs.data.revokedReason).toBe('employee left');

    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: ADMIN_ID,
        action: 'pulse_device_revoked',
        targetId: DEVICE_ID,
      }),
    );
  });
});

// ─── reassignDeviceOwner ──────────────────────────────────────────────

describe('reassignDeviceOwner', () => {
  it('refuses inactive new owner', async () => {
    prismaMock.device.findUnique.mockResolvedValue({
      id: DEVICE_ID,
      ownerUserId: null,
    } as any);
    prismaMock.user.findUnique.mockResolvedValue({
      id: USER_ID,
      isActive: false,
    } as any);
    await expect(
      reassignDeviceOwner(DEVICE_ID, USER_ID, ADMIN_ID),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('accepts null (unassign) without checking a user row', async () => {
    prismaMock.device.findUnique.mockResolvedValue({
      id: DEVICE_ID,
      ownerUserId: USER_ID,
    } as any);
    prismaMock.device.update.mockResolvedValue({
      id: DEVICE_ID,
      ownerUserId: null,
    } as any);

    await reassignDeviceOwner(DEVICE_ID, null, ADMIN_ID);

    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.device.update).toHaveBeenCalledWith({
      where: { id: DEVICE_ID },
      data: { ownerUserId: null },
    });
  });
});
