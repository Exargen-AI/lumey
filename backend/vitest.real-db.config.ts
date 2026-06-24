import { defineConfig } from 'vitest/config';

/**
 * Vitest config for the Phase-3 real-DB integration suite.
 *
 * Lives in a SEPARATE config from `vitest.config.ts` so:
 *
 *   1. The default `npm run test` (unit + supertest with mocks) doesn't
 *      try to hit Postgres on 5433 and crash on every dev box that
 *      hasn't booted `docker-compose.test.yml`.
 *   2. CI runs the real-DB job as a distinct workflow step, can fail
 *      independently, and surfaces a separate row in the PR check list.
 *
 * Test file naming: `*.real.test.ts` so the include glob is unambiguous.
 * A file named `foo.test.ts` is a unit test; `foo.real.test.ts` is a
 * real-DB integration test.
 *
 * Run locally:
 *
 *     docker compose -f ../docker-compose.test.yml up -d
 *     npm run test:real-db
 *
 * Or one-shot via the wrapper script:
 *
 *     npm run test:real-db:ci          # boots + runs + tears down
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.real.test.ts'],
    // Hermetic suite: each test resets the DB. Run files serially so two
    // resetDb()s don't race across workers truncating each other's setup.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    // Real Postgres + migrate deploy on first run takes time. Give each
    // test 30s (vs 15s for unit) so a slow CI runner doesn't flake.
    testTimeout: 30_000,
    // Coverage is owned by the unit job (vitest.config.ts). This config
    // intentionally has no coverage block — its job is correctness via
    // a real DB, not raising line coverage.
  },
});
