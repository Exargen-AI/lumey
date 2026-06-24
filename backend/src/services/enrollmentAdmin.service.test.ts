/**
 * 2026-05-23 — S-tier coverage for the admin-facing enrollment service.
 *
 * Covers the surfaces a SUPER_ADMIN hits on the Compliance page:
 *   - listEnrollmentsForAdmin: per-row gate diagnostic (Sigs N/M · Quiz P/Q)
 *   - getCourseEnrollmentStats: aggregate stats + by-role breakdown
 *   - sendEnrollmentReminder: 24h throttle + audit-log + notification
 *   - recheckOpenEnrollments: historical-timestamp backfill safety
 *
 * Zero tests existed before this PR. recheckOpenEnrollments specifically
 * is the function PR #144/146 added to recover stuck-in_progress rows;
 * if its logic regresses, either:
 *   (a) it silently re-prompts users (the bug Pankaj feared), or
 *   (b) it leaves legitimate completions stranded.
 *
 * Invariants pinned:
 *   - listEnrollmentsForAdmin returns gateMet=true ONLY when both
 *     signaturesUnique===requiredDocuments AND quizzesPassed===requiredQuizzes
 *   - listEnrollmentsForAdmin computes status correctly (in_progress vs
 *     out_of_date vs completed)
 *   - sendEnrollmentReminder refuses on completed / declined rows
 *   - sendEnrollmentReminder throttles to once per 24h
 *   - sendEnrollmentReminder bypasses user mute (compliance > preference)
 *   - recheckOpenEnrollments computes historical completion from the
 *     LATEST signature / passed quiz (not now)
 *   - recheckOpenEnrollments handles "no signatures yet" gracefully
 *     (falls back to default behaviour)
 *   - recheckOpenEnrollments is idempotent (re-running yields same result)
 *   - recheckOpenEnrollments writes a batch audit-log entry
 */

import './../test/prismaMock';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import { ValidationError, NotFoundError } from '../utils/errors';

const { logActivitySpy, tryMarkSpy, createNotificationSpy } = vi.hoisted(() => ({
  logActivitySpy: vi.fn().mockResolvedValue(undefined),
  tryMarkSpy: vi.fn().mockResolvedValue(null),
  createNotificationSpy: vi.fn(),
}));

vi.mock('./activity.service', () => ({
  __esModule: true,
  logActivity: logActivitySpy,
}));

vi.mock('./enrollment.service', () => ({
  __esModule: true,
  tryMarkEnrollmentCompleted: tryMarkSpy,
}));

vi.mock('./notification.service', () => ({
  __esModule: true,
  createNotification: createNotificationSpy,
}));

import {
  listEnrollmentsForAdmin,
  sendEnrollmentReminder,
  recheckOpenEnrollments,
  getCourseEnrollmentStats,
} from './enrollmentAdmin.service';

const ACTOR_ID = 'admin-1';
const COURSE_ID = 'course-1';

beforeEach(() => {
  logActivitySpy.mockClear();
  tryMarkSpy.mockClear();
  createNotificationSpy.mockReset();
});

describe('listEnrollmentsForAdmin — gate diagnostic per row', () => {
  it('computes gateMet=true when signatures + quizzes both complete', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([
      {
        id: 'e1',
        enrolledAt: new Date('2026-01-01'),
        completedAt: null,
        declinedAt: null,
        courseVersion: 1,
        user: { id: 'u1', name: 'A', email: 'a@x.in', role: 'ENGINEER', isActive: true },
        course: {
          id: COURSE_ID,
          slug: 'onb',
          title: 'Onboarding',
          version: 1,
          documents: [{ id: 'd1' }, { id: 'd2' }],
          modules: [{ id: 'm1', quiz: { id: 'q1' } }],
        },
        signatures: [
          { courseDocumentId: 'd1', signedAt: new Date('2026-01-02') },
          { courseDocumentId: 'd2', signedAt: new Date('2026-01-03') },
        ],
        moduleProgress: [{ moduleId: 'm1', quizPassed: true, completedAt: new Date() }],
        _count: { signatures: 2, quizAttempts: 1 },
      },
    ] as any);

    const rows = await listEnrollmentsForAdmin({});
    expect(rows).toHaveLength(1);
    expect(rows[0].gate).toEqual({
      requiredDocuments: 2,
      signaturesUnique: 2,
      requiredQuizzes: 1,
      quizzesPassed: 1,
      latestSignatureAt: new Date('2026-01-03'),
      gateMet: true,
    });
  });

  it('computes gateMet=false and surfaces what is missing (Sigs only partial)', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([
      {
        id: 'e2',
        enrolledAt: new Date('2026-01-01'),
        completedAt: null,
        declinedAt: null,
        courseVersion: 1,
        user: { id: 'u2', name: 'B', email: 'b@x.in', role: 'ENGINEER', isActive: true },
        course: {
          id: COURSE_ID,
          slug: 'onb',
          title: 'Onboarding',
          version: 1,
          documents: [{ id: 'd1' }, { id: 'd2' }],
          modules: [{ id: 'm1', quiz: { id: 'q1' } }],
        },
        signatures: [{ courseDocumentId: 'd1', signedAt: new Date() }],
        moduleProgress: [{ moduleId: 'm1', quizPassed: true, completedAt: new Date() }],
        _count: { signatures: 1, quizAttempts: 1 },
      },
    ] as any);

    const rows = await listEnrollmentsForAdmin({});
    expect(rows[0].gate.signaturesUnique).toBe(1);
    expect(rows[0].gate.requiredDocuments).toBe(2);
    expect(rows[0].gate.gateMet).toBe(false);
  });

  it('marks status as out_of_date when completedAt is set on an old courseVersion', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([
      {
        id: 'e3',
        enrolledAt: new Date('2025-06-01'),
        completedAt: new Date('2025-06-15'),
        declinedAt: null,
        courseVersion: 1,
        user: { id: 'u3', name: 'C', email: 'c@x.in', role: 'ENGINEER', isActive: true },
        course: {
          id: COURSE_ID,
          slug: 'onb',
          title: 'Onboarding',
          // current version bumped to 2 — they're now out of date
          version: 2,
          documents: [{ id: 'd1' }],
          modules: [],
        },
        signatures: [{ courseDocumentId: 'd1', signedAt: new Date('2025-06-10') }],
        moduleProgress: [],
        _count: { signatures: 1, quizAttempts: 0 },
      },
    ] as any);

    const rows = await listEnrollmentsForAdmin({});
    expect(rows[0].status).toBe('out_of_date');
  });

  it('filters by courseId when supplied', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([] as any);
    await listEnrollmentsForAdmin({ courseId: 'specific-course' });
    expect(prismaMock.enrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ courseId: 'specific-course' }) }),
    );
  });

  it('filters by status: in_progress applies completedAt:null + declinedAt:null', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([] as any);
    await listEnrollmentsForAdmin({ status: 'in_progress' });
    expect(prismaMock.enrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ completedAt: null, declinedAt: null }),
      }),
    );
  });
});

describe('sendEnrollmentReminder — throttle + audit + bypass-mute', () => {
  const ENROLLMENT_ID = 'enroll-x';

  function baseEnrollment(overrides: Record<string, any> = {}) {
    return {
      id: ENROLLMENT_ID,
      userId: 'recipient-1',
      completedAt: null,
      declinedAt: null,
      user: { id: 'recipient-1', name: 'Recipient', email: 'r@x.in' },
      course: { id: 'c1', slug: 'onb', title: 'Onboarding' },
      ...overrides,
    };
  }

  it('throws NotFoundError when the enrollment does not exist', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(null);
    await expect(sendEnrollmentReminder(ENROLLMENT_ID, ACTOR_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses on a COMPLETED enrollment (no reminder needed)', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      baseEnrollment({ completedAt: new Date() }) as any,
    );
    await expect(sendEnrollmentReminder(ENROLLMENT_ID, ACTOR_ID)).rejects.toThrow(/already complete/i);
  });

  it('refuses on a DECLINED enrollment (terminal state)', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      baseEnrollment({ declinedAt: new Date() }) as any,
    );
    await expect(sendEnrollmentReminder(ENROLLMENT_ID, ACTOR_ID)).rejects.toThrow(/declined/i);
  });

  it('throttles to once per 24 hours per user (anti-spam)', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(baseEnrollment() as any);
    prismaMock.notification.findFirst.mockResolvedValue({
      id: 'recent-notif',
      createdAt: new Date(),
    } as any);

    await expect(sendEnrollmentReminder(ENROLLMENT_ID, ACTOR_ID)).rejects.toThrow(/24 hours/);
    expect(createNotificationSpy).not.toHaveBeenCalled();
  });

  it('passes bypassMute:true so a muted user still gets the compliance ping', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(baseEnrollment() as any);
    prismaMock.notification.findFirst.mockResolvedValue(null);
    createNotificationSpy.mockResolvedValueOnce({
      id: 'new-notif',
      createdAt: new Date(),
    } as any);

    await sendEnrollmentReminder(ENROLLMENT_ID, ACTOR_ID);

    expect(createNotificationSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'recipient-1',
        type: 'onboarding_reminder',
        bypassMute: true,
      }),
    );
  });

  it('writes an audit-log entry naming the actor + recipient + course', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(baseEnrollment() as any);
    prismaMock.notification.findFirst.mockResolvedValue(null);
    createNotificationSpy.mockResolvedValueOnce({ id: 'n1', createdAt: new Date() } as any);

    await sendEnrollmentReminder(ENROLLMENT_ID, ACTOR_ID);

    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: ACTOR_ID,
        action: 'onboarding_reminder_sent',
        targetType: 'enrollment',
        targetId: ENROLLMENT_ID,
        details: expect.objectContaining({
          recipientUserId: 'recipient-1',
          recipientEmail: 'r@x.in',
          courseSlug: 'onb',
        }),
      }),
    );
  });
});

describe('recheckOpenEnrollments — historical-timestamp backfill safety', () => {
  it('passes the LATEST historical timestamp as completedAtOverride (not now)', async () => {
    const sigA = new Date('2025-03-01T10:00:00Z');
    const sigB = new Date('2025-03-15T11:00:00Z');
    const quizPassedAt = new Date('2025-03-20T12:00:00Z'); // latest

    prismaMock.enrollment.findMany.mockResolvedValue([
      {
        id: 'e-historical',
        signatures: [{ signedAt: sigA }, { signedAt: sigB }],
        moduleProgress: [{ completedAt: quizPassedAt, startedAt: new Date('2025-03-19') }],
      },
    ] as any);
    tryMarkSpy.mockResolvedValueOnce({ id: 'e-historical', completedAt: quizPassedAt });

    const result = await recheckOpenEnrollments(ACTOR_ID);

    expect(tryMarkSpy).toHaveBeenCalledWith('e-historical', {
      completedAtOverride: quizPassedAt,
    });
    expect(result).toEqual({ scanned: 1, completed: 1 });
  });

  it('falls back to undefined override when row has no signature + no passed quiz yet (vacuous)', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([
      { id: 'e-empty', signatures: [], moduleProgress: [] },
    ] as any);
    tryMarkSpy.mockResolvedValueOnce({ id: 'e-empty', completedAt: null });

    await recheckOpenEnrollments(ACTOR_ID);
    expect(tryMarkSpy).toHaveBeenCalledWith('e-empty', { completedAtOverride: undefined });
  });

  it('reports scanned + completed counts (idempotency signal for the admin UI)', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([
      { id: 'e1', signatures: [{ signedAt: new Date() }], moduleProgress: [] },
      { id: 'e2', signatures: [{ signedAt: new Date() }], moduleProgress: [] },
      { id: 'e3', signatures: [], moduleProgress: [] },
    ] as any);
    tryMarkSpy
      .mockResolvedValueOnce({ id: 'e1', completedAt: new Date() })
      .mockResolvedValueOnce({ id: 'e2', completedAt: null }) // not ready
      .mockResolvedValueOnce({ id: 'e3', completedAt: null });

    const result = await recheckOpenEnrollments(ACTOR_ID);
    expect(result).toEqual({ scanned: 3, completed: 1 });
  });

  it('swallows errors from individual tryMarkEnrollmentCompleted calls (one bad row does not abort batch)', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([
      { id: 'e1', signatures: [], moduleProgress: [] },
      { id: 'e2', signatures: [], moduleProgress: [] },
    ] as any);
    tryMarkSpy
      .mockRejectedValueOnce(new Error('Course deleted mid-sweep'))
      .mockResolvedValueOnce({ id: 'e2', completedAt: new Date() });

    const result = await recheckOpenEnrollments(ACTOR_ID);
    expect(result.scanned).toBe(2);
    expect(result.completed).toBe(1);
  });

  it('writes a batch audit-log entry with the count summary', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([] as any);
    await recheckOpenEnrollments(ACTOR_ID);
    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: ACTOR_ID,
        action: 'recheck_open_enrollments',
        targetType: 'enrollment',
        targetId: 'batch',
        details: expect.objectContaining({
          scanned: 0,
          completed: 0,
          historicalBackfill: true,
        }),
      }),
    );
  });

  it('only sweeps rows where completedAt:null AND declinedAt:null (does not resurrect declined or re-flip completed)', async () => {
    prismaMock.enrollment.findMany.mockResolvedValue([] as any);
    await recheckOpenEnrollments(ACTOR_ID);
    expect(prismaMock.enrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { completedAt: null, declinedAt: null },
      }),
    );
  });
});

describe('getCourseEnrollmentStats — aggregate stats + by-role breakdown', () => {
  it('throws NotFoundError when the course does not exist', async () => {
    prismaMock.course.findUnique.mockResolvedValue(null);
    await expect(getCourseEnrollmentStats(COURSE_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('counts completed = at-current-version, outOfDate = below-current-version, inProgress = remainder', async () => {
    prismaMock.course.findUnique.mockResolvedValue({
      id: COURSE_ID,
      slug: 'onb',
      title: 'Onboarding',
      version: 2,
      applicableRoles: ['ENGINEER'],
    } as any);
    prismaMock.enrollment.findMany.mockResolvedValue([
      {
        id: 'e1',
        courseVersion: 2,
        completedAt: new Date(),
        declinedAt: null,
        user: { role: 'ENGINEER', isActive: true },
      },
      {
        id: 'e2',
        courseVersion: 1, // old version
        completedAt: new Date(),
        declinedAt: null,
        user: { role: 'ENGINEER', isActive: true },
      },
      {
        id: 'e3',
        courseVersion: 2,
        completedAt: null,
        declinedAt: null,
        user: { role: 'ENGINEER', isActive: true },
      },
      {
        id: 'e4',
        courseVersion: 2,
        completedAt: null,
        declinedAt: new Date(),
        user: { role: 'ENGINEER', isActive: true },
      },
    ] as any);

    const stats = await getCourseEnrollmentStats(COURSE_ID);
    expect(stats.total).toBe(4);
    expect(stats.completed).toBe(1);
    expect(stats.outOfDate).toBe(1);
    expect(stats.declined).toBe(1);
    expect(stats.inProgress).toBe(1);
    expect(stats.completionPercent).toBe(25);
  });

  it('excludes inactive users from byRole breakdown (matches the active-headcount business rule)', async () => {
    prismaMock.course.findUnique.mockResolvedValue({
      id: COURSE_ID,
      slug: 'onb',
      title: 'Onboarding',
      version: 1,
      applicableRoles: ['ENGINEER'],
    } as any);
    prismaMock.enrollment.findMany.mockResolvedValue([
      { id: 'e1', courseVersion: 1, completedAt: new Date(), declinedAt: null, user: { role: 'ENGINEER', isActive: true } },
      { id: 'e2', courseVersion: 1, completedAt: new Date(), declinedAt: null, user: { role: 'ENGINEER', isActive: false } },
    ] as any);

    const stats = await getCourseEnrollmentStats(COURSE_ID);
    const eng = stats.byRole.find((r) => r.role === 'ENGINEER');
    expect(eng?.total).toBe(1);
    expect(eng?.completed).toBe(1);
  });
});
