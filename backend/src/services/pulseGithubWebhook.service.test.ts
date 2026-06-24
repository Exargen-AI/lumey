/**
 * Pulse GitHub webhook service — unit tests.
 *
 * Covers:
 *   - HMAC signature verification (valid, invalid, missing, tampered)
 *   - Constant-time compare for unequal-length signatures
 *   - Bot login detection (dependabot/renovate/[bot] suffix)
 *   - PR opened / merged / closed-without-merge handling
 *   - Self-review detection (reviewer === PR author)
 *   - Push event filters non-default-branch commits
 *   - Unmapped actor login → audit row only, no productivity emits
 *   - Ping event → ignored
 *   - Duplicate delivery → no double-emits
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import {
  verifyPulseWebhookSignature,
  isBotLogin,
  processPulseWebhookDelivery,
} from './pulseGithubWebhook.service';

// ─── verifyPulseWebhookSignature ─────────────────────────────────────

describe('verifyPulseWebhookSignature', () => {
  const SECRET = 'test-secret-32-bytes-or-longer-OK';
  const BODY = Buffer.from(JSON.stringify({ hello: 'world' }), 'utf8');

  function makeValidSignature(body: Buffer = BODY, secret = SECRET): string {
    const hex = crypto.createHmac('sha256', secret).update(body).digest('hex');
    return `sha256=${hex}`;
  }

  it('accepts a valid signature', () => {
    expect(verifyPulseWebhookSignature(SECRET, BODY, makeValidSignature())).toBe(true);
  });

  it('rejects when signature header is missing', () => {
    expect(verifyPulseWebhookSignature(SECRET, BODY, undefined)).toBe(false);
  });

  it('rejects when signature is empty string', () => {
    expect(verifyPulseWebhookSignature(SECRET, BODY, '')).toBe(false);
  });

  it('rejects when signature lacks the sha256= prefix', () => {
    expect(verifyPulseWebhookSignature(SECRET, BODY, 'deadbeef')).toBe(false);
  });

  it('rejects when secret is wrong', () => {
    const wrongSig = makeValidSignature(BODY, 'totally-different-secret-32-bytes');
    expect(verifyPulseWebhookSignature(SECRET, BODY, wrongSig)).toBe(false);
  });

  it('rejects when body has been tampered with', () => {
    const sig = makeValidSignature();
    const tamperedBody = Buffer.from(JSON.stringify({ hello: 'evil' }), 'utf8');
    expect(verifyPulseWebhookSignature(SECRET, tamperedBody, sig)).toBe(false);
  });

  it('rejects unequal-length signatures without throwing (timingSafeEqual guard)', () => {
    expect(verifyPulseWebhookSignature(SECRET, BODY, 'sha256=tooshort')).toBe(false);
  });
});

// ─── isBotLogin ──────────────────────────────────────────────────────

describe('isBotLogin', () => {
  it.each([
    ['dependabot', true],
    ['dependabot[bot]', true],
    ['renovate', true],
    ['renovate-bot', true],
    ['github-actions[bot]', true],
    ['github-actions', true],
    ['codecov[bot]', true],
    ['stale[bot]', true],
    ['preetham', false],
    ['pankaj', false],
    ['some-human-with-bot-in-name', false], // doesn't match [bot] suffix
    ['', false],
  ])('isBotLogin(%s) → %s', (login, expected) => {
    expect(isBotLogin(login)).toBe(expected);
  });

  it('returns false for null / undefined', () => {
    expect(isBotLogin(null)).toBe(false);
    expect(isBotLogin(undefined)).toBe(false);
  });
});

// ─── processPulseWebhookDelivery ─────────────────────────────────────

function makeTxStub() {
  const ghCreateMany = vi.fn(async (args: { data: unknown[]; skipDuplicates?: boolean }) => ({
    count: args.data.length,
  }));
  const ghUpdate = vi.fn(async (_args: unknown) => undefined);
  const userFindUnique = vi.fn();
  const productivityEventCreateMany = vi.fn(
    async (args: { data: unknown[]; skipDuplicates?: boolean }) => ({ count: args.data.length }),
  );
  return {
    githubWebhookEvent: { createMany: ghCreateMany, update: ghUpdate },
    user: { findUnique: userFindUnique },
    productivityEvent: { createMany: productivityEventCreateMany },
    _ghCreateMany: ghCreateMany,
    _userFindUnique: userFindUnique,
    _emit: productivityEventCreateMany,
  };
}

const FLAG = 'FEATURE_PULSE_COMPOSITE_SCORE_BETA';

describe('processPulseWebhookDelivery', () => {
  beforeEach(() => {
    delete process.env[FLAG];
  });
  afterEach(() => {
    delete process.env[FLAG];
  });

  it('writes an audit row and returns deduped=true on duplicate deliveryId', async () => {
    const tx = makeTxStub();
    // Simulate duplicate: createMany returns count=0
    tx._ghCreateMany.mockResolvedValueOnce({ count: 0 });

    const result = await processPulseWebhookDelivery(
       
      tx as any,
      {
        deliveryId: 'dup-1',
        eventType: 'pull_request',
        rawBody: '{}',
        payload: { sender: { login: 'preetham' }, action: 'opened' },
      },
    );
    expect(result.deduped).toBe(true);
    expect(result.emittedCount).toBe(0);
    expect(tx._emit).not.toHaveBeenCalled();
  });

  it('skips bot-actor deliveries even with feature flag on', async () => {
    process.env[FLAG] = 'true';
    const tx = makeTxStub();
    const result = await processPulseWebhookDelivery(
       
      tx as any,
      {
        deliveryId: 'd-bot',
        eventType: 'pull_request',
        rawBody: '{}',
        payload: {
          sender: { login: 'dependabot' },
          action: 'opened',
          pull_request: { number: 1, body: 'x'.repeat(100), additions: 100, deletions: 0 },
        },
      },
    );
    expect(result.emittedCount).toBe(0);
    expect(tx._emit).not.toHaveBeenCalled();
    // Audit row WAS written though
    expect(tx._ghCreateMany).toHaveBeenCalledOnce();
    const [auditArgs] = tx._ghCreateMany.mock.calls[0];
    expect(auditArgs.data[0]).toMatchObject({ actorIsBot: true });
  });

  it('returns 0 emits when actor login does not map to a user', async () => {
    process.env[FLAG] = 'true';
    const tx = makeTxStub();
    tx._userFindUnique.mockResolvedValue(null);
    const result = await processPulseWebhookDelivery(
       
      tx as any,
      {
        deliveryId: 'd-unknown',
        eventType: 'pull_request',
        rawBody: '{}',
        payload: {
          sender: { login: 'unknown-human' },
          action: 'opened',
          pull_request: { number: 1, body: 'x'.repeat(100), user: { login: 'unknown-human' } },
        },
      },
    );
    expect(result.emittedCount).toBe(0);
    expect(tx._emit).not.toHaveBeenCalled();
    expect(tx._userFindUnique).toHaveBeenCalledWith({
      where: { githubLogin: 'unknown-human' },
      select: { id: true },
    });
  });

  it('emits github.pr_opened for an opened PR by a mapped user', async () => {
    process.env[FLAG] = 'true';
    const tx = makeTxStub();
    tx._userFindUnique.mockResolvedValue({ id: 'user-1' });
    const result = await processPulseWebhookDelivery(
       
      tx as any,
      {
        deliveryId: 'd-1',
        eventType: 'pull_request',
        rawBody: '{}',
        payload: {
          sender: { login: 'preetham' },
          action: 'opened',
          pull_request: {
            number: 42,
            body: 'x'.repeat(100),
            user: { login: 'preetham' },
            draft: false,
            additions: 50,
            deletions: 5,
          },
          repository: { full_name: 'Exargen-AI/repo' },
        },
      },
    );
    expect(result.emittedCount).toBe(1);
    expect(tx._emit).toHaveBeenCalledOnce();
    const [emitArgs] = tx._emit.mock.calls[0];
    expect(emitArgs.data[0]).toMatchObject({
      userId: 'user-1',
      signal: 'CODE',
      eventType: 'github.pr_opened',
      source: 'github',
    });
  });

  it('emits github.pr_merged only for merged=true closes', async () => {
    process.env[FLAG] = 'true';
    const tx = makeTxStub();
    tx._userFindUnique.mockResolvedValue({ id: 'user-1' });

    // closed but NOT merged
    const r1 = await processPulseWebhookDelivery(
       
      tx as any,
      {
        deliveryId: 'd-closed',
        eventType: 'pull_request',
        rawBody: '{}',
        payload: {
          sender: { login: 'preetham' },
          action: 'closed',
          pull_request: {
            number: 1,
            merged: false,
            body: 'x'.repeat(100),
            user: { login: 'preetham' },
            additions: 50,
            deletions: 5,
          },
        },
      },
    );
    expect(r1.emittedCount).toBe(0);

    // closed AND merged
    const r2 = await processPulseWebhookDelivery(
       
      tx as any,
      {
        deliveryId: 'd-merged',
        eventType: 'pull_request',
        rawBody: '{}',
        payload: {
          sender: { login: 'preetham' },
          action: 'closed',
          pull_request: {
            number: 2,
            merged: true,
            body: 'x'.repeat(100),
            user: { login: 'preetham' },
            additions: 50,
            deletions: 5,
          },
        },
      },
    );
    expect(r2.emittedCount).toBe(1);
    const [emitArgs] = tx._emit.mock.calls[0];
    expect(emitArgs.data[0]).toMatchObject({ eventType: 'github.pr_merged' });
  });

  it('marks reviews where reviewer === PR author as selfReview=true', async () => {
    process.env[FLAG] = 'true';
    const tx = makeTxStub();
    tx._userFindUnique.mockResolvedValue({ id: 'user-1' });
    await processPulseWebhookDelivery(
       
      tx as any,
      {
        deliveryId: 'd-self-review',
        eventType: 'pull_request_review',
        rawBody: '{}',
        payload: {
          sender: { login: 'preetham' },
          action: 'submitted',
          review: { state: 'approved', user: { login: 'preetham' } },
          pull_request: { number: 1, user: { login: 'preetham' } },
        },
      },
    );
    const [emitArgs] = tx._emit.mock.calls[0];
    const emitted = emitArgs.data[0] as { rawPayload: Record<string, unknown> };
    expect(emitted.rawPayload).toMatchObject({ selfReview: true });
  });

  it('ignores push events for non-default branches', async () => {
    process.env[FLAG] = 'true';
    const tx = makeTxStub();
    tx._userFindUnique.mockResolvedValue({ id: 'user-1' });
    const result = await processPulseWebhookDelivery(
       
      tx as any,
      {
        deliveryId: 'd-push-fb',
        eventType: 'push',
        rawBody: '{}',
        payload: {
          sender: { login: 'preetham' },
          ref: 'refs/heads/feature-branch',
          commits: [{ id: 'sha1', message: 'wip' }],
          repository: { default_branch: 'main' },
        },
      },
    );
    expect(result.emittedCount).toBe(0);
  });

  it('emits one github.commit per commit on default-branch pushes', async () => {
    process.env[FLAG] = 'true';
    const tx = makeTxStub();
    tx._userFindUnique.mockResolvedValue({ id: 'user-1' });
    await processPulseWebhookDelivery(
       
      tx as any,
      {
        deliveryId: 'd-push-main',
        eventType: 'push',
        rawBody: '{}',
        payload: {
          sender: { login: 'preetham' },
          ref: 'refs/heads/main',
          commits: [
            { id: 'sha1', message: 'a' },
            { id: 'sha2', message: 'b' },
            { id: 'sha3', message: 'c' },
          ],
          repository: { default_branch: 'main' },
        },
      },
    );
    expect(tx._emit).toHaveBeenCalledOnce();
    const [emitArgs] = tx._emit.mock.calls[0];
    expect(emitArgs.data).toHaveLength(3);
    expect(emitArgs.data[0]).toMatchObject({
      signal: 'CODE',
      eventType: 'github.commit',
    });
  });

  it('returns 0 emits for ping events', async () => {
    process.env[FLAG] = 'true';
    const tx = makeTxStub();
    tx._userFindUnique.mockResolvedValue({ id: 'user-1' });
    const result = await processPulseWebhookDelivery(
       
      tx as any,
      {
        deliveryId: 'd-ping',
        eventType: 'ping',
        rawBody: '{}',
        payload: { sender: { login: 'preetham' } },
      },
    );
    expect(result.emittedCount).toBe(0);
  });
});

