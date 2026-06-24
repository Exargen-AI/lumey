import { Request, Response, NextFunction } from 'express';
import {
  computeRequestHash,
  lookupIdempotencyKey,
  storeIdempotentResponse,
  MAX_KEY_LENGTH,
} from '../services/idempotency.service';
import { logger } from '../lib/logger';

/**
 * 2026-05-23 — Layer 2 / agent control plane.
 *
 * Express middleware that implements Idempotency-Key handling. Place
 * AFTER `authenticate` (so we have `req.user`) and BEFORE the route
 * handler. Reads the optional `Idempotency-Key` header on
 * POST/PATCH/PUT/DELETE requests.
 *
 * Behavior:
 *
 *   • No header           → pass through unchanged. (Backwards-compat —
 *                            existing clients don't have to opt in.)
 *   • Header on GET/HEAD/ → pass through (read-only requests don't
 *     OPTIONS                 need idempotency; clients can just retry).
 *   • Invalid key shape   → 400 BAD_REQUEST. Empty / too-long keys are
 *                            client bugs, not retries.
 *   • Hash mismatch       → 422 (ConflictError from the service layer).
 *                            Client reused a key with a different body.
 *   • Cache HIT (same hash) → REPLAY: send the stored status + body,
 *                              do NOT call the handler. The original
 *                              side effects already happened.
 *   • Cache MISS          → wrap res.json so we can capture the response
 *                            after the handler resolves, then persist.
 *
 * The middleware is route-agnostic — apply it broadly via `app.use(...)`
 * or per-router. The lookup is a single indexed query (cheap), so
 * applying it everywhere doesn't hurt latency materially.
 *
 * What is NOT covered:
 *
 *   - Streaming responses (PDF download, ZIP archive). The middleware
 *     skips these because we can't reliably capture + replay a stream.
 *     Streaming endpoints don't typically need idempotency anyway
 *     (they're reads).
 *   - Multi-status responses (websocket upgrade, etc.). Same reason.
 *
 * Design philosophy:
 *
 *   - Opt-in, not opt-out. A client without the header gets the legacy
 *     behavior. Required to keep migration painless and not break the FE.
 *   - Per-user scoping. Two agents using the same string key get
 *     independent dedupes — keys aren't a global namespace.
 *   - Path is templated (`/api/v1/projects/:id/tasks`) rather than
 *     resolved (`/api/v1/projects/abc/tasks`) so a retry on the SAME
 *     logical mutation dedupes regardless of resource id.
 */

const KEY_HEADER = 'idempotency-key';

/**
 * Pulls the template path off the request. Express puts the matched
 * template on `req.route?.path`. When the middleware fires AFTER the
 * router has matched (the typical case), this gives us
 * `/projects/:id/tasks` instead of `/projects/abc/tasks`. Falls back to
 * the resolved URL if the template isn't available (defense-in-depth —
 * the dedup is then per-resource, not per-template, which is still
 * correct, just less aggressive).
 */
function getTemplatedPath(req: Request): string {
  const template = req.route?.path;
  if (typeof template === 'string' && template.length > 0) {
    const basePath = req.baseUrl ?? '';
    return `${basePath}${template}`;
  }
  return req.originalUrl ?? req.url ?? '/';
}

/**
 * Validates the key value. We accept any opaque string from 1 to
 * MAX_KEY_LENGTH characters. Stripe uses UUIDs; we don't enforce a
 * specific shape because clients in different languages have different
 * preferred UUID libraries.
 */
function validateKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_KEY_LENGTH) return null;
  return trimmed;
}

/**
 * Methods on which the middleware activates. Read-only methods bypass.
 */
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function idempotencyKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Skip read-only methods entirely.
  if (!STATE_CHANGING_METHODS.has(req.method.toUpperCase())) {
    return next();
  }

  // Opt-in via header. No header → legacy behavior.
  const rawKey = req.header(KEY_HEADER);
  if (!rawKey) return next();

  const key = validateKey(rawKey);
  if (!key) {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: `Idempotency-Key must be a non-empty string up to ${MAX_KEY_LENGTH} characters.`,
      },
    });
    return;
  }

  // Idempotency is per-user. Without auth, there's no scope; we'd let
  // two unrelated clients collide. The middleware MUST be mounted after
  // `authenticate`, but defend in case anyone re-orders the stack.
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
    });
    return;
  }

  const method = req.method.toUpperCase();
  const path = getTemplatedPath(req);
  const requestHash = computeRequestHash(method, path, req.body);

  try {
    const hit = await lookupIdempotencyKey({
      key,
      userId: req.user.id,
      method,
      path,
      requestHash,
    });

    if (hit) {
      // Cache hit + matching hash → REPLAY.
      // The X-Idempotent-Replay header signals to the client that this
      // response was served from cache (Stripe sends a similar
      // `Idempotency-Status: replayed` header). Useful for debugging
      // "why didn't my new request hit the database".
      res.setHeader('X-Idempotent-Replay', 'true');
      res.status(hit.statusCode).json(hit.responseBody);
      return;
    }

    // Cache miss — let the handler run, but wrap res.json so we capture
    // the response. The wrapping has to be transparent: the handler
    // should still observe its own res.json call as having succeeded.
    const originalJson = res.json.bind(res);
    let captured = false;
    res.json = ((body: unknown) => {
      // First call wins (handlers don't chain res.json normally, but
      // defend anyway — a double-call would otherwise double-store).
      if (!captured) {
        captured = true;
        // Status defaults to 200 if the handler didn't set one before
        // calling .json(). Capture whatever the response writer thinks
        // is the current status.
        const statusCode = res.statusCode || 200;
        // Fire-and-forget the persist. We don't want to block the
        // response on storage; if storage fails, the client still
        // got its real response, and the worst case is the next retry
        // doesn't dedup (which is a benign cache miss, not a bug).
        void storeIdempotentResponse({
          key,
          userId: req.user!.id,
          method,
          path,
          requestHash,
          statusCode,
          responseBody: body,
        }).catch((err) => {
          // Log so ops can see if there's a sustained storage problem,
          // but never bubble up — the user's request already completed.
          // eslint-disable-next-line no-console
          logger.warn({ err: err?.message ?? err, }, '[idempotency] failed to persist response (request still succeeded):');
        });
      }
      return originalJson(body);
    }) as typeof res.json;

    next();
  } catch (err) {
    // ConflictError (key reused with different body) and any other
    // service-layer error flows through to errorHandler.
    next(err);
  }
}
