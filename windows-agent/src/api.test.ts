/**
 * Pulse Agent — api.ts safety tests (2026-05-30 god-mode pass).
 *
 * The HTTP client wraps axios; we mock the axios instance so we can
 * drive every response code and assert on:
 *
 *   (1) `AuthRevokedError` fires on 401 + 403 — and NOT on 5xx.
 *       This is the signal the main loop uses to short-circuit the
 *       agent on a revoked device instead of retrying forever.
 *
 *   (2) Snapshot RETRIES on transient errors (same shape as the
 *       existing heartbeat behaviour). Previously a single 502 from
 *       the LB lost an entire 60-min telemetry window.
 *
 *   (3) `scrubSecrets()` redacts apiKey / enrollmentToken / Authorization
 *       in every shape we ever pass to a logger (string, plain object,
 *       nested object, axios error). Cycle-safe.
 *
 *   (4) `scrubError()` strips response.data — we deliberately do NOT
 *       trust the backend to redact secrets it happens to echo back.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);

const postMock = vi.fn();
let createSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  postMock.mockReset();
  createSpy = vi.fn(() => ({ post: postMock })) as unknown as ReturnType<typeof vi.fn>;
  (mockedAxios.create as unknown as ReturnType<typeof vi.fn>) = createSpy;
});

// Re-import inside each describe so the mocked axios is captured fresh.
async function freshApi() {
  return await import('./api');
}

describe('AuthRevokedError — 401 / 403 short-circuit', () => {
  it('throws AuthRevokedError on a 401 heartbeat response', async () => {
    const { PulseApiClient, AuthRevokedError } = await freshApi();
    postMock.mockResolvedValue({ status: 401, data: {} });
    const client = new PulseApiClient({ serverUrl: 'https://x', apiKey: 'k' });

    await expect(
      client.heartbeat({ powerState: 'ON', uptimeSeconds: 1, agentVersion: 't' }),
    ).rejects.toBeInstanceOf(AuthRevokedError);
  });

  it('throws AuthRevokedError on a 403 heartbeat response', async () => {
    const { PulseApiClient, AuthRevokedError } = await freshApi();
    postMock.mockResolvedValue({ status: 403, data: {} });
    const client = new PulseApiClient({ serverUrl: 'https://x', apiKey: 'k' });

    await expect(
      client.heartbeat({ powerState: 'ON', uptimeSeconds: 1, agentVersion: 't' }),
    ).rejects.toBeInstanceOf(AuthRevokedError);
  });

  it('throws AuthRevokedError on a 401 snapshot response (same path as heartbeat)', async () => {
    const { PulseApiClient, AuthRevokedError } = await freshApi();
    postMock.mockResolvedValue({ status: 401, data: {} });
    const client = new PulseApiClient({ serverUrl: 'https://x', apiKey: 'k' });

    await expect(
      client.snapshot({
        powerState: 'ON',
        uptimeSeconds: 1,
        agentVersion: 't',
        installedSoftware: [],
        missingPatches: [],
      }),
    ).rejects.toBeInstanceOf(AuthRevokedError);
  });

  it('does NOT throw AuthRevokedError on a 5xx (transient — must be retried)', async () => {
    const { PulseApiClient, AuthRevokedError } = await freshApi();
    // validateStatus caps at <500 so 503 actually fires the catch branch
    // — emulate by rejecting like a real network error.
    postMock.mockRejectedValue(new Error('ECONNRESET'));
    const client = new PulseApiClient({ serverUrl: 'https://x', apiKey: 'k' });

    await expect(
      client.heartbeat({ powerState: 'ON', uptimeSeconds: 1, agentVersion: 't' }),
    ).rejects.not.toBeInstanceOf(AuthRevokedError);
  });
});

describe('Snapshot retry symmetry', () => {
  it('retries the snapshot POST three times before giving up', async () => {
    const { PulseApiClient } = await freshApi();
    postMock.mockRejectedValue(new Error('ECONNRESET'));
    const client = new PulseApiClient({ serverUrl: 'https://x', apiKey: 'k' });

    await expect(
      client.snapshot({
        powerState: 'ON',
        uptimeSeconds: 1,
        agentVersion: 't',
        installedSoftware: [],
        missingPatches: [],
      }),
    ).rejects.toThrow(/ECONNRESET/);
    // 3 attempts before giving up — matches heartbeat behaviour.
    expect(postMock).toHaveBeenCalledTimes(3);
  });

  it('returns the second-attempt result when the first attempt fails (recovery path)', async () => {
    const { PulseApiClient } = await freshApi();
    postMock
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce({
        status: 201,
        data: { success: true, data: { ok: true, riskScore: 0, riskLevel: 'HEALTHY', openAlertCount: 0 } },
      });
    const client = new PulseApiClient({ serverUrl: 'https://x', apiKey: 'k' });

    const result = await client.snapshot({
      powerState: 'ON',
      uptimeSeconds: 1,
      agentVersion: 't',
      installedSoftware: [],
      missingPatches: [],
    });

    expect(result.riskLevel).toBe('HEALTHY');
    expect(postMock).toHaveBeenCalledTimes(2);
  }, 10_000);
});

describe('scrubSecrets — credential redaction', () => {
  it('redacts apiKey + enrollmentToken at top level', async () => {
    const { scrubSecrets } = await freshApi();
    const scrubbed = scrubSecrets({
      apiKey: 'ak-supersecret',
      enrollmentToken: 'det_aaaaaaaa',
      benign: 'kept',
    }) as Record<string, string>;
    expect(scrubbed.apiKey).toBe('«redacted»');
    expect(scrubbed.enrollmentToken).toBe('«redacted»');
    expect(scrubbed.benign).toBe('kept');
  });

  it('redacts case-insensitively (Authorization, ApiKey, API_KEY)', async () => {
    const { scrubSecrets } = await freshApi();
    const scrubbed = scrubSecrets({
      Authorization: 'Device blah',
      ApiKey: 'k',
      API_KEY: 'k',
    }) as Record<string, string>;
    expect(scrubbed.Authorization).toBe('«redacted»');
    expect(scrubbed.ApiKey).toBe('«redacted»');
    expect(scrubbed.API_KEY).toBe('«redacted»');
  });

  it('redacts deeply nested credentials', async () => {
    const { scrubSecrets } = await freshApi();
    const scrubbed = scrubSecrets({
      config: { headers: { Authorization: 'Device deep' } },
      child: { apiKey: 'deep' },
    }) as { config: { headers: { Authorization: string } }; child: { apiKey: string } };
    expect(scrubbed.config.headers.Authorization).toBe('«redacted»');
    expect(scrubbed.child.apiKey).toBe('«redacted»');
  });

  it('strips det_… enrollment-token shapes from raw strings', async () => {
    const { scrubSecrets } = await freshApi();
    const msg = 'Enrollment failed for det_1234567890abcdef — try again';
    expect(scrubSecrets(msg) as string).not.toMatch(/det_1234567890abcdef/);
    expect(scrubSecrets(msg) as string).toMatch(/det_«redacted»/);
  });

  it('strips Authorization: Device … shapes from raw strings', async () => {
    const { scrubSecrets } = await freshApi();
    const msg = 'request failed: Authorization Device sk_secretkey timed out';
    expect(scrubSecrets(msg) as string).toMatch(/Device «redacted»/);
    expect(scrubSecrets(msg) as string).not.toMatch(/sk_secretkey/);
  });

  it('does not loop forever on a cyclic object', async () => {
    const { scrubSecrets } = await freshApi();
    const cyclic: Record<string, unknown> = { apiKey: 'k' };
    cyclic.self = cyclic;
    // If this hangs, the test runner kills it via the suite timeout —
    // the assertion is that we get back something at all.
    const result = scrubSecrets(cyclic);
    expect(result).toBeDefined();
  });
});

describe('scrubError — log-safe error coercion', () => {
  it('summarizes an axios-shaped error without echoing the request body', async () => {
    const { scrubError } = await freshApi();
    const axiosErr = {
      isAxiosError: true,
      code: 'ERR_BAD_REQUEST',
      response: { status: 400, data: { apiKey: 'leak' } },
      config: { url: '/devices/me/snapshot' },
    };
    const summary = scrubError(axiosErr);
    expect(summary).toContain('400');
    expect(summary).toContain('/devices/me/snapshot');
    // Critically: we don't include response.data, so the echo'd key
    // never reaches the log line.
    expect(summary).not.toContain('leak');
  });

  it('extracts message from a plain Error', async () => {
    const { scrubError } = await freshApi();
    const e = new Error('plain message');
    expect(scrubError(e)).toBe('plain message');
  });

  it('redacts det_… tokens that appear inside an Error.message', async () => {
    const { scrubError } = await freshApi();
    const e = new Error('failed using det_abcdefghijklmnop');
    expect(scrubError(e)).not.toContain('det_abcdefghijklmnop');
    expect(scrubError(e)).toContain('det_«redacted»');
  });
});
