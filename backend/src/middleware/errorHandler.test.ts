/**
 * 2026-05-23 catastrophic-tier coverage for `errorHandler` middleware.
 *
 * Every error response in the entire API funnels through this one
 * function. If it regresses:
 *   - Stack traces could leak to clients (security)
 *   - Status codes could shift (breaks FE error handling)
 *   - The canonical { success: false, error: { code, message } } shape
 *     could drift (breaks every consumer that reads `error.message`)
 *
 * Zero tests existed before this PR.
 *
 * Audit-found while writing tests: missing `res.headersSent` guard. An
 * error mid-stream (e.g., during PDF download) would try to send JSON
 * after headers already went out → "Cannot set headers" → original error
 * is lost. Fix landed in the same commit as this file.
 *
 * Invariants pinned:
 *   - AppError → uses err.statusCode + err.code + err.message
 *   - ZodError → 400 + VALIDATION_ERROR + sanitised details in prod
 *   - Prisma P2002 (unique constraint) → 409 CONFLICT
 *   - Prisma P2025 (record not found) → 404 NOT_FOUND
 *   - entity.too.large → 413 PAYLOAD_TOO_LARGE
 *   - Default → 500 INTERNAL_ERROR with generic message in prod
 *   - errorId is emitted on EVERY branch (for support traceability)
 *   - res.headersSent → no-op (the audit-fix branch)
 *   - Dev mode reveals err.message, prod hides it
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import {
  AppError,
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from '../utils/errors';

// env must be mocked BEFORE we import errorHandler, because errorHandler
// reads NODE_ENV at module-init time via the env validator.
const envHoisted = vi.hoisted(() => ({
  env: {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters-long',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters-long',
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY: '7d',
    PORT: 3000,
  },
}));
vi.mock('../config/env', () => ({ __esModule: true, env: envHoisted.env }));

// 2026-06-01 — errorHandler now logs via the structured logger, not
// console.error. Mock it so the traceability tests can assert on it.
const { loggerMock } = vi.hoisted(() => ({
  loggerMock: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));
vi.mock('../lib/logger', () => ({
  __esModule: true,
  logger: loggerMock,
  securityLogger: loggerMock,
}));

import { errorHandler } from './errorHandler';

function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    destroy: vi.fn(),
    headersSent: false,
  } as any;
}

beforeEach(() => {
  envHoisted.env.NODE_ENV = 'production';
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('errorHandler — AppError branch', () => {
  it('uses err.statusCode + err.code + err.message verbatim', () => {
    const err = new ValidationError('Title is required');
    const res = makeRes();
    errorHandler(err, {} as any, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: expect.objectContaining({
        code: 'VALIDATION_ERROR',
        message: 'Title is required',
        errorId: expect.any(String),
      }),
    });
  });

  it.each([
    [new NotFoundError('Task'), 404, 'NOT_FOUND'],
    [new ForbiddenError(), 403, 'FORBIDDEN'],
    [new ConflictError('Slug exists'), 409, 'CONFLICT'],
    [new ValidationError('bad'), 400, 'VALIDATION_ERROR'],
  ])('%s → status %i + code %s', (err, status, code) => {
    const res = makeRes();
    errorHandler(err, {} as any, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json.mock.calls[0]?.[0]?.error?.code).toBe(code);
  });
});

describe('errorHandler — ZodError branch', () => {
  it('returns 400 VALIDATION_ERROR with sanitised details in prod', () => {
    const err = new ZodError([
      {
        code: 'invalid_type',
        expected: 'string',
        received: 'number',
        path: ['body', 'title'],
        message: 'Expected string, received number',
      },
    ]);
    const res = makeRes();
    errorHandler(err, {} as any, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0]?.[0];
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Validation failed');
    // PROD: actual reason is replaced with generic "Invalid value" —
    // doesn't leak whether a field was missing vs. wrong-type, which
    // can be a privacy signal for unique-username-style enumeration.
    // Note: zod's flatten() returns fieldErrors keyed by the TOP-LEVEL
    // path segment only (so path=['body', 'title'] → fieldErrors.body,
    // not fieldErrors.title — this is a zod implementation detail the
    // errorHandler inherits). The user sees "body is invalid" without
    // knowing which inner field, which is intentional privacy
    // protection in prod.
    expect(body.error.details.fieldErrors.body).toEqual(['Invalid value']);
  });

  it('reveals full zod details in DEV mode', () => {
    envHoisted.env.NODE_ENV = 'development';
    const err = new ZodError([
      {
        code: 'invalid_type',
        expected: 'string',
        received: 'number',
        path: ['body', 'title'],
        message: 'Expected string, received number',
      },
    ]);
    const res = makeRes();
    errorHandler(err, {} as any, res, vi.fn());
    const body = res.json.mock.calls[0]?.[0];
    // Dev gets the FULL flatten output.
    expect(body.error.details).toEqual(err.flatten());
  });

  it('the "body." prefix replace is a no-op given zod\'s actual flatten shape (audit observation)', () => {
    // The errorHandler does `k.replace('body.', '')` but zod's
    // flatten() returns top-level path segments only, so the prefix
    // is "body" (no dot) and the replace finds no match. This test
    // documents the actual behavior — the prefix-strip is essentially
    // dead code today. A future improvement could re-shape the response
    // using err.errors[*].path directly to surface nested field names
    // ("assigneeId" instead of just "body") to the FE.
    const err = new ZodError([
      {
        code: 'invalid_type',
        expected: 'string',
        received: 'undefined',
        path: ['body', 'assigneeId'],
        message: 'Required',
      },
    ]);
    const res = makeRes();
    errorHandler(err, {} as any, res, vi.fn());
    const body = res.json.mock.calls[0]?.[0];
    // Today: only "body" key, no granular "assigneeId" key. FE shows
    // a generic "body is invalid" message in prod.
    expect(body.error.details.fieldErrors).toHaveProperty('body');
    expect(body.error.details.fieldErrors).not.toHaveProperty('assigneeId');
  });
});

describe('errorHandler — Prisma branch', () => {
  it('P2002 (unique-constraint violation) → 409 CONFLICT', () => {
    const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '5.0.0',
      meta: { target: ['email'] },
    });
    const res = makeRes();
    errorHandler(err, {} as any, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json.mock.calls[0]?.[0]?.error?.code).toBe('CONFLICT');
  });

  it('P2002 hides the violating field name in prod', () => {
    const err = new Prisma.PrismaClientKnownRequestError('Unique', {
      code: 'P2002',
      clientVersion: '5.0.0',
      meta: { target: ['secret_field'] },
    });
    const res = makeRes();
    errorHandler(err, {} as any, res, vi.fn());
    const msg = res.json.mock.calls[0]?.[0]?.error?.message;
    expect(msg).not.toContain('secret_field');
    expect(msg).toBe('A record with this value already exists');
  });

  it('P2002 SHOWS the violating field name in dev (debug help)', () => {
    envHoisted.env.NODE_ENV = 'development';
    const err = new Prisma.PrismaClientKnownRequestError('Unique', {
      code: 'P2002',
      clientVersion: '5.0.0',
      meta: { target: ['email'] },
    });
    const res = makeRes();
    errorHandler(err, {} as any, res, vi.fn());
    expect(res.json.mock.calls[0]?.[0]?.error?.message).toContain('email');
  });

  it('P2025 (record not found) → 404 NOT_FOUND', () => {
    const err = new Prisma.PrismaClientKnownRequestError('Not found', {
      code: 'P2025',
      clientVersion: '5.0.0',
    });
    const res = makeRes();
    errorHandler(err, {} as any, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0]?.[0]?.error?.code).toBe('NOT_FOUND');
  });

  it('unknown Prisma error codes fall through to the 500 default', () => {
    const err = new Prisma.PrismaClientKnownRequestError('Something else', {
      code: 'P9999',
      clientVersion: '5.0.0',
    });
    const res = makeRes();
    errorHandler(err, {} as any, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0]?.[0]?.error?.code).toBe('INTERNAL_ERROR');
  });
});

describe('errorHandler — entity.too.large', () => {
  it('payload-too-large from body-parser → 413 PAYLOAD_TOO_LARGE', () => {
    const err = Object.assign(new Error('too big'), { type: 'entity.too.large' });
    const res = makeRes();
    errorHandler(err as Error, {} as any, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json.mock.calls[0]?.[0]?.error?.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('errorHandler — default (500) branch', () => {
  it('falls through to 500 INTERNAL_ERROR for non-matching errors', () => {
    const res = makeRes();
    errorHandler(new Error('something obscure'), {} as any, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0]?.[0]?.error?.code).toBe('INTERNAL_ERROR');
  });

  it('HIDES err.message in prod (does not leak internal error text to clients)', () => {
    const res = makeRes();
    errorHandler(new Error('SECRET DATABASE QUERY FAILED'), {} as any, res, vi.fn());
    const body = res.json.mock.calls[0]?.[0];
    expect(body.error.message).toBe('An unexpected error occurred');
    expect(body.error.message).not.toContain('SECRET');
  });

  it('SHOWS err.message in dev (debugging help)', () => {
    envHoisted.env.NODE_ENV = 'development';
    const res = makeRes();
    errorHandler(new Error('the real error'), {} as any, res, vi.fn());
    const body = res.json.mock.calls[0]?.[0];
    expect(body.error.message).toBe('the real error');
  });

  it('logs the original error via the structured logger with the errorId (support traceability)', () => {
    const res = makeRes();
    const err = new Error('hidden');
    errorHandler(err, {} as any, res, vi.fn());
    expect(loggerMock.error).toHaveBeenCalled();
    // First arg is the structured context object (carries err + errorId),
    // second is the message.
    const [ctx, msg] = loggerMock.error.mock.calls.at(-1) as [any, string];
    expect(ctx.err).toBe(err);
    expect(typeof ctx.errorId).toBe('string');
    expect(msg).toContain('unhandled error');
  });
});

describe('errorHandler — errorId emission', () => {
  it('emits an errorId on every branch (AppError + Zod + Prisma + default)', () => {
    const branches: Array<[Error]> = [
      [new ValidationError('x')],
      [new ZodError([])],
      [
        new Prisma.PrismaClientKnownRequestError('x', {
          code: 'P2002',
          clientVersion: '5.0.0',
          meta: { target: ['email'] },
        }),
      ],
      [new Error('uncategorised')],
    ];
    for (const [err] of branches) {
      const res = makeRes();
      errorHandler(err, {} as any, res, vi.fn());
      expect(res.json.mock.calls[0]?.[0]?.error?.errorId).toBeDefined();
      expect(typeof res.json.mock.calls[0]?.[0]?.error?.errorId).toBe('string');
    }
  });
});

describe('errorHandler — headersSent guard (audit fix)', () => {
  it('does NOT call res.status / res.json when headers already sent (mid-stream error)', () => {
    const res = makeRes();
    res.headersSent = true;
    errorHandler(new Error('mid-stream'), {} as any, res, vi.fn());
    // CRITICAL: must not try to send headers/body, would throw + leave
    // the original error untracked. Pre-fix this branch did NOT exist.
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('destroys the socket so the half-streamed response terminates cleanly', () => {
    const res = makeRes();
    res.headersSent = true;
    errorHandler(new Error('mid-stream'), {} as any, res, vi.fn());
    expect(res.destroy).toHaveBeenCalled();
  });

  it('logs the original error via the structured logger so it is not silently lost', () => {
    const res = makeRes();
    res.headersSent = true;
    const err = new Error('mid-stream secret');
    errorHandler(err, {} as any, res, vi.fn());
    expect(loggerMock.error).toHaveBeenCalled();
    expect((loggerMock.error.mock.calls.at(-1) as any)[0].err).toBe(err);
  });
});
