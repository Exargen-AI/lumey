import type { Request } from 'express';
import prisma from '../../config/database';
import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors';
import { logActivity } from '../activity.service';
import { tryMarkEnrollmentCompleted } from '../enrollment.service';
import { inAppProvider } from './inAppProvider';
import { docusealProvider } from './docusealProvider';
import type { SigningProvider } from './types';

// Provider selection. For Phase 1 always pick the in-app provider unless
// explicitly opted into external signing (env-gated, course-flagged later).
function pickProvider(): SigningProvider {
  if (process.env.DOCUSEAL_API_KEY && process.env.SIGNING_PROVIDER === 'docuseal') {
    return docusealProvider;
  }
  return inAppProvider;
}

export async function signCourseDocument(opts: {
  enrollmentId: string;
  userId: string;
  documentSlug: string;
  payload: unknown;
  req: Request;
}) {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: opts.enrollmentId },
    include: { course: true },
  });
  if (!enrollment) throw new NotFoundError('Enrollment');
  if (enrollment.userId !== opts.userId) throw new ForbiddenError();
  if (enrollment.declinedAt) throw new ValidationError('Enrollment was declined');
  if (enrollment.completedAt) throw new ValidationError('Enrollment is already complete');

  // Before allowing any document to be signed, require all module quizzes
  // (in this enrollment's course) to be passed. This enforces "comprehension
  // before consent" — a key legal-defensibility lever.
  const requiredQuizModuleIds = await prisma.courseModule.findMany({
    where: { courseId: enrollment.courseId, quiz: { isNot: null } },
    select: { id: true },
  });
  const passed = await prisma.moduleProgress.findMany({
    where: { enrollmentId: enrollment.id, quizPassed: true },
    select: { moduleId: true },
  });
  const passedSet = new Set(passed.map((p) => p.moduleId));
  const allPassed = requiredQuizModuleIds.every((m) => passedSet.has(m.id));
  if (!allPassed) {
    throw new ValidationError('All module quizzes must be passed before signing documents');
  }

  const document = await prisma.courseDocument.findUnique({
    where: { courseId_slug: { courseId: enrollment.courseId, slug: opts.documentSlug } },
  });
  if (!document) throw new NotFoundError('Course document');

  // Idempotency: if there's already a signature for this (enrollment, document,
  // version), return the existing row. The first-time signing moment is the
  // legally meaningful one; we never overwrite it.
  const existing = await prisma.documentSignature.findUnique({
    where: {
      enrollmentId_courseDocumentId_documentVersion: {
        enrollmentId: enrollment.id,
        courseDocumentId: document.id,
        documentVersion: document.version,
      },
    },
  });
  if (existing) {
    return { signature: existing, alreadySigned: true };
  }

  const user = await prisma.user.findUnique({ where: { id: opts.userId } });
  if (!user) throw new NotFoundError('User');

  const provider = pickProvider();
  const signature = await provider.sign(
    { user, enrollment, document, req: opts.req },
    { payload: opts.payload },
  );

  await logActivity({
    userId: opts.userId,
    action: 'document_signed',
    targetType: 'course_document',
    targetId: document.id,
    details: {
      enrollmentId: enrollment.id,
      courseSlug: enrollment.course.slug,
      documentSlug: document.slug,
      documentVersion: document.version,
      provider: signature.externalProvider ?? 'in-app',
    },
  });

  // Try to flip the enrollment to completed. Idempotent — only completes when
  // every required document is signed AND every required quiz is passed.
  await tryMarkEnrollmentCompleted(enrollment.id);

  return { signature, alreadySigned: false };
}

// Forensic read for admins. Returns the FULL signature record including the
// signed text snapshot, IP, UA, etc. — the artifact you'd hand to legal counsel.
export async function getUserOnboardingForensics(userId: string) {
  return prisma.enrollment.findMany({
    where: { userId },
    include: {
      course: {
        select: {
          id: true,
          slug: true,
          title: true,
          version: true,
          isMandatoryOnHire: true,
        },
      },
      signatures: {
        include: {
          courseDocument: { select: { id: true, slug: true, title: true, version: true } },
        },
        orderBy: { signedAt: 'asc' },
      },
      quizAttempts: {
        include: { quiz: { select: { id: true, moduleId: true } } },
        orderBy: { startedAt: 'asc' },
      },
      moduleProgress: {
        include: { module: { select: { id: true, title: true, order: true } } },
      },
    },
    orderBy: { enrolledAt: 'asc' },
  });
}
