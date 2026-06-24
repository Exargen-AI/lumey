/**
 * Integration-test harness for the CC features (subscriptions,
 * nudge, encouragement, notifications, optimistic locking).
 *
 * Goal: exercise the FULL route → middleware → handler → service →
 * notify chain via supertest, using the same `prismaMock` deep-mock
 * the unit tests use. This catches things unit-test mocks miss:
 *
 *   - Validator-middleware rejection of malformed bodies
 *   - Route → handler wiring (a typo in a route param shows up here)
 *   - Error-handler mapping of thrown ConflictError / NotFoundError
 *   - Service composition across multiple modules in one request
 *     (e.g. createComment → mention parse → autoSubscribe → fan-out)
 *
 * What this DOESN'T cover (vs a real Postgres):
 *   - Actual SQL behavior (cascade deletes, indexes)
 *   - Transaction isolation
 *   - Real auth (token signing, tokenVersion, etc.)
 *
 * Those gaps are documented and addressed by Phase-3 (supertest +
 * throwaway Postgres on port 5433) in the original hardening plan.
 *
 * Auth shortcut: real `authenticate` middleware reads a JWT from
 * the Authorization header and looks up the user in Postgres. For
 * integration tests we replace it with `injectFakeUser` that takes
 * a user from the `X-Test-User` header (JSON-encoded). Keeps the
 * route stack intact except for the one piece we can't easily
 * simulate without a real DB + JWT.
 */

import express, { Request, Response, NextFunction, Router } from 'express';
import { vi } from 'vitest';
import { errorHandler } from '../middleware/errorHandler';
import type { User } from '@prisma/client';

/**
 * Replacement for `authenticate` middleware. Reads `X-Test-User` as
 * JSON and sets `req.user`. If the header is missing, returns 401
 * (matches the real middleware's behavior for unauthenticated
 * requests).
 */
function injectFakeUser(req: Request, res: Response, next: NextFunction) {
  const header = req.headers['x-test-user'];
  if (!header || typeof header !== 'string') {
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Missing X-Test-User header' },
    });
    return;
  }
  try {
    req.user = JSON.parse(header) as User;
    next();
  } catch {
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Invalid X-Test-User header (must be JSON)' },
    });
    return;
  }
}

/**
 * Build a minimal Express app that mounts the requested route
 * modules under `/api/v1`, with the real validator + error
 * middleware in place. The `authenticate` middleware is REPLACED
 * by `injectFakeUser` via `vi.mock` — call sites supply the user
 * per request via the `X-Test-User` header.
 *
 * `taskAccess` and `projectAccess` are also replaced with
 * pass-through versions because they hit Prisma in a way the
 * deep-mock doesn't always cover cleanly; the tests that care
 * about access-control are exercised separately in unit tests.
 * Integration tests focus on the feature wiring.
 *
 * Routes to mount: pass `[ '/api/v1', routerInstance ]` pairs.
 */
export function createTestApp(routerMounts: Array<[string, Router]>) {
  const app = express();
  app.use(express.json());
  routerMounts.forEach(([prefix, router]) => app.use(prefix, router));
  app.use(errorHandler);
  return app;
}

/**
 * Helper for tests that need a user object the shape of
 * `req.user`. Returns a minimal Prisma User with sensible defaults
 * — tests can override what they care about.
 */
export function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: overrides.id ?? 'user-1',
    email: overrides.email ?? 'user1@exargen.in',
    name: overrides.name ?? 'User One',
    passwordHash: 'fake',
    role: overrides.role ?? 'ENGINEER',
    company: null,
    isActive: true,
    isSeedData: false,
    tokenVersion: 0,
    failedLoginCount: 0,
    lockedUntil: null,
    lastLoginAt: null,
    userType: 'HUMAN',
    agentRole: null,
    agentSystemPromptPath: null,
    agentBudgetMonthlyUsdCents: null,
    agentActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  } as User;
}

/**
 * Encode a user object for the `X-Test-User` header.
 */
export function asAuthHeader(user: User): Record<string, string> {
  return { 'X-Test-User': JSON.stringify(user) };
}

/**
 * `vi.mock` shortcut for the auth + project-access middleware
 * stacks. Call from inside a test file BEFORE any imports of the
 * service / route modules.
 *
 * Why: the real `authenticate` middleware reads from Postgres to
 * validate `tokenVersion`. The real `taskAccess` / `projectAccess`
 * middleware do their own Prisma reads. Integration tests for
 * FEATURE LOGIC shouldn't have to mock all of those — they should
 * mock the auth boundary and trust feature-specific tests to
 * cover access-control.
 */
export function mockAuthAndAccessMiddleware() {
  vi.mock('../middleware/authenticate', () => ({
    __esModule: true,
    authenticate: injectFakeUser,
  }));
  vi.mock('../middleware/taskAccess', () => ({
    __esModule: true,
    taskAccess: (_req: Request, _res: Response, next: NextFunction) => next(),
  }));
  vi.mock('../middleware/projectAccess', () => ({
    __esModule: true,
    projectAccess: (_req: Request, _res: Response, next: NextFunction) => next(),
  }));
  vi.mock('../middleware/projectScopedResourceAccess', () => ({
    __esModule: true,
    projectScopedResourceAccess: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  }));
  vi.mock('../middleware/authorize', () => ({
    __esModule: true,
    authorize: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  }));
  vi.mock('../middleware/authorizeAny', () => ({
    __esModule: true,
    authorizeAny: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  }));
}
