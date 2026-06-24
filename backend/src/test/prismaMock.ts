import { beforeEach, vi } from 'vitest';
import { mockDeep, mockReset, type DeepMockProxy } from 'vitest-mock-extended';
import type { PrismaClient } from '@prisma/client';

/**
 * Phase 2 of the baseline hardening plan. Shared Prisma mock for the
 * backend unit-test suite.
 *
 * How it works:
 *
 * 1. `vitest-mock-extended` walks the `PrismaClient` type via TS and
 *    generates a deep mock — every model and method is typed and
 *    callable, returning `undefined` until you stub it with
 *    `prismaMock.user.findUnique.mockResolvedValue(...)`.
 *
 * 2. `vi.mock('../config/database', ...)` re-routes every service file's
 *    `import prisma from '../config/database'` to the same mock instance.
 *    Tests + services see the same object, so per-test `mockResolvedValue`
 *    calls are visible to the code under test.
 *
 * 3. `mockReset(prismaMock)` runs before each test so stubs from one test
 *    don't bleed into the next.
 *
 * Used by every backend service test. Integration tests (Phase 3) will
 * use a real throwaway Postgres instead — that's where transaction-level
 * + cross-table behavior gets exercised.
 */
export const prismaMock: DeepMockProxy<PrismaClient> = mockDeep<PrismaClient>();

vi.mock('../config/database', () => ({
  __esModule: true,
  default: prismaMock,
}));

beforeEach(() => {
  mockReset(prismaMock);
});
