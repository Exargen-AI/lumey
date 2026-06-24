/**
 * 2026-05-23 — S-tier coverage for the legally-binding signature service.
 *
 * Zero tests existed on this file before this PR. It generates the legal
 * artifacts the org relies on (NDA + IP assignment signatures with full
 * agreed-text snapshot, IP, user agent, identity ritual). If this code
 * breaks, signed documents could be lost, mis-attributed, or unverifiable.
 *
 * Critical invariants pinned here:
 *   - Cannot sign someone else's enrollment (ForbiddenError on userId mismatch)
 *   - Cannot sign a declined / completed enrollment
 *   - Quizzes must be passed BEFORE any document can be signed
 *     ("comprehension before consent" — defensibility lever)
 *   - Idempotent: re-signing the same (enrollment, document, version)
 *     returns the existing row, never overwrites
 *   - On success: calls `tryMarkEnrollmentCompleted` so the gate can
 *     auto-flip (this is the integration point PR #144 fixed)
 *   - Writes an activity-log entry with the correct shape
 *
 * The in-app provider's identity-ritual contract (legal-name match,
 * password re-entry, signedTextSnapshot pinning) is tested in the
 * sibling file `inAppProvider.test.ts`.
 */

import './../../test/prismaMock';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../../test/prismaMock';
import { ForbiddenError, NotFoundError } from '../../utils/errors';

const { logActivitySpy, tryMarkSpy, inAppSignSpy } = vi.hoisted(() => ({
  logActivitySpy: vi.fn().mockResolvedValue(undefined),
  tryMarkSpy: vi.fn().mockResolvedValue(null),
  inAppSignSpy: vi.fn(),
}));

vi.mock('../activity.service', () => ({
  __esModule: true,
  logActivity: logActivitySpy,
}));

vi.mock('../enrollment.service', () => ({
  __esModule: true,
  tryMarkEnrollmentCompleted: tryMarkSpy,
}));

vi.mock('./inAppProvider', () => ({
  __esModule: true,
  inAppProvider: { sign: inAppSignSpy },
}));

vi.mock('./docusealProvider', () => ({
  __esModule: true,
  docusealProvider: { sign: vi.fn() },
}));

import { signCourseDocument } from './signing.service';

const ENROLLMENT_ID = 'enroll-1';
const USER_ID = 'user-1';
const COURSE_ID = 'course-1';
const DOCUMENT_ID = 'doc-1';

function baseEnrollment(overrides: Record<string, any> = {}) {
  return {
    id: ENROLLMENT_ID,
    userId: USER_ID,
    courseId: COURSE_ID,
    completedAt: null,
    declinedAt: null,
    course: { id: COURSE_ID, slug: 'employee-onboarding', title: 'Employee Onboarding' },
    ...overrides,
  };
}

function baseDocument(overrides: Record<string, any> = {}) {
  return {
    id: DOCUMENT_ID,
    courseId: COURSE_ID,
    slug: 'nda',
    title: 'Non-Disclosure Agreement',
    version: 1,
    bodyText: 'You agree to keep secrets secret.',
    ...overrides,
  };
}

beforeEach(() => {
  logActivitySpy.mockClear();
  tryMarkSpy.mockClear();
  inAppSignSpy.mockReset();
  // Default: no quizzes required so we focus tests on auth/idempotency.
  prismaMock.courseModule.findMany.mockResolvedValue([] as any);
  prismaMock.moduleProgress.findMany.mockResolvedValue([] as any);
});

describe('signCourseDocument — authorisation + lifecycle guards', () => {
  it('throws NotFoundError when the enrollment does not exist', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(null);
    await expect(
      signCourseDocument({
        enrollmentId: ENROLLMENT_ID,
        userId: USER_ID,
        documentSlug: 'nda',
        payload: {},
        req: {} as any,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ForbiddenError when a different user tries to sign someone else\'s enrollment', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      baseEnrollment({ userId: 'OTHER-USER' }) as any,
    );
    await expect(
      signCourseDocument({
        enrollmentId: ENROLLMENT_ID,
        userId: USER_ID,
        documentSlug: 'nda',
        payload: {},
        req: {} as any,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('refuses to sign a DECLINED enrollment (terminal state)', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      baseEnrollment({ declinedAt: new Date('2026-01-01T00:00:00Z') }) as any,
    );
    await expect(
      signCourseDocument({
        enrollmentId: ENROLLMENT_ID,
        userId: USER_ID,
        documentSlug: 'nda',
        payload: {},
        req: {} as any,
      }),
    ).rejects.toThrow(/declined/i);
  });

  it('refuses to sign a COMPLETED enrollment (already done)', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(
      baseEnrollment({ completedAt: new Date('2026-01-01T00:00:00Z') }) as any,
    );
    await expect(
      signCourseDocument({
        enrollmentId: ENROLLMENT_ID,
        userId: USER_ID,
        documentSlug: 'nda',
        payload: {},
        req: {} as any,
      }),
    ).rejects.toThrow(/already complete/i);
  });
});

describe('signCourseDocument — comprehension-before-consent (quiz gate)', () => {
  it('refuses to sign when ANY required module quiz is not yet passed', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(baseEnrollment() as any);
    // Two modules require quizzes — only one passed.
    prismaMock.courseModule.findMany.mockResolvedValue([
      { id: 'mod-1' },
      { id: 'mod-2' },
    ] as any);
    prismaMock.moduleProgress.findMany.mockResolvedValue([
      { moduleId: 'mod-1' },
    ] as any);

    await expect(
      signCourseDocument({
        enrollmentId: ENROLLMENT_ID,
        userId: USER_ID,
        documentSlug: 'nda',
        payload: {},
        req: {} as any,
      }),
    ).rejects.toThrow(/quizzes must be passed/i);

    // Provider must NOT have been called — gate fails closed.
    expect(inAppSignSpy).not.toHaveBeenCalled();
  });

  it('allows signing when course has NO required quizzes (vacuous-true gate)', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(baseEnrollment() as any);
    prismaMock.courseModule.findMany.mockResolvedValue([] as any); // no quizzes
    prismaMock.courseDocument.findUnique.mockResolvedValue(baseDocument() as any);
    prismaMock.documentSignature.findUnique.mockResolvedValue(null); // not yet signed
    prismaMock.user.findUnique.mockResolvedValue({
      id: USER_ID,
      legalName: 'Test User',
      passwordHash: 'hash',
    } as any);
    inAppSignSpy.mockResolvedValue({
      id: 'sig-1',
      enrollmentId: ENROLLMENT_ID,
      externalProvider: null,
    });

    const out = await signCourseDocument({
      enrollmentId: ENROLLMENT_ID,
      userId: USER_ID,
      documentSlug: 'nda',
      payload: { typedName: 'Test User', password: 'pw' },
      req: {} as any,
    });
    expect(out.alreadySigned).toBe(false);
    expect(inAppSignSpy).toHaveBeenCalled();
  });
});

describe('signCourseDocument — idempotency (legal-meaning is the FIRST signing)', () => {
  it('returns the existing signature (with alreadySigned: true) on a re-sign attempt — never overwrites', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(baseEnrollment() as any);
    prismaMock.courseDocument.findUnique.mockResolvedValue(baseDocument() as any);
    const existingSig = {
      id: 'sig-existing',
      enrollmentId: ENROLLMENT_ID,
      courseDocumentId: DOCUMENT_ID,
      documentVersion: 1,
      signedAt: new Date('2025-12-01T10:00:00Z'),
      signedName: 'Test User',
    };
    prismaMock.documentSignature.findUnique.mockResolvedValue(existingSig as any);

    const out = await signCourseDocument({
      enrollmentId: ENROLLMENT_ID,
      userId: USER_ID,
      documentSlug: 'nda',
      payload: { typedName: 'Test User', password: 'pw' },
      req: {} as any,
    });
    expect(out.alreadySigned).toBe(true);
    expect(out.signature).toEqual(existingSig);
    // Provider must NOT have been called — would overwrite the legal moment.
    expect(inAppSignSpy).not.toHaveBeenCalled();
    // No activity log on re-sign either.
    expect(logActivitySpy).not.toHaveBeenCalled();
  });

  it('proceeds with a NEW signature for a NEW document version (re-acknowledgment flow)', async () => {
    prismaMock.enrollment.findUnique.mockResolvedValue(baseEnrollment() as any);
    // Document is at v2 now — admin published a new version.
    prismaMock.courseDocument.findUnique.mockResolvedValue(baseDocument({ version: 2 }) as any);
    // No existing signature at v2 (only had v1).
    prismaMock.documentSignature.findUnique.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue({
      id: USER_ID,
      legalName: 'Test User',
      passwordHash: 'hash',
    } as any);
    inAppSignSpy.mockResolvedValue({ id: 'sig-2', externalProvider: null });

    const out = await signCourseDocument({
      enrollmentId: ENROLLMENT_ID,
      userId: USER_ID,
      documentSlug: 'nda',
      payload: { typedName: 'Test User', password: 'pw' },
      req: {} as any,
    });
    expect(out.alreadySigned).toBe(false);
    expect(inAppSignSpy).toHaveBeenCalled();
  });
});

describe('signCourseDocument — success path side effects', () => {
  beforeEach(() => {
    prismaMock.enrollment.findUnique.mockResolvedValue(baseEnrollment() as any);
    prismaMock.courseDocument.findUnique.mockResolvedValue(baseDocument() as any);
    prismaMock.documentSignature.findUnique.mockResolvedValue(null);
    prismaMock.user.findUnique.mockResolvedValue({
      id: USER_ID,
      legalName: 'Test User',
      passwordHash: 'hash',
    } as any);
    inAppSignSpy.mockResolvedValue({
      id: 'sig-new',
      enrollmentId: ENROLLMENT_ID,
      courseDocumentId: DOCUMENT_ID,
      documentVersion: 1,
      externalProvider: null,
    });
  });

  it('writes an activity-log entry with the right shape so audits can reconstruct who signed what when', async () => {
    await signCourseDocument({
      enrollmentId: ENROLLMENT_ID,
      userId: USER_ID,
      documentSlug: 'nda',
      payload: { typedName: 'Test User', password: 'pw' },
      req: {} as any,
    });
    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        action: 'document_signed',
        targetType: 'course_document',
        targetId: DOCUMENT_ID,
        details: expect.objectContaining({
          enrollmentId: ENROLLMENT_ID,
          courseSlug: 'employee-onboarding',
          documentSlug: 'nda',
          documentVersion: 1,
          provider: 'in-app',
        }),
      }),
    );
  });

  it('calls tryMarkEnrollmentCompleted on success — the integration point PR #144 added', async () => {
    await signCourseDocument({
      enrollmentId: ENROLLMENT_ID,
      userId: USER_ID,
      documentSlug: 'nda',
      payload: { typedName: 'Test User', password: 'pw' },
      req: {} as any,
    });
    expect(tryMarkSpy).toHaveBeenCalledWith(ENROLLMENT_ID);
  });
});
