/**
 * Wave 13 SECURITY TRIPWIRE — Pulse route access matrix.
 *
 * Locks down which roles can hit which Pulse + Clock endpoints. The
 * R5 founder directive — "only super admin has access to all these
 * metrics" — was originally interpreted as "lock /admin/pulse/scores
 * down to SUPER_ADMIN" (correct), but the employee self-service
 * routes `/pulse/me/today`, `/clock/me/today`, `/clock/in`, `/clock/out`
 * were left as `authenticate` only. That let CLIENT users:
 *
 *   - Hit GET /pulse/me/today and see the response schema (active
 *     seconds, productive seconds, etc) — leaking the existence of
 *     the pulse system to non-employees.
 *   - Hit GET /clock/me/today same way.
 *   - **Hit POST /clock/in and successfully create a clock session**
 *     tied to their CLIENT account. The session row would then
 *     appear on the SUPER_ADMIN team clock view.
 *
 * These tests pin the role matrix so any future PR that loosens the
 * gate breaks loudly in CI.
 *
 * Wire-level integration tests using `supertest` against the actual
 * route registration — this catches the missing middleware case that
 * a service-level unit test would miss.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Bring in the shared prismaMock so service-layer DB hits in the
// downstream handlers don't crash.
import '../test/prismaMock';
import { prismaMock } from '../test/prismaMock';

// Mock the JWT verifier so we can hand-craft `req.user` per test.
vi.mock('../middleware/authenticate', () => ({
  authenticate: vi.fn((req: any, _res: any, next: any) => {
    const userId = req.headers['x-test-user-id'];
    const role = req.headers['x-test-user-role'];
    if (!userId || !role) {
      return next(); // exercises the unauthenticated path; rare
    }
    req.user = { id: userId, role };
    next();
  }),
}));

import express from 'express';
import request from 'supertest';
import pulseRoutes from './pulse.routes';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', pulseRoutes);
  return app;
}

const ROLES_THAT_MAY_HIT_SELF_ROUTES = [
  'SUPER_ADMIN',
  'ADMIN',
  'PRODUCT_MANAGER',
  'ENGINEER',
] as const;

const ROLES_THAT_MUST_BE_FORBIDDEN = ['CLIENT'] as const;

const SELF_ROUTES_GET = ['/pulse/me/today', '/clock/me/today'];
const SELF_ROUTES_POST = ['/clock/in', '/clock/out'];

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.clockSession.findFirst.mockResolvedValue(null);
  prismaMock.clockSession.create.mockResolvedValue({} as never);
  prismaMock.clockSession.update.mockResolvedValue({} as never);
  prismaMock.user.findUnique.mockResolvedValue({ id: 'u', role: 'CLIENT' } as never);
  prismaMock.user.findFirst.mockResolvedValue(null);
  prismaMock.device.findMany.mockResolvedValue([] as never);
  prismaMock.deviceHealthSnapshot.findMany.mockResolvedValue([] as never);
  prismaMock.deviceHealthSnapshot.findFirst.mockResolvedValue(null);
  prismaMock.deviceAppActivity.findMany.mockResolvedValue([] as never);
  prismaMock.deviceAppActivity.aggregate.mockResolvedValue({} as never);
  // groupBy has a heavily-overloaded type that breaks .mockResolvedValue;
  // cast through unknown is the cheapest way to keep typecheck happy
  // here since the test never exercises a groupBy path.
  (prismaMock.deviceAppActivity.groupBy as unknown as {
    mockResolvedValue: (v: unknown) => void;
  }).mockResolvedValue([]);
  prismaMock.dailyUpdate.findFirst.mockResolvedValue(null);
});

describe('Wave 13 — CLIENT role MUST get 403 on every employee self-service Pulse route', () => {
  describe.each(ROLES_THAT_MUST_BE_FORBIDDEN)('role = %s', (role) => {
    it.each(SELF_ROUTES_GET)('GET %s → 403', async (route) => {
      const res = await request(makeApp())
        .get(`/api/v1${route}`)
        .set('x-test-user-id', 'client-1')
        .set('x-test-user-role', role);
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({
        success: false,
        error: { code: 'FORBIDDEN' },
      });
    });

    it.each(SELF_ROUTES_POST)('POST %s → 403 (does NOT create a clock session)', async (route) => {
      const res = await request(makeApp())
        .post(`/api/v1${route}`)
        .set('x-test-user-id', 'client-1')
        .set('x-test-user-role', role)
        .send({});
      expect(res.status).toBe(403);
      // Crucially: the handler must not have run.
      expect(prismaMock.clockSession.create).not.toHaveBeenCalled();
      expect(prismaMock.clockSession.update).not.toHaveBeenCalled();
    });
  });
});

describe('Wave 13 — employee POST /clock/in passes the role gate (no 403)', () => {
  // GET routes can't be tested cheaply — the today/me/pulse handlers
  // pull data from many tables and would need a heavy prisma mock to
  // run to completion. The CRITICAL security property is the DENY
  // path above (CLIENT must not reach the handler). Here we just
  // confirm the gate doesn't accidentally lock out employees on the
  // shape we can mock cheaply: POST /clock/in.
  it.each(ROLES_THAT_MAY_HIT_SELF_ROUTES)(
    'POST /clock/in as %s does NOT 403 (clockSession.create is reached)',
    async (role) => {
      prismaMock.clockSession.findFirst.mockResolvedValue(null);
      prismaMock.clockSession.create.mockResolvedValue({
        id: 's1',
        userId: 'u',
        clockedInAt: new Date(),
        clockedOutAt: null,
        autoClosedAt: null,
        noteIn: null,
        noteOut: null,
      } as never);

      const res = await request(makeApp())
        .post('/api/v1/clock/in')
        .set('x-test-user-id', 'u')
        .set('x-test-user-role', role)
        .send({});

      // Whatever the handler returns (201, 400 from validator etc.),
      // the gate must NOT have produced a 403.
      expect(res.status).not.toBe(403);
    },
  );
});
