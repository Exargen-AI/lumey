import { describe, it, expect, vi } from 'vitest';
import crypto from 'crypto';
import { signAppJwt, createInstallationTokenSource } from './githubAppAuth';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function decode(part: string) {
  return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

describe('signAppJwt', () => {
  it('produces a verifiable RS256 JWT with App claims', () => {
    const jwt = signAppJwt({ appId: '12345', privateKey, nowSec: 1_000_000 });
    const [h, p, s] = jwt.split('.');
    expect(decode(h)).toEqual({ alg: 'RS256', typ: 'JWT' });
    const payload = decode(p);
    expect(payload.iss).toBe('12345');
    expect(payload.exp).toBeGreaterThan(payload.iat);
    const sig = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    expect(crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, sig)).toBe(true);
  });
});

function jsonRes(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

describe('createInstallationTokenSource', () => {
  it('looks up the installation and mints a token (Bearer JWT)', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const f = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return url.includes('/installation') && !url.includes('access_tokens')
        ? jsonRes(200, { id: 99 })
        : jsonRes(201, { token: 'ghs_abc', expires_at: '2999-01-01T00:00:00Z' });
    }) as unknown as typeof fetch;

    const src = createInstallationTokenSource({ appId: '1', privateKey, fetchImpl: f, nowFn: () => 1_000 });
    const token = await src.getInstallationToken('acme', 'web');

    expect(token).toBe('ghs_abc');
    expect(calls[0].url).toBe('https://api.github.com/repos/acme/web/installation');
    expect((calls[0].init?.headers as Record<string, string>).authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(calls[1].url).toBe('https://api.github.com/app/installations/99/access_tokens');
    expect(calls[1].init?.method).toBe('POST');
  });

  it('caches the token until near expiry (no re-mint)', async () => {
    let n = 0;
    const f = (async (url: string) => {
      n++;
      return url.includes('access_tokens') ? jsonRes(201, { token: 't', expires_at: '2999-01-01T00:00:00Z' }) : jsonRes(200, { id: 7 });
    }) as unknown as typeof fetch;
    const src = createInstallationTokenSource({ appId: '1', privateKey, fetchImpl: f, nowFn: () => 1_000 });
    await src.getInstallationToken('o', 'r');
    await src.getInstallationToken('o', 'r');
    expect(n).toBe(2); // 2 calls total (lookup + mint), not 4 — second resolve hit the cache
  });

  it('throws when the installation lookup fails', async () => {
    const f = (async () => jsonRes(404, {})) as unknown as typeof fetch;
    const src = createInstallationTokenSource({ appId: '1', privateKey, fetchImpl: f });
    await expect(src.getInstallationToken('o', 'r')).rejects.toThrow(/installation lookup/);
  });

  it('requires appId and privateKey', () => {
    expect(() => createInstallationTokenSource({ appId: '', privateKey, fetchImpl: vi.fn() as unknown as typeof fetch })).toThrow(/required/);
  });
});
