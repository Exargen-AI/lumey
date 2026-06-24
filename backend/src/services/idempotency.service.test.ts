/**
 * 2026-05-23 — Layer 2 / agent control plane.
 *
 * Tests for the Idempotency-Key service. This service implements the
 * dedup + replay contract for retryable mutations. Without this,
 * agents retrying a timed-out POST /tasks can create duplicate tasks.
 *
 * What's pinned here:
 *   - Stable hashing (canonical JSON ordering)
 *   - Lookup cache hits + misses
 *   - Reuse-with-different-body → ConflictError (422)
 *   - Expired rows treated as cache misses
 *   - Store-on-success
 *   - Race-loser silently swallowed (P2002 path)
 *   - Cleanup sweep deletes expired rows
 */

import './../test/prismaMock';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import { ConflictError } from '../utils/errors';
import {
  canonicalJSON,
  computeRequestHash,
  lookupIdempotencyKey,
  storeIdempotentResponse,
  purgeExpiredIdempotencyKeys,
  IDEMPOTENCY_TTL_MS,
} from './idempotency.service';

const USER_ID = 'user-1';
const KEY = 'idemp-abc123';

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('canonicalJSON — deterministic key ordering', () => {
  it('produces identical strings for objects with reordered keys', () => {
    const a = { title: 'X', priority: 'P1' };
    const b = { priority: 'P1', title: 'X' };
    expect(canonicalJSON(a)).toBe(canonicalJSON(b));
  });

  it('preserves array order (arrays are order-sensitive)', () => {
    expect(canonicalJSON([1, 2])).not.toBe(canonicalJSON([2, 1]));
  });

  it('handles nested objects deterministically', () => {
    const a = { user: { name: 'A', email: 'a@x.in' }, count: 1 };
    const b = { count: 1, user: { email: 'a@x.in', name: 'A' } };
    expect(canonicalJSON(a)).toBe(canonicalJSON(b));
  });

  it('handles null, undefined, primitives without throwing', () => {
    expect(canonicalJSON(null)).toBe('null');
    expect(canonicalJSON(undefined)).toBe('undefined');
    expect(canonicalJSON(42)).toBe('42');
    expect(canonicalJSON('hi')).toBe('"hi"');
    expect(canonicalJSON(true)).toBe('true');
  });
});

describe('computeRequestHash — stable, collision-resistant', () => {
  it('returns the same hash for the same (method, path, body) regardless of key order', () => {
    const h1 = computeRequestHash('POST', '/api/v1/tasks', { a: 1, b: 2 });
    const h2 = computeRequestHash('POST', '/api/v1/tasks', { b: 2, a: 1 });
    expect(h1).toBe(h2);
  });

  it('differs when the method changes', () => {
    const h1 = computeRequestHash('POST', '/api/v1/tasks', { x: 1 });
    const h2 = computeRequestHash('PATCH', '/api/v1/tasks', { x: 1 });
    expect(h1).not.toBe(h2);
  });

  it('differs when the path changes', () => {
    const h1 = computeRequestHash('POST', '/api/v1/tasks', { x: 1 });
    const h2 = computeRequestHash('POST', '/api/v1/projects', { x: 1 });
    expect(h1).not.toBe(h2);
  });

  it('differs when the body changes', () => {
    const h1 = computeRequestHash('POST', '/api/v1/tasks', { x: 1 });
    const h2 = computeRequestHash('POST', '/api/v1/tasks', { x: 2 });
    expect(h1).not.toBe(h2);
  });

  it('is uppercase-method-insensitive (post and POST hash same)', () => {
    const h1 = computeRequestHash('post', '/api/v1/tasks', {});
    const h2 = computeRequestHash('POST', '/api/v1/tasks', {});
    expect(h1).toBe(h2);
  });

  it('returns 64-hex-char SHA-256 output', () => {
    const h = computeRequestHash('POST', '/tasks', { x: 1 });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('lookupIdempotencyKey — cache miss', () => {
  it('returns null when no row exists for the composite key', async () => {
    prismaMock.idempotencyKey.findUnique.mockResolvedValue(null);
    const result = await lookupIdempotencyKey({
      key: KEY,
      userId: USER_ID,
      method: 'POST',
      path: '/tasks',
      requestHash: 'h',
    });
    expect(result).toBeNull();
  });

  it('queries with the composite unique key shape (not by any single field alone)', async () => {
    prismaMock.idempotencyKey.findUnique.mockResolvedValue(null);
    await lookupIdempotencyKey({
      key: KEY,
      userId: USER_ID,
      method: 'POST',
      path: '/tasks',
      requestHash: 'h',
    });
    expect(prismaMock.idempotencyKey.findUnique).toHaveBeenCalledWith({
      where: {
        userId_key_method_path: {
          userId: USER_ID,
          key: KEY,
          method: 'POST',
          path: '/tasks',
        },
      },
    });
  });
});

describe('lookupIdempotencyKey — cache hit + matching hash', () => {
  it('returns the stored statusCode + responseBody for replay', async () => {
    prismaMock.idempotencyKey.findUnique.mockResolvedValue({
      requestHash: 'h',
      statusCode: 201,
      responseBody: { success: true, data: { id: 'task-1' } },
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    } as any);

    const result = await lookupIdempotencyKey({
      key: KEY,
      userId: USER_ID,
      method: 'POST',
      path: '/tasks',
      requestHash: 'h',
    });
    expect(result).toEqual({
      statusCode: 201,
      responseBody: { success: true, data: { id: 'task-1' } },
    });
  });
});

describe('lookupIdempotencyKey — cache hit + hash MISMATCH', () => {
  it('throws ConflictError(422) when stored request body differs from incoming', async () => {
    prismaMock.idempotencyKey.findUnique.mockResolvedValue({
      requestHash: 'old-hash',
      statusCode: 201,
      responseBody: { something: 'else' },
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    } as any);

    await expect(
      lookupIdempotencyKey({
        key: KEY,
        userId: USER_ID,
        method: 'POST',
        path: '/tasks',
        requestHash: 'new-hash',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('the conflict message names the key + advises sending a new key OR the same payload', async () => {
    prismaMock.idempotencyKey.findUnique.mockResolvedValue({
      requestHash: 'old-hash',
      statusCode: 201,
      responseBody: {},
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    } as any);

    await expect(
      lookupIdempotencyKey({
        key: 'my-unique-key',
        userId: USER_ID,
        method: 'POST',
        path: '/tasks',
        requestHash: 'new-hash',
      }),
    ).rejects.toThrow(/my-unique-key/);
  });
});

describe('lookupIdempotencyKey — expired rows', () => {
  it('returns null when expiresAt is in the past (treats expired as cache miss)', async () => {
    prismaMock.idempotencyKey.findUnique.mockResolvedValue({
      requestHash: 'h',
      statusCode: 201,
      responseBody: {},
      expiresAt: new Date(Date.now() - 1000), // expired 1 second ago
    } as any);

    const result = await lookupIdempotencyKey({
      key: KEY,
      userId: USER_ID,
      method: 'POST',
      path: '/tasks',
      requestHash: 'h',
    });
    expect(result).toBeNull();
  });

  it('does NOT throw a conflict on expired rows (even if hash mismatches)', async () => {
    // Expired row with DIFFERENT hash — shouldn't 422; should just miss-cache.
    prismaMock.idempotencyKey.findUnique.mockResolvedValue({
      requestHash: 'old-hash',
      statusCode: 201,
      responseBody: {},
      expiresAt: new Date(Date.now() - 1000),
    } as any);

    const result = await lookupIdempotencyKey({
      key: KEY,
      userId: USER_ID,
      method: 'POST',
      path: '/tasks',
      requestHash: 'new-hash',
    });
    expect(result).toBeNull();
  });
});

describe('storeIdempotentResponse', () => {
  it('writes a row with the 24h TTL', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-05-23T12:00:00Z');
    vi.setSystemTime(now);

    prismaMock.idempotencyKey.create.mockResolvedValue({} as any);

    await storeIdempotentResponse({
      key: KEY,
      userId: USER_ID,
      method: 'POST',
      path: '/tasks',
      requestHash: 'h',
      statusCode: 201,
      responseBody: { ok: true },
    });

    const args = prismaMock.idempotencyKey.create.mock.calls[0]?.[0] as any;
    expect(args.data.statusCode).toBe(201);
    expect(args.data.requestHash).toBe('h');
    expect(args.data.method).toBe('POST');
    expect((args.data.expiresAt as Date).getTime()).toBe(now.getTime() + IDEMPOTENCY_TTL_MS);
  });

  it('uppercases the method on store (so storage matches lookup)', async () => {
    prismaMock.idempotencyKey.create.mockResolvedValue({} as any);
    await storeIdempotentResponse({
      key: KEY,
      userId: USER_ID,
      method: 'post',
      path: '/tasks',
      requestHash: 'h',
      statusCode: 200,
      responseBody: {},
    });
    const args = prismaMock.idempotencyKey.create.mock.calls[0]?.[0] as any;
    expect(args.data.method).toBe('POST');
  });

  it('silently swallows P2002 (race-loser path)', async () => {
    // Two concurrent retries both miss the lookup, both try to insert.
    // The second insert hits the unique constraint. The middleware
    // already sent its response over the wire; we just want the
    // dead-letter write to NOT throw and crash the caller.
    const p2002 = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
    prismaMock.idempotencyKey.create.mockRejectedValue(p2002);

    await expect(
      storeIdempotentResponse({
        key: KEY,
        userId: USER_ID,
        method: 'POST',
        path: '/tasks',
        requestHash: 'h',
        statusCode: 200,
        responseBody: {},
      }),
    ).resolves.toBeUndefined();
  });

  it('re-throws non-P2002 Prisma errors (real DB problems should surface)', async () => {
    const realErr = Object.assign(new Error('Connection lost'), { code: 'P1001' });
    prismaMock.idempotencyKey.create.mockRejectedValue(realErr);

    await expect(
      storeIdempotentResponse({
        key: KEY,
        userId: USER_ID,
        method: 'POST',
        path: '/tasks',
        requestHash: 'h',
        statusCode: 200,
        responseBody: {},
      }),
    ).rejects.toThrow(/Connection lost/);
  });
});

describe('purgeExpiredIdempotencyKeys', () => {
  it('deletes every row where expiresAt < now and reports the count', async () => {
    prismaMock.idempotencyKey.deleteMany.mockResolvedValue({ count: 42 } as any);
    const result = await purgeExpiredIdempotencyKeys();
    expect(result).toEqual({ deleted: 42 });
    const args = prismaMock.idempotencyKey.deleteMany.mock.calls[0]?.[0] as any;
    expect(args.where.expiresAt.lt).toBeInstanceOf(Date);
  });
});
