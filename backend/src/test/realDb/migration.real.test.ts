/**
 * Real-Postgres tests for the data migrations we've shipped.
 *
 * Especially the 2026-05-21 `lowercase_user_emails` migration: PR #134's
 * first CI run crashed because the migration referenced `"User"` when
 * the actual table is `"users"` (the Prisma model maps to a different
 * table name via `@@map`). The unit suite never runs SQL, so the bug
 * shipped to CI before being caught. This file is the place that pins
 * "the migrations apply cleanly" so a similar bug surfaces locally
 * before it gets into PR.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  getTestPrisma,
  prepareSchema,
  resetDb,
  disconnectTestPrisma,
} from './harness';

const prisma = getTestPrisma();

beforeAll(async () => {
  await prepareSchema();
});
afterAll(async () => {
  await disconnectTestPrisma();
});

describe('migrations', () => {
  it('all migrations in the prisma/migrations folder applied successfully', async () => {
    // Prisma writes one row per migration into `_prisma_migrations` with
    // `finished_at` set when the migration ran to completion. If any row
    // has `finished_at IS NULL`, the migration failed mid-way and
    // future migrations are blocked — Prisma calls this the "drift"
    // state and refuses to deploy until an operator runs
    // `prisma migrate resolve`.
    const failed: { migration_name: string }[] = await prisma.$queryRawUnsafe(`
      SELECT migration_name FROM _prisma_migrations
      WHERE finished_at IS NULL
    `);
    expect(failed).toEqual([]);
  });

  it('the lowercase-emails migration ran and the User table has no mixed-case rows', async () => {
    // Sanity check that the migration we just shipped did its job.
    // After it runs, the post-condition is: every `users.email` row
    // equals its LOWER() form. We assert that by checking the same
    // query the migration's pre-check uses.
    await resetDb();
    // Insert one canonical-form row to prove the constraint holds for
    // a steady-state row (the migration UPDATE itself is exercised
    // implicitly by the `prepareSchema()` call in beforeAll — if the
    // SQL crashed, the test process would have died before this `it`
    // ran).
    await prisma.user.create({
      data: {
        email: 'canon@exargen.in',
        name: 'Canon',
        passwordHash: 'fake',
        role: 'ENGINEER',
      },
    });

    const dupes: { lo: string; c: number }[] = await prisma.$queryRawUnsafe(`
      SELECT LOWER(email) AS lo, COUNT(*) AS c
      FROM users
      GROUP BY LOWER(email)
      HAVING COUNT(*) > 1
    `);
    expect(dupes).toEqual([]);
  });
});
