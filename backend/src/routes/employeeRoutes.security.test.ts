/**
 * Wave 13 SECURITY TRIPWIRE — every CLIENT-must-be-forbidden route.
 *
 * Pre-Wave-13 ALL of these were `authenticate` only and let CLIENT
 * users hit them. The leaks were:
 *
 *   - POST /clock/in            → CLIENT clocked into time tracking
 *   - GET  /clock/me/today      → schema leak
 *   - GET  /pulse/me/today      → schema leak (pulse module existence)
 *   - POST /daily-updates       → CLIENT created standup rows +
 *                                  productivity events (real damage)
 *   - GET  /daily-updates/mine* → schema leak
 *   - POST /leaves              → CLIENT created leave applications,
 *                                  polluting the SUPER_ADMIN queue
 *   - GET  /leaves/my           → schema leak
 *
 * These tests pin the deny path so any future loosening of any of
 * these routes breaks CI loudly.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import '../test/prismaMock';
import { prismaMock } from '../test/prismaMock';

// Mock authenticate so we can hand-craft `req.user.role` per test.
vi.mock('../middleware/authenticate', () => ({
  authenticate: vi.fn((req: any, _res: any, next: any) => {
    const role = req.headers['x-test-user-role'];
    if (!role) return next();
    req.user = { id: 'test-user', role };
    next();
  }),
}));

import express from 'express';
import request from 'supertest';
import pulseRoutes from './pulse.routes';
import dailyUpdateRoutes from './dailyUpdate.routes';
import leaveRoutes from './leave.routes';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', pulseRoutes);
  app.use('/api/v1', dailyUpdateRoutes);
  app.use('/api/v1', leaveRoutes);
  return app;
}

const CLIENT_FORBIDDEN_GETS = [
  '/pulse/me/today',
  '/clock/me/today',
  '/daily-updates/mine',
  '/daily-updates/mine/streak',
  '/daily-updates/mine/stats',
  '/daily-updates/mine/today',
  '/leaves/my',
  '/leaves/some-id', // single-record route
];

const CLIENT_FORBIDDEN_POSTS = [
  ['/clock/in', {}],
  ['/clock/out', {}],
  ['/daily-updates', { summary: 'trying' }],
  ['/leaves', { startDate: '2026-06-01', endDate: '2026-06-02', leaveType: 'CASUAL' }],
  ['/leaves/some-id/cancel', {}],
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  // Defensive prisma stubs so no test can accidentally hit real DB.
  prismaMock.clockSession.create.mockResolvedValue({} as never);
  prismaMock.clockSession.update.mockResolvedValue({} as never);
  prismaMock.clockSession.findFirst.mockResolvedValue(null);
  prismaMock.dailyUpdate.upsert.mockResolvedValue({} as never);
  prismaMock.dailyUpdate.findFirst.mockResolvedValue(null);
});

describe('Wave 13 — CLIENT must NOT reach any employee-self handler', () => {
  it.each(CLIENT_FORBIDDEN_GETS)('GET %s → 403', async (route) => {
    const res = await request(makeApp())
      .get(`/api/v1${route}`)
      .set('x-test-user-role', 'CLIENT');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it.each(CLIENT_FORBIDDEN_POSTS)('POST %s → 403 (handler never runs)', async (route, body) => {
    const res = await request(makeApp())
      .post(`/api/v1${route}`)
      .set('x-test-user-role', 'CLIENT')
      .send(body);
    expect(res.status).toBe(403);
    // Mutation handlers should never have been reached.
    expect(prismaMock.clockSession.create).not.toHaveBeenCalled();
    expect(prismaMock.dailyUpdate.upsert).not.toHaveBeenCalled();
  });
});
