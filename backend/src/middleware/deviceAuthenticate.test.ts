/**
 * Pulse — deviceAuthenticate middleware tests (2026-05-28).
 *
 * Tests the privilege gate the entire Pulse agent surface depends on.
 * Critical invariants pinned:
 *   - Refuses missing / wrong-scheme / malformed credential (401)
 *   - Refuses unknown API key (401, never leaks "user exists" vs "key wrong")
 *   - Refuses devices whose status != ACTIVE
 *   - Sets req.device on success
 *   - Hashes the cleartext before lookup (cleartext never sent to DB)
 */

import './../test/prismaMock';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import {
  deviceAuthenticate,
  deviceAuthenticateAllowRevoked,
  hashDeviceApiKey,
} from './deviceAuthenticate';

const VALID_KEY = 'dev_' + 'a'.repeat(64);

function makeReq(overrides: { auth?: string } = {}) {
  return {
    headers: {
      authorization: overrides.auth,
    },
  } as any;
}

function makeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status: vi.fn(function (this: any, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn(function (this: any, body: any) {
      this.body = body;
      return this;
    }),
  };
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('deviceAuthenticate — input validation', () => {
  it('401 when no Authorization header', async () => {
    const next = vi.fn();
    const res = makeRes();
    await deviceAuthenticate(makeReq(), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(prismaMock.device.findUnique).not.toHaveBeenCalled();
  });

  it('401 when Authorization uses Bearer scheme (wrong for device)', async () => {
    const next = vi.fn();
    const res = makeRes();
    await deviceAuthenticate(makeReq({ auth: `Bearer ${VALID_KEY}` }), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(prismaMock.device.findUnique).not.toHaveBeenCalled();
  });

  it('401 when key is too short (< 12 chars)', async () => {
    const next = vi.fn();
    const res = makeRes();
    await deviceAuthenticate(makeReq({ auth: 'Device dev_short' }), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(prismaMock.device.findUnique).not.toHaveBeenCalled();
  });

  it('401 when key is unreasonably long (> 200 chars)', async () => {
    const next = vi.fn();
    const res = makeRes();
    await deviceAuthenticate(
      makeReq({ auth: 'Device ' + 'x'.repeat(201) }),
      res,
      next,
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(prismaMock.device.findUnique).not.toHaveBeenCalled();
  });
});

describe('deviceAuthenticate — credential check', () => {
  it('401 when DB returns no device for the key hash', async () => {
    prismaMock.device.findUnique.mockResolvedValue(null);
    const next = vi.fn();
    const res = makeRes();
    await deviceAuthenticate(makeReq({ auth: `Device ${VALID_KEY}` }), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('looks up by hashed key — cleartext is NEVER sent to the DB', async () => {
    prismaMock.device.findUnique.mockResolvedValue(null);
    const next = vi.fn();
    const res = makeRes();
    await deviceAuthenticate(makeReq({ auth: `Device ${VALID_KEY}` }), res, next);

    const lookupArgs = prismaMock.device.findUnique.mock.calls[0]?.[0] as any;
    expect(lookupArgs.where.apiKeyHash).toBe(hashDeviceApiKey(VALID_KEY));
    expect(lookupArgs.where.apiKeyHash).not.toBe(VALID_KEY);
  });
});

describe('deviceAuthenticate — status enforcement', () => {
  function makeActiveDevice() {
    return {
      id: 'device-1',
      apiKeyHash: hashDeviceApiKey(VALID_KEY),
      status: 'ACTIVE',
    } as any;
  }

  it('401 when device.status === REVOKED', async () => {
    prismaMock.device.findUnique.mockResolvedValue({
      ...makeActiveDevice(),
      status: 'REVOKED',
    });
    const next = vi.fn();
    const res = makeRes();
    await deviceAuthenticate(makeReq({ auth: `Device ${VALID_KEY}` }), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('401 when device.status === INACTIVE', async () => {
    prismaMock.device.findUnique.mockResolvedValue({
      ...makeActiveDevice(),
      status: 'INACTIVE',
    });
    const next = vi.fn();
    const res = makeRes();
    await deviceAuthenticate(makeReq({ auth: `Device ${VALID_KEY}` }), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('401 when device.status === PENDING_ENROLLMENT', async () => {
    prismaMock.device.findUnique.mockResolvedValue({
      ...makeActiveDevice(),
      status: 'PENDING_ENROLLMENT',
    });
    const next = vi.fn();
    const res = makeRes();
    await deviceAuthenticate(makeReq({ auth: `Device ${VALID_KEY}` }), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('deviceAuthenticate — success path', () => {
  it('sets req.device and calls next() when key is valid + device is ACTIVE', async () => {
    const device = {
      id: 'device-1',
      apiKeyHash: hashDeviceApiKey(VALID_KEY),
      status: 'ACTIVE',
    };
    prismaMock.device.findUnique.mockResolvedValue(device as any);

    const req = makeReq({ auth: `Device ${VALID_KEY}` });
    const next = vi.fn();
    const res = makeRes();
    await deviceAuthenticate(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.device).toBe(device);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('hashDeviceApiKey', () => {
  it('produces deterministic sha-256 output (same input → same hash)', () => {
    const h1 = hashDeviceApiKey('dev_abc');
    const h2 = hashDeviceApiKey('dev_abc');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // sha-256 hex
  });

  it('different inputs produce different hashes', () => {
    expect(hashDeviceApiKey('dev_a')).not.toBe(hashDeviceApiKey('dev_b'));
  });
});

// ─── Wave 9 — deviceAuthenticateAllowRevoked (remote kill switch) ─

describe('deviceAuthenticateAllowRevoked', () => {
  it('lets a REVOKED device through so the handler can respond {revoked: true}', async () => {
    const device = {
      id: 'device-1',
      apiKeyHash: hashDeviceApiKey(VALID_KEY),
      status: 'REVOKED',
    };
    prismaMock.device.findUnique.mockResolvedValue(device as any);

    const req = makeReq({ auth: `Device ${VALID_KEY}` });
    const next = vi.fn();
    const res = makeRes();
    await deviceAuthenticateAllowRevoked(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.device.status).toBe('REVOKED');
    expect(res.status).not.toHaveBeenCalled();
  });

  it('lets an ACTIVE device through (same as strict variant)', async () => {
    const device = {
      id: 'device-1',
      apiKeyHash: hashDeviceApiKey(VALID_KEY),
      status: 'ACTIVE',
    };
    prismaMock.device.findUnique.mockResolvedValue(device as any);

    const next = vi.fn();
    const res = makeRes();
    await deviceAuthenticateAllowRevoked(makeReq({ auth: `Device ${VALID_KEY}` }), res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('lets an INACTIVE device through', async () => {
    const device = {
      id: 'device-1',
      apiKeyHash: hashDeviceApiKey(VALID_KEY),
      status: 'INACTIVE',
    };
    prismaMock.device.findUnique.mockResolvedValue(device as any);

    const next = vi.fn();
    const res = makeRes();
    await deviceAuthenticateAllowRevoked(makeReq({ auth: `Device ${VALID_KEY}` }), res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('REJECTS a PENDING_ENROLLMENT device — that means the bootstrap never finished', async () => {
    const device = {
      id: 'device-1',
      apiKeyHash: hashDeviceApiKey(VALID_KEY),
      status: 'PENDING_ENROLLMENT',
    };
    prismaMock.device.findUnique.mockResolvedValue(device as any);

    const next = vi.fn();
    const res = makeRes();
    await deviceAuthenticateAllowRevoked(makeReq({ auth: `Device ${VALID_KEY}` }), res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('still 401s on unknown key (status carve-out is for known devices only)', async () => {
    prismaMock.device.findUnique.mockResolvedValue(null);

    const next = vi.fn();
    const res = makeRes();
    await deviceAuthenticateAllowRevoked(makeReq({ auth: `Device ${VALID_KEY}` }), res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
