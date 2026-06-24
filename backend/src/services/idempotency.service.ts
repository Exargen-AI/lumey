import { createHash } from 'crypto';
import prisma from '../config/database';
import { ConflictError } from '../utils/errors';

/**
 * 2026-05-23 — Layer 2 / agent control plane.
 *
 * Idempotency-Key service. Underpins the `idempotencyKey` middleware that
 * accepts an `Idempotency-Key: <opaque>` header on state-changing
 * requests. The contract follows Stripe's well-known shape so external
 * agent developers recognize it immediately:
 *
 *   1. Compute `requestHash` from (method, path, sorted body JSON).
 *   2. Look up `(userId, key, method, path)`.
 *      a. **Cache hit, hash matches** → REPLAY the stored response.
 *         The caller gets the same status + body the original request
 *         got. No duplicate writes, no surprise side effects.
 *      b. **Cache hit, hash mismatch** → throw ConflictError(422).
 *         The client reused a key for a different request body — that's
 *         misuse (e.g., a buggy client reusing keys), not legitimate
 *         retry, so we refuse loudly rather than silently doing the
 *         wrong thing.
 *      c. **Cache miss** → return null. The middleware lets the
 *         handler run and calls back with the response to persist.
 *
 *   3. On persist: write `(key, userId, method, path, requestHash,
 *      statusCode, responseBody, expiresAt = now + 24h)`. The
 *      composite unique index on (userId, key, method, path) provides
 *      structural protection against a race where the same key shows
 *      up twice in the same instant — the second insert P2002s and
 *      we coerce that into a replay of whichever row landed first.
 *
 * Why this lives as a separate service (not just inside the middleware):
 *
 *   - Future surfaces (webhook deduplication, batch jobs) can reuse the
 *     same lookup/replay helpers without re-wiring middleware behavior.
 *   - Hashing is centralized — every caller hashes the same way.
 *   - Tests can pin the hash algorithm + the replay logic directly,
 *     without HTTP/Express plumbing in the way.
 *
 * Why 24-hour TTL:
 *
 *   - Well-behaved clients retry within seconds, not days.
 *   - Storage grows linearly with traffic; a 24h TTL means the table
 *     stays bounded under any reasonable workload.
 *   - Anything longer than 24h is a different concern (audit, event
 *     log) — see Activity / TaskStatusHistory / signing.service.
 *
 * NOT in scope for v1:
 *   - Streaming responses (PDF downloads, ZIP archives) bypass the
 *     middleware. JSON only. Stream replay is a separate hard problem.
 *   - GET / HEAD / OPTIONS bypass the middleware. Read-only by
 *     definition; the client can just retry.
 */

/** TTL for stored idempotency rows — 24 hours. */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** Maximum allowed length of an Idempotency-Key header. Stripe uses 255. */
export const MAX_KEY_LENGTH = 255;

/**
 * Stable hash of a state-changing request, used to detect "same key
 * reused with a different body" misuse.
 *
 * Inputs:
 *   - HTTP method (uppercased, so POST and post hash the same)
 *   - Path (templated where possible — see `templatePath` in the
 *     middleware — so /tasks/abc and /tasks/abc hash the same regardless
 *     of how Express resolved the route, and so /tasks/abc vs /tasks/def
 *     hash to the same template `/tasks/:id` because the path semantic
 *     is the same)
 *   - Body — serialized via `JSON.stringify` with sorted keys so
 *     `{a:1,b:2}` and `{b:2,a:1}` hash the same.
 *
 * SHA-256 hex digest — collision-resistant + cheap. We don't need
 * cryptographic secrecy here, just stable equality.
 */
export function computeRequestHash(
  method: string,
  path: string,
  body: unknown,
): string {
  const canonicalBody = canonicalJSON(body);
  const input = `${method.toUpperCase()}\n${path}\n${canonicalBody}`;
  return createHash('sha256').update(input).digest('hex');
}

/**
 * JSON.stringify with deterministic key ordering — so a body of
 * `{ title: 'X', priority: 'P1' }` hashes the same as
 * `{ priority: 'P1', title: 'X' }` (clients with different JSON
 * serializers wouldn't otherwise dedupe).
 *
 * Recurses into nested objects; preserves array order (arrays ARE
 * order-sensitive — `[1,2]` and `[2,1]` are semantically different).
 */
export function canonicalJSON(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJSON).join(',')}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map(
    (k) => `${JSON.stringify(k)}:${canonicalJSON((value as Record<string, unknown>)[k])}`,
  );
  return `{${parts.join(',')}}`;
}

export interface IdempotencyLookupArgs {
  key: string;
  userId: string;
  method: string;
  path: string;
  requestHash: string;
}

export interface IdempotencyHit {
  statusCode: number;
  responseBody: unknown;
}

/**
 * Look up a stored response for this `(userId, key, method, path)` and
 * compare its requestHash to the incoming one.
 *
 * Returns:
 *   - The stored response (status + body) when hash matches → middleware
 *     should REPLAY without calling the handler.
 *   - `null` when no row exists for this key → middleware should let the
 *     handler run, then call `storeResponse` to persist.
 *   - Throws ConflictError(422) when a row exists with a DIFFERENT
 *     hash → the client reused a key for a different request body, which
 *     is explicit misuse.
 *
 * Expired rows are treated as cache misses — the caller cleans them up
 * via the scheduled sweep (`purgeExpired`), not the hot path.
 */
export async function lookupIdempotencyKey(
  args: IdempotencyLookupArgs,
): Promise<IdempotencyHit | null> {
  const row = await prisma.idempotencyKey.findUnique({
    where: {
      userId_key_method_path: {
        userId: args.userId,
        key: args.key,
        method: args.method.toUpperCase(),
        path: args.path,
      },
    },
  });

  if (!row) return null;

  // Treat expired rows as cache misses — let the handler run + overwrite
  // the stored response. We don't delete here to keep the hot path read-
  // only; the sweep handles physical deletion.
  if (row.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  if (row.requestHash !== args.requestHash) {
    // Stripe pattern: a 422 on key reuse, NOT a 200 replay.
    // Returning a 200 with the original response would silently
    // misrepresent the new request's outcome.
    throw new ConflictError(
      `Idempotency-Key reuse with a different request body. The key "${args.key}" has been used for this endpoint before with a different payload. Either use a new key for this request, or send the exact original payload.`,
    );
  }

  return {
    statusCode: row.statusCode,
    responseBody: row.responseBody,
  };
}

export interface StoreIdempotencyArgs extends IdempotencyLookupArgs {
  statusCode: number;
  responseBody: unknown;
}

/**
 * Persist a response so future retries with the same key can replay it.
 *
 * Race-handling: two requests with the same key arriving in the same
 * instant will both miss the lookup, both run their handlers, and both
 * try to insert. The composite unique index on
 * `(userId, key, method, path)` causes the second insert to P2002 —
 * caller catches that and treats it as a successful no-op (the first
 * write wins; the second response gets silently dropped from cache
 * but the client still received its own response over the wire).
 *
 * Result: the SECOND insert losing the race does not affect the second
 * client's experience, only the cached payload that future replays will
 * see. Both clients got their own response; future replays see the
 * winner's response, which is fine — they're semantically equivalent
 * (same input → same output, by the idempotency invariant).
 */
export async function storeIdempotentResponse(
  args: StoreIdempotencyArgs,
): Promise<void> {
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS);
  try {
    await prisma.idempotencyKey.create({
      data: {
        key: args.key,
        userId: args.userId,
        method: args.method.toUpperCase(),
        path: args.path,
        requestHash: args.requestHash,
        statusCode: args.statusCode,
        responseBody: args.responseBody as any,
        expiresAt,
      },
    });
  } catch (err: any) {
    // P2002 = unique constraint. The race-loser path. Silently swallow —
    // the first write won, future replays will see its payload.
    if (err?.code === 'P2002') return;
    throw err;
  }
}

/**
 * Scheduled cleanup — deletes every row whose TTL has elapsed.
 *
 * Designed to be called from a cron / scheduler once daily; cheap because
 * the `expiresAt` index makes the lookup direct. Returns the count so
 * ops can see "sweep deleted N rows" in logs.
 *
 * Safe to call at any time. Failure-tolerant: if the sweep itself errors
 * (DB unavailable), the next run picks up where this one left off.
 */
export async function purgeExpiredIdempotencyKeys(): Promise<{ deleted: number }> {
  const result = await prisma.idempotencyKey.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return { deleted: result.count };
}
