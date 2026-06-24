/**
 * Pulse Multi-Signal Productivity Score — access gate (R5 lockdown).
 *
 * Founder directive 2026-05-29 (post-merge of Waves 1+2):
 *
 *   > "remember only super admin has access to all these metrics
 *      right?, make sure only super admin is allowed"
 *
 * This OVERRIDES design Premise P6 which previously said employees
 * could see their own composite + breakdown on TodayPage. The new
 * policy is: **only SUPER_ADMIN** sees productivity-score data. Full
 * stop. No `/me/productivity` endpoint, no employee self-view, no
 * "see your own score" widget. Wave 6 frontend ships SUPER_ADMIN-only.
 *
 * Why this middleware exists in its own file (and not just an inline
 * `requireRoles('SUPER_ADMIN')` on each route):
 *
 *   1. **Explicit intent.** When you `import { requireProductivityScoreAccess }`
 *      and slap it on a route, the name documents WHY it's there. A
 *      generic `requireRoles('SUPER_ADMIN')` could be loosened later
 *      ("oh let's allow ADMIN too") without anyone realising it now
 *      controls performance-review-grade data. This guard is named
 *      after the resource it protects.
 *
 *   2. **Default-deny posture.** Every productivity-score endpoint
 *      MUST go through this middleware. We pair it with a runtime
 *      audit-log check (see `requireProductivityScoreAccessGuard` in
 *      `lib/productivityScoreAccess.ts`) so even a service method
 *      called from a NON-Express context (job runner, MCP tool, etc.)
 *      goes through the same gate.
 *
 *   3. **Tripwire tests.** The companion test file pins the gate on
 *      every existing productivity-score route. Adding a new route
 *      without this middleware will break the test deliberately.
 *
 * Future expansion: if the access policy is ever relaxed (e.g.
 * employees see their own band but not the breakdown), CHANGE THIS
 * MIDDLEWARE only. Routes stay the same; the gate's interpretation of
 * "allowed" evolves. The tests at the bottom of this comment will
 * still pin the routes.
 */

import { Request, Response, NextFunction } from 'express';

/**
 * Productivity-score endpoint access gate.
 *
 * Returns 401 if no authenticated user. Returns 403 with a specific
 * error code if the user is authenticated but not SUPER_ADMIN. The
 * error code (`PRODUCTIVITY_SCORE_FORBIDDEN`) is distinct from generic
 * role-check 403s so log-search + audit tooling can flag attempted
 * cross-employee score peeks as security events.
 */
export function requireProductivityScoreAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.user) {
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
    });
    return;
  }

  if (req.user.role !== 'SUPER_ADMIN') {
    // Distinct error code so SUPER_ADMIN-only resources stand out in
    // logs. A bad actor probing for misconfigured endpoints will
    // show as `PRODUCTIVITY_SCORE_FORBIDDEN` repeatedly, not get
    // lost in the noise of generic 403s.
    res.status(403).json({
      success: false,
      error: {
        code: 'PRODUCTIVITY_SCORE_FORBIDDEN',
        message:
          'Pulse productivity scores are SUPER_ADMIN-only. This includes per-employee composite scores, breakdowns, raw events, weight sets, and dispute records.',
      },
    });
    return;
  }

  next();
}

/**
 * Service-layer guard for productivity-score reads called from
 * non-Express contexts (background workers, MCP tools, integration
 * test harnesses). Throws if `user` is not a SUPER_ADMIN. The
 * exception is type-narrowed so callers don't have to re-check.
 *
 * Usage:
 *
 *   import { assertProductivityScoreAccess } from '../middleware/requireProductivityScoreAccess';
 *
 *   export async function getCompositeScore(userId: string, requestor: { role: string }) {
 *     assertProductivityScoreAccess(requestor);
 *     // ... safe to read here
 *   }
 */
export function assertProductivityScoreAccess(user: {
  role: string;
} | null | undefined): asserts user is { role: 'SUPER_ADMIN' } {
  if (!user) {
    throw new ProductivityScoreAccessError('Not authenticated');
  }
  if (user.role !== 'SUPER_ADMIN') {
    throw new ProductivityScoreAccessError(
      'Pulse productivity scores are SUPER_ADMIN-only',
    );
  }
}

/**
 * Distinct error class so callers can `catch (err instanceof ...)` and
 * map to HTTP 403 with the right error code, even when the throw
 * comes from a service method.
 */
export class ProductivityScoreAccessError extends Error {
  readonly code = 'PRODUCTIVITY_SCORE_FORBIDDEN' as const;
  readonly statusCode = 403 as const;
  constructor(message: string) {
    super(message);
    this.name = 'ProductivityScoreAccessError';
  }
}
