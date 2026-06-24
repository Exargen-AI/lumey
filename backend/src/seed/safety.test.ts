/**
 * 2026-05-15 SEED-SAFETY AUDIT regression tests.
 *
 * Pre-fix the seed entry point had no environment guard — anyone with
 * DATABASE_URL pointed at production could run `npm run seed` and
 * silently insert demo users / projects / tasks / milestones / decisions.
 *
 * These tests pin the production-detection helper. The full main() path
 * also wires this helper, but unit-testing main() requires mocking
 * Prisma + every seed function; the helper's logic is the actual
 * security boundary, so we test it directly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
// Import from `./safety` directly — NOT from `./index`. The index
// transitively imports `../config/database`, which loads
// `../config/env` and `process.exit(1)`s when DATABASE_URL +
// JWT_*_SECRET are missing (e.g. in CI unit-test runs). The safety
// helper has zero transitive dependencies, so it's safely testable
// in any environment.
import { isProductionEnvironment } from './safety';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_DB_URL = process.env.DATABASE_URL;

beforeEach(() => {
  // Start each test with a clean slate. Restore in afterEach so the
  // test file doesn't leak side effects into the rest of the suite.
  delete process.env.NODE_ENV;
  delete process.env.DATABASE_URL;
});

afterEach(() => {
  if (ORIGINAL_NODE_ENV !== undefined) process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  else delete process.env.NODE_ENV;
  if (ORIGINAL_DB_URL !== undefined) process.env.DATABASE_URL = ORIGINAL_DB_URL;
  else delete process.env.DATABASE_URL;
});

describe('isProductionEnvironment — primary NODE_ENV check', () => {
  it('returns isProd=true when NODE_ENV is exactly "production"', () => {
    process.env.NODE_ENV = 'production';

    const result = isProductionEnvironment();

    expect(result.isProd).toBe(true);
    expect(result.reason).toBe('NODE_ENV=production');
  });

  it('returns isProd=false when NODE_ENV is "development"', () => {
    process.env.NODE_ENV = 'development';

    expect(isProductionEnvironment().isProd).toBe(false);
  });

  it('returns isProd=false when NODE_ENV is "test" (CI runs)', () => {
    process.env.NODE_ENV = 'test';

    expect(isProductionEnvironment().isProd).toBe(false);
  });

  it('returns isProd=false when NODE_ENV is unset (local dev default)', () => {
    delete process.env.NODE_ENV;

    expect(isProductionEnvironment().isProd).toBe(false);
  });
});

describe('isProductionEnvironment — defense-in-depth DATABASE_URL sniff', () => {
  // Pivotal scenario: developer accidentally exports the prod DATABASE_URL
  // into their shell + runs `npm run seed`. NODE_ENV is still
  // "development" (their local config). The DB_URL hint catches it.

  it('catches AWS RDS production URLs even when NODE_ENV is not production', () => {
    process.env.NODE_ENV = 'development';
    process.env.DATABASE_URL = 'postgresql://user:pass@prod-cluster.cluster-abc.us-east-1.rds.amazonaws.com:5432/main';

    const result = isProductionEnvironment();
    expect(result.isProd).toBe(true);
    expect(result.reason).toContain('amazonaws.com');
  });

  it('catches Render hosted DBs', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@dpg-abc.oregon-postgres.render.com/db';

    expect(isProductionEnvironment().isProd).toBe(true);
  });

  it('catches Supabase hosted DBs', () => {
    process.env.DATABASE_URL = 'postgresql://postgres:pass@db.abc.supabase.co:5432/postgres';

    expect(isProductionEnvironment().isProd).toBe(true);
  });

  it('catches Neon hosted DBs', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@ep-cool-name-123.us-east-2.aws.neon.tech/db';

    expect(isProductionEnvironment().isProd).toBe(true);
  });

  it('does NOT flag localhost URLs (regular dev)', () => {
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/exargen';

    expect(isProductionEnvironment().isProd).toBe(false);
  });

  it('does NOT flag the test DB on port 5433 (integration tests)', () => {
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5433/exargen_test';

    expect(isProductionEnvironment().isProd).toBe(false);
  });

  it('does NOT flag 127.0.0.1 or docker-compose hosts', () => {
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/exargen';

    expect(isProductionEnvironment().isProd).toBe(false);
  });
});

describe('isProductionEnvironment — NODE_ENV takes precedence over URL sniff', () => {
  it('returns isProd=true with NODE_ENV reason even when URL also matches', () => {
    // Belt-and-suspenders: NODE_ENV=production + a prod-looking URL
    // should produce the NODE_ENV reason (the primary signal). The URL
    // sniff is the backup that only kicks in when NODE_ENV is wrong.
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_URL = 'postgresql://user:pass@db.supabase.co/db';

    const result = isProductionEnvironment();
    expect(result.isProd).toBe(true);
    expect(result.reason).toBe('NODE_ENV=production');
  });
});
