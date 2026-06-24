/**
 * 2026-05-23 — production-safety regression for `tryMarkEnrollmentCompleted`.
 *
 * Context: PR #144 fixed the "every enrollment stuck in_progress" bug by
 * adding `recheckOpenEnrollments` — a SUPER_ADMIN sweep that walks every
 * still-open enrollment and runs the completion gate. The follow-up PR
 * (this one) made the sweep authentic: `completedAt` gets backdated to
 * the real historical moment the employee actually finished (max of their
 * latest signature / latest passed quiz), so PDFs and audit trails show
 * truthful dates.
 *
 * THE PRODUCTION SAFETY TRAP we narrowly avoided: three places in the
 * code (`auth.service.ts:418`, `enrollment.service.ts:33`, and
 * `onboardingMaintenance.service.ts:32`) all use `expiresAt <= now` to
 * decide "is this user expired → needs to re-acknowledge". If we naively
 * also backdated `expiresAt`, every employee with an old completion would
 * be tripped back into "needs re-ack" on their next login — the OPPOSITE
 * of what the backfill is supposed to do.
 *
 * Resolution: `completedAt` is historical (audit truth), `expiresAt` is
 * pegged to `MAX(historical, now) + validityDays` so the renewal clock
 * effectively restarts from today and no one gets auto-re-prompted.
 *
 * These tests pin both halves of that contract.
 */

import './../test/prismaMock';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../test/prismaMock';

vi.mock('./activity.service', () => ({
  __esModule: true,
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

import { tryMarkEnrollmentCompleted } from './enrollment.service';

const baseCourse = {
  documents: [{ id: 'doc-1' }, { id: 'doc-2' }],
  modules: [{ id: 'mod-1', quiz: { id: 'quiz-1' } }],
  slug: 'employee-onboarding',
  title: 'Employee Onboarding',
  isMandatoryOnHire: true,
  acknowledgmentValidityDays: 365,
};

function makeOpenEnrollment(opts: {
  signedAtA: Date;
  signedAtB: Date;
  quizPassedAt: Date;
  enrolledAt: Date;
}) {
  return {
    id: 'enroll-1',
    userId: 'user-1',
    courseId: 'course-1',
    courseVersion: 1,
    enrolledAt: opts.enrolledAt,
    completedAt: null,
    declinedAt: null,
    course: baseCourse,
    signatures: [
      { courseDocumentId: 'doc-1' },
      { courseDocumentId: 'doc-2' },
    ],
    moduleProgress: [
      { moduleId: 'mod-1', quizPassed: true, completedAt: opts.quizPassedAt },
    ],
  };
}

beforeEach(() => {
  vi.useRealTimers();
});

describe('tryMarkEnrollmentCompleted — historical-backfill safety', () => {
  it('uses historical override for completedAt but pegs expiresAt to today + validity (so user is NOT auto-re-prompted on next login)', async () => {
    // Pretend it's 2026-05-23 (the day Pankaj clicks the backfill button).
    const today = new Date('2026-05-23T14:22:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(today);

    // Employee genuinely finished 14 months ago (so well past the 365-day
    // validity window). The bug stranded their enrollment in_progress.
    const historicalFinish = new Date('2025-03-15T10:00:00Z');

    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeOpenEnrollment({
        signedAtA: new Date('2025-02-01T09:00:00Z'),
        signedAtB: new Date('2025-03-10T11:00:00Z'),
        quizPassedAt: historicalFinish,
        enrolledAt: new Date('2025-01-01T08:00:00Z'),
      }) as any,
    );
    prismaMock.enrollment.update.mockImplementation(
      (args: any) => Promise.resolve({ ...args.data, id: 'enroll-1' }) as any,
    );

    const result = await tryMarkEnrollmentCompleted('enroll-1', {
      completedAtOverride: historicalFinish,
    });

    expect(result).toBeTruthy();
    const updateCall = prismaMock.enrollment.update.mock.calls[0]![0]! as any;

    // (1) completedAt is the REAL historical moment — for the PDF + audit trail.
    expect(updateCall.data.completedAt).toEqual(historicalFinish);

    // (2) expiresAt is NOT historicalFinish + 365d (which would be in the past)
    //     — that would trip auth.service:418's `expiresAt <= now` check and
    //     immediately force re-acknowledgment. Instead it's pegged to today
    //     + 365d so the renewal clock effectively restarts from today.
    const expiresAt = updateCall.data.expiresAt as Date;
    expect(expiresAt.getTime()).toBeGreaterThan(today.getTime());
    expect(expiresAt.getTime()).toBe(today.getTime() + 365 * 24 * 60 * 60 * 1000);
  });

  it('live signing path (no override) sets BOTH completedAt and expiresAt to now + validity', async () => {
    const today = new Date('2026-05-23T14:22:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(today);

    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeOpenEnrollment({
        signedAtA: new Date('2026-05-20T09:00:00Z'),
        signedAtB: new Date('2026-05-21T11:00:00Z'),
        quizPassedAt: new Date('2026-05-23T14:21:00Z'),
        enrolledAt: new Date('2026-05-15T08:00:00Z'),
      }) as any,
    );
    prismaMock.enrollment.update.mockImplementation(
      (args: any) => Promise.resolve({ ...args.data, id: 'enroll-1' }) as any,
    );

    await tryMarkEnrollmentCompleted('enroll-1');

    const updateCall = prismaMock.enrollment.update.mock.calls[0]![0]! as any;
    expect(updateCall.data.completedAt).toEqual(today);
    expect((updateCall.data.expiresAt as Date).getTime()).toBe(
      today.getTime() + 365 * 24 * 60 * 60 * 1000,
    );
  });

  it('refuses to backdate completedAt before enrolledAt (data-corruption guard)', async () => {
    const today = new Date('2026-05-23T14:22:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(today);

    const enrolledAt = new Date('2025-06-01T08:00:00Z');
    const absurdlyOldOverride = new Date('2020-01-01T00:00:00Z');

    prismaMock.enrollment.findUnique.mockResolvedValue(
      makeOpenEnrollment({
        signedAtA: new Date('2025-06-05T09:00:00Z'),
        signedAtB: new Date('2025-06-10T11:00:00Z'),
        quizPassedAt: new Date('2025-06-15T10:00:00Z'),
        enrolledAt,
      }) as any,
    );
    prismaMock.enrollment.update.mockImplementation(
      (args: any) => Promise.resolve({ ...args.data, id: 'enroll-1' }) as any,
    );

    await tryMarkEnrollmentCompleted('enroll-1', {
      completedAtOverride: absurdlyOldOverride,
    });

    const updateCall = prismaMock.enrollment.update.mock.calls[0]![0]! as any;
    // Clamps up to enrolledAt — never lets a corrupt timestamp create a
    // completion that predates the enrollment row itself.
    expect(updateCall.data.completedAt).toEqual(enrolledAt);
  });

  it('returns enrollment unchanged when gate is NOT met (e.g. quiz never passed) — no completedAt write', async () => {
    const enrollment = makeOpenEnrollment({
      signedAtA: new Date('2025-02-01T09:00:00Z'),
      signedAtB: new Date('2025-03-10T11:00:00Z'),
      quizPassedAt: new Date('2025-03-15T10:00:00Z'),
      enrolledAt: new Date('2025-01-01T08:00:00Z'),
    });
    // Wipe quiz pass — gate fails.
    enrollment.moduleProgress = [];

    prismaMock.enrollment.findUnique.mockResolvedValue(enrollment as any);

    const result = await tryMarkEnrollmentCompleted('enroll-1', {
      completedAtOverride: new Date('2025-03-15T10:00:00Z'),
    });

    expect(result).toBeTruthy();
    expect(result?.completedAt).toBeNull();
    expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
  });

  it('returns early without re-writing on rows that are ALREADY completed (backfill is a no-op for completed rows)', async () => {
    const alreadyCompleted = {
      ...makeOpenEnrollment({
        signedAtA: new Date('2025-02-01T09:00:00Z'),
        signedAtB: new Date('2025-03-10T11:00:00Z'),
        quizPassedAt: new Date('2025-03-15T10:00:00Z'),
        enrolledAt: new Date('2025-01-01T08:00:00Z'),
      }),
      completedAt: new Date('2025-03-15T10:00:00Z'),
    };

    prismaMock.enrollment.findUnique.mockResolvedValue(alreadyCompleted as any);

    await tryMarkEnrollmentCompleted('enroll-1', {
      completedAtOverride: new Date('2025-03-15T10:00:00Z'),
    });

    expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
  });

  it('returns enrollment unchanged on declined rows — backfill must not resurrect a declined enrollment', async () => {
    const declined = {
      ...makeOpenEnrollment({
        signedAtA: new Date('2025-02-01T09:00:00Z'),
        signedAtB: new Date('2025-03-10T11:00:00Z'),
        quizPassedAt: new Date('2025-03-15T10:00:00Z'),
        enrolledAt: new Date('2025-01-01T08:00:00Z'),
      }),
      declinedAt: new Date('2025-03-20T10:00:00Z'),
    };

    prismaMock.enrollment.findUnique.mockResolvedValue(declined as any);

    await tryMarkEnrollmentCompleted('enroll-1', {
      completedAtOverride: new Date('2025-03-15T10:00:00Z'),
    });

    expect(prismaMock.enrollment.update).not.toHaveBeenCalled();
  });

  it('perpetual-validity courses (acknowledgmentValidityDays = null) leave expiresAt null regardless of backfill', async () => {
    const today = new Date('2026-05-23T14:22:00Z');
    vi.useFakeTimers();
    vi.setSystemTime(today);

    const enrollment = makeOpenEnrollment({
      signedAtA: new Date('2025-02-01T09:00:00Z'),
      signedAtB: new Date('2025-03-10T11:00:00Z'),
      quizPassedAt: new Date('2025-03-15T10:00:00Z'),
      enrolledAt: new Date('2025-01-01T08:00:00Z'),
    });
    enrollment.course = { ...baseCourse, acknowledgmentValidityDays: null as any };

    prismaMock.enrollment.findUnique.mockResolvedValue(enrollment as any);
    prismaMock.enrollment.update.mockImplementation(
      (args: any) => Promise.resolve({ ...args.data, id: 'enroll-1' }) as any,
    );

    await tryMarkEnrollmentCompleted('enroll-1', {
      completedAtOverride: new Date('2025-03-15T10:00:00Z'),
    });

    const updateCall = prismaMock.enrollment.update.mock.calls[0]![0]! as any;
    expect(updateCall.data.expiresAt).toBeNull();
  });
});
