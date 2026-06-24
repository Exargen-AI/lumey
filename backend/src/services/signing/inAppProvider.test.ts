/**
 * 2026-05-23 — S-tier coverage for the in-app signing ceremony.
 *
 * This provider is what actually creates the legal DocumentSignature row
 * containing the FULL agreed text snapshot, the IP, the user agent, and
 * the identity ritual flags. The legally-defensible attributes the org
 * relies on. Zero tests existed before this PR.
 *
 * Pinned invariants:
 *   - Payload shape strict-validated (typedName + password both required)
 *   - Empty typedName rejected
 *   - Fail-closed if user.legalName is null (legal-name capture not done)
 *   - Typed name must match legalName (case + whitespace tolerant)
 *   - Password must verify against passwordHash
 *   - signedTextSnapshot is the FULL document body at sign time
 *   - IP + user-agent captured from req
 *   - passwordReentered=true persisted (audit signal)
 *   - externalProvider/envelopeId/auditUrl all null for in-app
 */

import './../../test/prismaMock';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../../test/prismaMock';

const { comparePasswordSpy } = vi.hoisted(() => ({
  comparePasswordSpy: vi.fn(),
}));
vi.mock('../../utils/password', () => ({
  __esModule: true,
  comparePassword: comparePasswordSpy,
  hashPassword: vi.fn(),
}));

import { inAppProvider } from './inAppProvider';

const USER_ID = 'user-1';
const ENROLLMENT_ID = 'enroll-1';
const DOCUMENT_ID = 'doc-1';

function baseCtx() {
  return {
    user: {
      id: USER_ID,
      legalName: 'Test User',
      passwordHash: '$2b$12$hashvalue',
    },
    enrollment: { id: ENROLLMENT_ID },
    document: {
      id: DOCUMENT_ID,
      version: 1,
      bodyText: 'AGREEMENT: keep secrets secret. Full legal text here.',
    },
    req: {
      // captureIp reads req.headers['x-forwarded-for'] first, falls back
      // to req.ip. captureUserAgent reads req.headers['user-agent']
      // directly (NOT req.get) — pinning that the implementation reads
      // headers, not the express getter API, is itself a useful contract.
      ip: '203.0.113.5',
      headers: { 'user-agent': 'Mozilla/5.0 (test)' },
    },
  };
}

beforeEach(() => {
  comparePasswordSpy.mockReset();
  prismaMock.documentSignature.create.mockImplementation(
    (args: any) => Promise.resolve({ id: 'new-sig', ...args.data }) as any,
  );
});

describe('inAppProvider.sign — payload validation', () => {
  it('rejects when payload is not an object', async () => {
    await expect(
      inAppProvider.sign(baseCtx() as any, { payload: 'string' as any }),
    ).rejects.toThrow(/Invalid signing payload/);
  });

  it('rejects when typedName is missing', async () => {
    await expect(
      inAppProvider.sign(baseCtx() as any, { payload: { password: 'pw' } as any }),
    ).rejects.toThrow(/Invalid signing payload/);
  });

  it('rejects when password is missing', async () => {
    await expect(
      inAppProvider.sign(baseCtx() as any, { payload: { typedName: 'Test User' } as any }),
    ).rejects.toThrow(/Invalid signing payload/);
  });

  it('rejects empty / whitespace-only typedName', async () => {
    await expect(
      inAppProvider.sign(baseCtx() as any, { payload: { typedName: '   ', password: 'pw' } }),
    ).rejects.toThrow(/Typed name is required/);
  });
});

describe('inAppProvider.sign — identity verification', () => {
  it('fails closed when user.legalName is null (legal-name capture not completed)', async () => {
    const ctx = { ...baseCtx(), user: { ...baseCtx().user, legalName: null } };
    await expect(
      inAppProvider.sign(ctx as any, { payload: { typedName: 'Test User', password: 'pw' } }),
    ).rejects.toThrow(/legal name/i);
    // Critical: no DB write happened — no half-signed row left behind.
    expect(prismaMock.documentSignature.create).not.toHaveBeenCalled();
  });

  it('rejects when typed name does NOT match legalName on record', async () => {
    await expect(
      inAppProvider.sign(baseCtx() as any, {
        payload: { typedName: 'Wrong Name', password: 'pw' },
      }),
    ).rejects.toThrow(/match your full legal name/i);
    expect(comparePasswordSpy).not.toHaveBeenCalled();
  });

  it('rejects when password is wrong (walking-past-laptop defence)', async () => {
    comparePasswordSpy.mockResolvedValueOnce(false);
    await expect(
      inAppProvider.sign(baseCtx() as any, {
        payload: { typedName: 'Test User', password: 'wrong-pw' },
      }),
    ).rejects.toThrow(/Password is incorrect/);
    expect(prismaMock.documentSignature.create).not.toHaveBeenCalled();
  });

  it('accepts case + whitespace variations of the legal name', async () => {
    comparePasswordSpy.mockResolvedValue(true);
    const variants = ['test user', 'TEST  USER', ' Test User ', 'Test\tUser'];
    for (const typedName of variants) {
      prismaMock.documentSignature.create.mockClear();
      const result = await inAppProvider.sign(baseCtx() as any, {
        payload: { typedName, password: 'right' },
      });
      expect(result).toBeDefined();
      expect(prismaMock.documentSignature.create).toHaveBeenCalled();
    }
  });
});

describe('inAppProvider.sign — legal artifact persistence', () => {
  beforeEach(() => {
    comparePasswordSpy.mockResolvedValue(true);
  });

  it('persists the FULL document body as signedTextSnapshot (this is the legally-meaningful artifact)', async () => {
    await inAppProvider.sign(baseCtx() as any, {
      payload: { typedName: 'Test User', password: 'pw' },
    });
    expect(prismaMock.documentSignature.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        // If this ever drifts to a hash, a truncation, or a reference to
        // the document row, the signature loses its evidentiary value.
        signedTextSnapshot: 'AGREEMENT: keep secrets secret. Full legal text here.',
      }),
    });
  });

  it('persists IP + user-agent from the request (forensic metadata)', async () => {
    await inAppProvider.sign(baseCtx() as any, {
      payload: { typedName: 'Test User', password: 'pw' },
    });
    expect(prismaMock.documentSignature.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ipAddress: '203.0.113.5',
        userAgent: 'Mozilla/5.0 (test)',
      }),
    });
  });

  it('persists passwordReentered=true (audit signal that identity ritual was completed)', async () => {
    await inAppProvider.sign(baseCtx() as any, {
      payload: { typedName: 'Test User', password: 'pw' },
    });
    expect(prismaMock.documentSignature.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ passwordReentered: true }),
    });
  });

  it('persists the document version so re-acknowledgment on bumped docs is distinguishable', async () => {
    const ctx = baseCtx();
    ctx.document.version = 3;
    await inAppProvider.sign(ctx as any, {
      payload: { typedName: 'Test User', password: 'pw' },
    });
    expect(prismaMock.documentSignature.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ documentVersion: 3 }),
    });
  });

  it('persists null for external provider fields (in-app sign is not external)', async () => {
    await inAppProvider.sign(baseCtx() as any, {
      payload: { typedName: 'Test User', password: 'pw' },
    });
    expect(prismaMock.documentSignature.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        externalProvider: null,
        externalEnvelopeId: null,
        externalAuditUrl: null,
      }),
    });
  });

  it('trims the typed name before persisting (whitespace from form input)', async () => {
    await inAppProvider.sign(baseCtx() as any, {
      payload: { typedName: '  Test User  ', password: 'pw' },
    });
    expect(prismaMock.documentSignature.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ signedName: 'Test User' }),
    });
  });
});
