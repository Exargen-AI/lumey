/**
 * Seed-safety helper — extracted into its own file so it can be unit-
 * tested WITHOUT triggering the env-validation chain in
 * `src/config/env.ts` (which `process.exit(1)`s when DATABASE_URL +
 * JWT_*_SECRET aren't set, e.g. in CI unit-test runs).
 *
 * `src/seed/index.ts` imports `prisma` (which loads env), so importing
 * the seed entry point from a test exits the vitest worker. Keeping
 * the security boundary in this file isolates the testable logic.
 */

/**
 * Detect whether we're running against a production database — both
 * via the explicit NODE_ENV signal AND via a defense-in-depth sniff
 * of the DATABASE_URL hostname (catches misconfigured env where
 * NODE_ENV is wrong but DATABASE_URL points at the real DB).
 *
 * Used by the seed entry point to gate the DEMO phase (users,
 * projects, tasks, milestones, decisions) without blocking the
 * REFERENCE phase (permissions, course taxonomy, agent users).
 */
export function isProductionEnvironment(): { isProd: boolean; reason: string } {
  if (process.env.NODE_ENV === 'production') {
    return { isProd: true, reason: 'NODE_ENV=production' };
  }
  // Defense-in-depth: even if NODE_ENV is misconfigured, refuse to
  // seed demo data into a database URL that smells like production.
  // Catches the "developer accidentally exported prod DATABASE_URL
  // into their shell" footgun.
  const dbUrl = process.env.DATABASE_URL ?? '';
  const prodHostHints = [
    'amazonaws.com',
    'render.com',
    'railway.app',
    'supabase.co',
    'neon.tech',
    'planetscale',
  ];
  for (const hint of prodHostHints) {
    if (dbUrl.includes(hint)) {
      return { isProd: true, reason: `DATABASE_URL contains "${hint}" — looks like production` };
    }
  }
  return { isProd: false, reason: '' };
}
