/**
 * Pulse — Clock In / Out service tests (2026-05-28b).
 *
 * Pins the invariants any future refactor must hold:
 *   - At most one OPEN session per user (refuses double clockIn).
 *   - clockOut with no open session is a ValidationError, NOT a no-op
 *     (we want the user to see the error rather than silently miss
 *     hours).
 *   - getClockStatusForUser correctly clips a session that started
 *     before midnight to today's window.
 *   - autoCloseStaleSessions touches only sessions older than 12h, and
 *     sets autoClosedAt (NOT clockedOutAt) so the team view can flag
 *     "forgot to clock out" cases.
 */

import './../test/prismaMock';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import { Prisma } from '@prisma/client';
import { ValidationError } from '../utils/errors';

const { logActivitySpy } = vi.hoisted(() => ({
  logActivitySpy: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./activity.service', () => ({
  __esModule: true,
  logActivity: logActivitySpy,
}));

import {
  clockIn,
  clockOut,
  getClockStatusForUser,
  autoCloseStaleSessions,
} from './clockSession.service';

const USER_ID = 'user-1';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── clockIn ──────────────────────────────────────────────────────────

describe('clockIn', () => {
  it('refuses when an open session already exists', async () => {
    prismaMock.clockSession.findFirst.mockResolvedValue({
      id: 'sess-existing',
      userId: USER_ID,
      clockedInAt: new Date(),
      clockedOutAt: null,
      autoClosedAt: null,
    } as any);

    await expect(clockIn(USER_ID, 'starting work')).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(prismaMock.clockSession.create).not.toHaveBeenCalled();
  });

  it('creates a new session + logs activity when no open session exists', async () => {
    prismaMock.clockSession.findFirst.mockResolvedValue(null);
    prismaMock.clockSession.create.mockResolvedValue({
      id: 'sess-new',
      userId: USER_ID,
      clockedInAt: new Date(),
      clockedOutAt: null,
      autoClosedAt: null,
      noteIn: 'building Pulse',
      noteOut: null,
    } as any);

    const session = await clockIn(USER_ID, 'building Pulse');

    expect(session.id).toBe('sess-new');
    expect(prismaMock.clockSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: USER_ID,
        noteIn: 'building Pulse',
      }),
    });
    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        action: 'clock_in',
        targetType: 'clock_session',
      }),
    );
  });

  // ─── Wave 11 — race protection ───────────────────────────────────

  it('translates the Postgres unique_violation (P2002) into a friendly ValidationError', async () => {
    // Simulate two concurrent /clock/in requests where the
    // application-level check both saw "no open session" but the DB
    // unique partial index rejects the second create.
    prismaMock.clockSession.findFirst.mockResolvedValue(null);
    const uniqueViolation = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      { code: 'P2002', clientVersion: 'test' },
    );
    prismaMock.clockSession.create.mockRejectedValue(uniqueViolation);

    await expect(clockIn(USER_ID, 'racing')).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(clockIn(USER_ID, 'racing')).rejects.toThrow(
      /already clocked in/i,
    );
    // Audit log shouldn't fire when the create failed.
    expect(logActivitySpy).not.toHaveBeenCalled();
  });

  it('rethrows non-unique-violation Prisma errors as-is', async () => {
    prismaMock.clockSession.findFirst.mockResolvedValue(null);
    const otherErr = new Prisma.PrismaClientKnownRequestError(
      'connection refused',
      { code: 'P1001', clientVersion: 'test' },
    );
    prismaMock.clockSession.create.mockRejectedValue(otherErr);

    // Catches as the raw Prisma error, NOT our friendly ValidationError.
    await expect(clockIn(USER_ID)).rejects.toBe(otherErr);
  });
});

// ─── clockOut ─────────────────────────────────────────────────────────

describe('clockOut', () => {
  it('throws ValidationError when user is not currently clocked in', async () => {
    prismaMock.clockSession.findFirst.mockResolvedValue(null);
    await expect(clockOut(USER_ID)).rejects.toBeInstanceOf(ValidationError);
    expect(prismaMock.clockSession.update).not.toHaveBeenCalled();
  });

  it('closes the open session + records duration in audit log', async () => {
    const openedAt = new Date(Date.now() - 60 * 60 * 1000); // 1h ago
    const closedAt = new Date();
    prismaMock.clockSession.findFirst.mockResolvedValue({
      id: 'sess-open',
      userId: USER_ID,
      clockedInAt: openedAt,
      clockedOutAt: null,
      autoClosedAt: null,
    } as any);
    prismaMock.clockSession.update.mockResolvedValue({
      id: 'sess-open',
      userId: USER_ID,
      clockedInAt: openedAt,
      clockedOutAt: closedAt,
      autoClosedAt: null,
      noteOut: 'wrapping up',
    } as any);
    prismaMock.productivityEvent.createMany.mockResolvedValue({ count: 0 } as any);
    // PR #33 Wave 2: clockOut now wraps update + productivity-event
    // emit in a $transaction. The mock has to invoke the callback with
    // prismaMock standing in for the transactional client.
    (prismaMock.$transaction as any).mockImplementation(async (cb: any) => cb(prismaMock));

    const session = await clockOut(USER_ID, 'wrapping up');
    expect(session.clockedOutAt).not.toBeNull();

    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        action: 'clock_out',
        details: expect.objectContaining({
          noteOut: 'wrapping up',
          durationSeconds: expect.any(Number),
        }),
      }),
    );
  });
});

// ─── getClockStatusForUser — today-window clipping ────────────────────

describe('getClockStatusForUser', () => {
  it('clips a session that began before midnight to today\'s window when computing total', async () => {
    const now = new Date();
    const midnightToday = new Date(now);
    midnightToday.setHours(0, 0, 0, 0);
    // Session: started 4h before midnight, still open. Total today
    // should be ≈ (now - midnight), NOT (now - startedAt).
    const startedAt = new Date(midnightToday.getTime() - 4 * 60 * 60 * 1000);
    prismaMock.clockSession.findMany.mockResolvedValue([
      {
        id: 'sess-crossing',
        userId: USER_ID,
        clockedInAt: startedAt,
        clockedOutAt: null,
        autoClosedAt: null,
      },
    ] as any);

    const status = await getClockStatusForUser(USER_ID);
    const expectedTodaySec = Math.floor((now.getTime() - midnightToday.getTime()) / 1000);
    // Allow 5s slack for the test-run latency.
    expect(Math.abs(status.totalSecondsToday - expectedTodaySec)).toBeLessThan(5);
  });

  it('returns openSession === null when all today\'s sessions are closed', async () => {
    // Wave 14 — pin "now" to mid-afternoon so the test isn't flaky
    // when run between local midnight and ~2am (the original
    // sessionStart=`Date.now()-2h` would fall into YESTERDAY's
    // window, get clipped to 0, and break the assertion).
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T15:00:00'));
    try {
      const closedSession = {
        id: 'sess-closed',
        userId: USER_ID,
        clockedInAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        clockedOutAt: new Date(Date.now() - 60 * 60 * 1000),
        autoClosedAt: null,
      };
      prismaMock.clockSession.findMany.mockResolvedValue([closedSession] as any);

      const status = await getClockStatusForUser(USER_ID);
      expect(status.openSession).toBeNull();
      expect(status.todaySessions).toHaveLength(1);
      expect(status.totalSecondsToday).toBeGreaterThan(3500);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ─── autoCloseStaleSessions ───────────────────────────────────────────

describe('autoCloseStaleSessions', () => {
  it('sets autoClosedAt (NOT clockedOutAt) on sessions >12h old AND emits a PRESENCE event for each', async () => {
    // emitProductivityEvent bails when the feature flag is off — stub
    // it on so the Wave 11 outbox emit fires in test.
    vi.stubEnv('FEATURE_PULSE_COMPOSITE_SCORE_BETA', 'true');

    const now = new Date('2026-05-30T20:00:00Z');
    const clockedInAt = new Date('2026-05-30T05:00:00Z'); // 15h ago — over the 12h cutoff
    prismaMock.clockSession.findMany.mockResolvedValue([
      { id: 'stale-1', userId: USER_ID, clockedInAt },
      { id: 'stale-2', userId: USER_ID, clockedInAt },
    ] as any);
    // Wave 11 — per-session $transaction. Mock it to run the
    // callback against the same prismaMock.
    (prismaMock.$transaction as any).mockImplementation(async (cb: any) => {
      if (typeof cb === 'function') return cb(prismaMock);
      return undefined;
    });
    prismaMock.clockSession.update.mockResolvedValue({} as any);
    prismaMock.productivityEvent.createMany.mockResolvedValue({ count: 1 } as any);

    const result = await autoCloseStaleSessions(now);
    expect(result.closed).toBe(2);

    // Two transactions — one per stale session.
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    // Each tx updates the session with autoClosedAt (NOT clockedOutAt).
    expect(prismaMock.clockSession.update).toHaveBeenCalledTimes(2);
    const updateArgs = prismaMock.clockSession.update.mock.calls[0]?.[0] as any;
    expect(updateArgs.data.autoClosedAt).toEqual(now);
    expect(updateArgs.data.clockedOutAt).toBeUndefined();
    // And each tx fires a PRESENCE outbox event with the auto-closed flag.
    expect(prismaMock.productivityEvent.createMany).toHaveBeenCalled();
    const emitArgs = prismaMock.productivityEvent.createMany.mock.calls[0][0] as any;
    expect(emitArgs.data[0].rawPayload).toMatchObject({ autoClosed: true });

    vi.unstubAllEnvs();
  });

  it('returns {closed: 0} when nothing is stale (no DB write)', async () => {
    prismaMock.clockSession.findMany.mockResolvedValue([] as any);
    const result = await autoCloseStaleSessions();
    expect(result.closed).toBe(0);
    expect(prismaMock.clockSession.update).not.toHaveBeenCalled();
    expect(prismaMock.productivityEvent.createMany).not.toHaveBeenCalled();
  });

  it('writes the audit log against each affected userId (NOT a synthetic "system" id)', async () => {
    // Regression: a previous version used userId: 'system' which fails
    // the Activity.userId FK silently (logActivity outside a tx is
    // fire-and-forget), dropping the audit trail. We now log per-user.
    prismaMock.clockSession.findMany.mockResolvedValue([
      { id: 'stale-1', userId: 'user-A' },
      { id: 'stale-2', userId: 'user-B' },
    ] as any);
    prismaMock.clockSession.updateMany.mockResolvedValue({ count: 2 } as any);

    await autoCloseStaleSessions();

    expect(logActivitySpy).toHaveBeenCalledTimes(2);
    const calls = logActivitySpy.mock.calls.map((c) => c[0]);
    expect(calls.map((p: any) => p.userId).sort()).toEqual(['user-A', 'user-B']);
    expect(calls.every((p: any) => p.userId !== 'system')).toBe(true);
    expect(calls.every((p: any) => p.action === 'clock_session_auto_closed')).toBe(true);
  });
});
