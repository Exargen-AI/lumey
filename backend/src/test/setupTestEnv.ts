/**
 * Vitest global setup for the UNIT suite (2026-06-01 hardening).
 *
 * `config/env` validates `process.env` at module-load time and calls
 * `process.exit(1)` if DATABASE_URL or the JWT secrets are missing. The
 * unit suite mocks Prisma (`src/test/prismaMock` re-routes
 * `config/database`), which used to break the only chain that reached
 * `config/env` — so env was never loaded and the missing vars never
 * mattered.
 *
 * The observability work added `lib/logger`, which imports `config/env`
 * DIRECTLY. Every service that now logs pulls env in through a path the
 * Prisma mock doesn't intercept, so in an env-less environment (CI's unit
 * job) `config/env` validation fails and the suite dies with
 * "process.exit unexpectedly called with 1".
 *
 * Fix: seed the minimum env the validator requires BEFORE any test module
 * loads. `??=` preserves anything already set (a developer's real shell
 * env, or the integration job — which uses the SEPARATE
 * vitest.real-db.config.ts and sets real connection vars). These values
 * are never used to actually connect: Prisma is mocked in the unit suite.
 * They exist purely to satisfy the load-time zod validation.
 */
process.env.NODE_ENV ??= 'test';
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/cc_unit_test';
process.env.JWT_ACCESS_SECRET ??= 'unit-test-access-secret-not-used-in-prod-0000000';
process.env.JWT_REFRESH_SECRET ??= 'unit-test-refresh-secret-not-used-in-prod-000000';

export {};
