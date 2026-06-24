/**
 * Phase-3 harness — real Postgres on port 5433.
 *
 * The integration tests in this folder run against a THROWAWAY Postgres
 * instance, not the `prismaMock` deep mock. They exist to catch the class
 * of bugs that mocks cannot:
 *
 *   1. **SQL constraint behavior.** Cascade deletes, ON DELETE SET NULL,
 *      check constraints, unique-index case-sensitivity (the prod bug
 *      we just fixed!). The mock returns whatever you stub it with — it
 *      can't tell you that a foreign-key FK violation would have happened.
 *
 *   2. **Migration correctness.** The mock never runs SQL, so a
 *      migration that references the wrong table name (the PR #134
 *      "User" vs "users" bug) sails through the unit suite and only
 *      crashes when Postgres actually tries to apply it.
 *
 *   3. **Transaction isolation.** Concurrent writes that should serialize.
 *      The mock's $transaction is a single-threaded pass-through.
 *
 *   4. **Timestamp arithmetic.** `lockedUntil <= NOW()`, the 24-hour
 *      nudge cooldown, etc. Stubs make these trivial; real time + real
 *      Postgres clock can surface ordering bugs.
 *
 * How it works:
 *
 *   - `getTestPrisma()` returns a singleton PrismaClient pointed at
 *     `DATABASE_URL_TEST` (default `postgresql://postgres:postgres@localhost:5433/exargen_cc_test`).
 *   - `prepareSchema()` runs `prisma migrate deploy` once per test-process
 *     so every test file sees the latest schema. Idempotent; no-op when
 *     migrations are already applied.
 *   - `resetDb()` truncates every user-data table between tests so they
 *     don't see each other's writes. Uses TRUNCATE ... RESTART IDENTITY
 *     CASCADE so sequence values don't bleed either. Tests OPT IN by
 *     calling `await resetDb()` in their own `beforeEach` — keeps the
 *     harness explicit.
 *
 * What this DOESN'T do (deliberately):
 *
 *   - Doesn't seed data. Each test sets up exactly what it needs. The
 *     seed script targets the dev / Playwright DB; the real-DB suite
 *     is supposed to be a hermetic island.
 *   - Doesn't start the Express app. Tests import services + Prisma
 *     directly. Routing + middleware is covered by the supertest-based
 *     integration suite that uses prismaMock.
 */

import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';
import path from 'node:path';

const DEFAULT_URL =
  'postgresql://postgres:postgres@localhost:5433/exargen_cc_test';

let _client: PrismaClient | null = null;
let _schemaReady = false;

/**
 * Resolve the test DB URL. Order:
 *   1. `DATABASE_URL_TEST` — explicit override (CI sets this).
 *   2. `DATABASE_URL` — fallback ONLY if it points at port 5433 (a guard
 *      against accidentally truncating the dev DB).
 *   3. The hardcoded default.
 */
function resolveUrl(): string {
  const fromExplicit = process.env.DATABASE_URL_TEST;
  if (fromExplicit) return fromExplicit;

  const fromMain = process.env.DATABASE_URL;
  if (fromMain && /:5433\//.test(fromMain)) return fromMain;

  return DEFAULT_URL;
}

export function getTestPrisma(): PrismaClient {
  if (_client) return _client;
  const datasourceUrl = resolveUrl();
  _client = new PrismaClient({ datasourceUrl });
  return _client;
}

/**
 * Run `prisma migrate deploy` against the test DB. Cached after the first
 * call in this process — re-running is fast (Prisma checks `_prisma_migrations`)
 * but still adds ~200ms we don't need on every test file.
 */
export async function prepareSchema(): Promise<void> {
  if (_schemaReady) return;
  const url = resolveUrl();
  const backendDir = path.resolve(__dirname, '../../..');
  // Inherit stdout so a migration failure shows up in the test log
  // verbatim — much easier to diagnose than a swallowed error.
  execSync('npx prisma migrate deploy', {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
  _schemaReady = true;
}

/**
 * Truncate every user-data table. Tables are discovered from the
 * `pg_tables` catalog so we don't have to maintain a hardcoded list
 * (Prisma migrations add new tables frequently). Excludes
 * `_prisma_migrations` (re-running it would cost a migrate deploy).
 *
 * RESTART IDENTITY makes generated UUID / serial sequences start fresh.
 * CASCADE handles FK chains so we don't have to truncate in dependency
 * order.
 */
export async function resetDb(): Promise<void> {
  const prisma = getTestPrisma();
  const rows: { tablename: string }[] = await prisma.$queryRawUnsafe(`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename NOT IN ('_prisma_migrations')
  `);
  if (rows.length === 0) return;
  const list = rows.map((r) => `"${r.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`,
  );
}

/**
 * Disconnect the singleton client at the end of a test process.
 * Call from a top-level `afterAll` if you care about clean shutdown
 * (Vitest tolerates an orphaned connection but it produces noisy
 * "unfinished work" warnings).
 */
export async function disconnectTestPrisma(): Promise<void> {
  if (_client) {
    await _client.$disconnect();
    _client = null;
  }
}
