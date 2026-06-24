import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { logActivity } from './activity.service';
import { gradeQuizSubmission, SubmittedAnswer } from './course.service';
import { validateLegalName, legalNameMatches } from '@exargen/shared';

// Enrollment lifecycle:
//   created (auto on hire) → in progress (modules + quizzes) → all docs signed
//   → completedAt set → User.onboardingCompletedAt synced.
// `declinedAt` is terminal: a declined enrollment is permanent legal evidence
// that the user refused, and produces no DocumentSignature rows.

export async function enrollUserInCourse(userId: string, courseId: string) {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, version: true, slug: true, title: true },
  });
  if (!course) throw new NotFoundError('Course');

  // Find the user's most recent enrollment for this course at the current
  // version. If it exists and isn't expired/declined, reuse it (idempotent).
  // Otherwise create a new enrollment at the next cycle for the current
  // course version. The unique constraint is (userId, courseId, courseVersion, cycle).
  const latest = await prisma.enrollment.findFirst({
    where: { userId, courseId, courseVersion: course.version },
    orderBy: { cycle: 'desc' },
  });

  if (latest && !latest.declinedAt) {
    // Active or completed-but-not-yet-expired — reuse it.
    if (!latest.completedAt) return latest;
    if (latest.expiresAt === null || latest.expiresAt > new Date()) return latest;
    // else: expired completion → fall through and create a new cycle.
  }

  const nextCycle = (latest?.cycle ?? 0) + 1;

  return prisma.enrollment.create({
    data: {
      userId,
      courseId,
      courseVersion: course.version,
      cycle: nextCycle,
    },
  });
}

export async function getEnrollmentForUser(enrollmentId: string, userId: string) {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      course: { select: { id: true, slug: true, title: true, version: true, passingScore: true } },
      moduleProgress: true,
      quizAttempts: { orderBy: { startedAt: 'desc' } },
      signatures: {
        select: {
          id: true,
          courseDocumentId: true,
          documentVersion: true,
          signedAt: true,
          signedName: true,
        },
      },
    },
  });
  if (!enrollment) throw new NotFoundError('Enrollment');
  if (enrollment.userId !== userId) throw new ForbiddenError();
  return enrollment;
}

export async function listMyActiveEnrollments(userId: string) {
  return prisma.enrollment.findMany({
    where: {
      userId,
      completedAt: null,
      declinedAt: null,
    },
    include: {
      course: {
        select: {
          id: true,
          slug: true,
          title: true,
          description: true,
          version: true,
          passingScore: true,
        },
      },
      // Cheap progress signal so the UI can show "Continue" instead of
      // "Start course" once the user has touched any module or signed any
      // policy. Counts only — no row hydration.
      _count: { select: { moduleProgress: true, signatures: true } },
    },
    orderBy: { enrolledAt: 'asc' },
  });
}

export async function listMyCompletedEnrollments(userId: string) {
  return prisma.enrollment.findMany({
    where: { userId, completedAt: { not: null } },
    include: {
      course: { select: { id: true, slug: true, title: true, version: true } },
    },
    orderBy: { completedAt: 'desc' },
  });
}

// ─── Module progress (heartbeat) ───
//
// Called repeatedly by the client as they read a module. We treat this as
// monotonic — never decrease values. Once `scrolledToBottom` is true it stays
// true. Once `quizPassed` is true it stays true.

export interface ModuleHeartbeat {
  scrolledToBottom?: boolean;
  timeOnPageSec?: number;
}

export async function recordModuleProgress(
  enrollmentId: string,
  userId: string,
  moduleId: string,
  hb: ModuleHeartbeat,
) {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    select: { id: true, userId: true, courseId: true, completedAt: true, declinedAt: true },
  });
  if (!enrollment) throw new NotFoundError('Enrollment');
  if (enrollment.userId !== userId) throw new ForbiddenError();
  if (enrollment.declinedAt) throw new ValidationError('Enrollment was declined');

  // Validate the module belongs to this enrollment's course.
  const mod = await prisma.courseModule.findUnique({
    where: { id: moduleId },
    select: { id: true, courseId: true },
  });
  if (!mod || mod.courseId !== enrollment.courseId) throw new NotFoundError('Module');

  const existing = await prisma.moduleProgress.findUnique({
    where: { enrollmentId_moduleId: { enrollmentId, moduleId } },
  });

  if (!existing) {
    return prisma.moduleProgress.create({
      data: {
        enrollmentId,
        moduleId,
        scrolledToBottom: hb.scrolledToBottom ?? false,
        timeOnPageSec: hb.timeOnPageSec ?? 0,
      },
    });
  }

  return prisma.moduleProgress.update({
    where: { enrollmentId_moduleId: { enrollmentId, moduleId } },
    data: {
      scrolledToBottom: existing.scrolledToBottom || (hb.scrolledToBottom ?? false),
      timeOnPageSec: Math.max(existing.timeOnPageSec, hb.timeOnPageSec ?? 0),
    },
  });
}

// ─── Quiz submission ───

export async function submitQuizAttempt(
  enrollmentId: string,
  userId: string,
  quizId: string,
  answers: SubmittedAnswer[],
) {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    select: { id: true, userId: true, courseId: true, declinedAt: true, completedAt: true },
  });
  if (!enrollment) throw new NotFoundError('Enrollment');
  if (enrollment.userId !== userId) throw new ForbiddenError();
  if (enrollment.declinedAt) throw new ValidationError('Enrollment was declined');

  // Verify the quiz belongs to a module in this enrollment's course.
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    select: { id: true, allowRetry: true, module: { select: { id: true, courseId: true } } },
  });
  if (!quiz || quiz.module.courseId !== enrollment.courseId) throw new NotFoundError('Quiz');

  // If quiz already passed in a prior attempt and retries aren't allowed, refuse.
  const priorPassed = await prisma.quizAttempt.findFirst({
    where: { enrollmentId, quizId, passed: true },
  });
  if (priorPassed && !quiz.allowRetry) {
    throw new ValidationError('This quiz has already been passed and does not allow retakes');
  }

  const priorAttempts = await prisma.quizAttempt.count({
    where: { enrollmentId, quizId },
  });

  const graded = await gradeQuizSubmission(quizId, answers);

  const attempt = await prisma.quizAttempt.create({
    data: {
      enrollmentId,
      quizId,
      attemptNumber: priorAttempts + 1,
      submittedAt: new Date(),
      scorePercent: graded.scorePercent,
      passed: graded.passed,
      answers: graded.answers as unknown as Prisma.InputJsonValue,
    },
  });

  // If passed, mark the module's progress accordingly.
  if (graded.passed) {
    await prisma.moduleProgress.upsert({
      where: { enrollmentId_moduleId: { enrollmentId, moduleId: quiz.module.id } },
      create: {
        enrollmentId,
        moduleId: quiz.module.id,
        scrolledToBottom: true, // implied — quiz passed means content was seen
        quizPassed: true,
        completedAt: new Date(),
      },
      update: { quizPassed: true, completedAt: new Date() },
    });

    // 2026-05-22 bug fix (Pankaj report): enrollment-level completion
    // was previously triggered only after a signature landed. If the
    // user signed FIRST and quizzed LAST, the enrollment stayed
    // "in_progress" forever because nobody re-checked the gates after
    // the quiz passed. Run the check here too so completion is
    // order-independent: whichever gate finishes LAST flips the
    // enrollment to completed.
    await tryMarkEnrollmentCompleted(enrollmentId);
  }

  await logActivity({
    userId,
    action: 'quiz_attempted',
    targetType: 'quiz',
    targetId: quizId,
    details: {
      enrollmentId,
      attemptNumber: attempt.attemptNumber,
      scorePercent: graded.scorePercent,
      passed: graded.passed,
    },
  });

  return {
    attemptId: attempt.id,
    attemptNumber: attempt.attemptNumber,
    scorePercent: graded.scorePercent,
    passed: graded.passed,
    passingScore: graded.passingScore,
    // Surface per-question correctness so the UI can show "you missed Q3" without
    // revealing the correct answer. We only return correctness flags, not which
    // option was correct.
    perQuestion: graded.answers.map((a) => ({ questionId: a.questionId, correct: a.correct })),
  };
}

// ─── Decline ───
//
// Permanent. Once declined, the user can't resume; admins should follow up
// out-of-band. The Activity log captures this with full context.

export async function declineEnrollment(
  enrollmentId: string,
  userId: string,
  ctx: { ipAddress: string | null; userAgent: string | null },
) {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { course: { select: { slug: true, title: true } } },
  });
  if (!enrollment) throw new NotFoundError('Enrollment');
  if (enrollment.userId !== userId) throw new ForbiddenError();
  if (enrollment.declinedAt) return enrollment;
  if (enrollment.completedAt) throw new ValidationError('Enrollment already completed');

  const updated = await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: { declinedAt: new Date() },
  });

  await logActivity({
    userId,
    action: 'course_declined',
    targetType: 'course',
    targetId: enrollment.courseId,
    details: {
      enrollmentId,
      courseSlug: enrollment.course.slug,
      courseTitle: enrollment.course.title,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
  });

  return updated;
}

// ─── Completion (called by signing.service when last document is signed) ───

/**
 * Idempotent completion check. If the enrollment satisfies the full gate
 * (every required document signed AND every required quiz passed) this flips
 * `completedAt` and `expiresAt`, syncs the convenience flag on User, and
 * writes an audit-log entry.
 *
 * `options.completedAtOverride` lets a SUPER_ADMIN backfill use the moment
 * the employee actually finished (max of latest-signature / latest-passed-
 * quiz timestamp) instead of `now`. This matters when re-checking historical
 * enrollments stranded by the pre-PR-#144 quiz-last bug: we want the audit
 * record to show when they really finished, not when we noticed the gate
 * was already green. `expiresAt` is computed from the same base, so an
 * enrollment that historically completed 2 years ago with a 1-year validity
 * window will correctly slot into "out of date" instead of being silently
 * given a fresh year of validity.
 *
 * Live-signing paths (signing.service, submitQuizAttempt) pass no override —
 * `now` is correct there because that *is* when they finished.
 */
export async function tryMarkEnrollmentCompleted(
  enrollmentId: string,
  options: { completedAtOverride?: Date } = {},
) {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      course: {
        select: {
          documents: { select: { id: true } },
          modules: { select: { id: true, quiz: { select: { id: true } } } },
          slug: true,
          title: true,
          isMandatoryOnHire: true,
          acknowledgmentValidityDays: true,
        },
      },
      moduleProgress: true,
      signatures: { select: { courseDocumentId: true } },
    },
  });
  if (!enrollment) return null;
  if (enrollment.completedAt) return enrollment;
  if (enrollment.declinedAt) return enrollment;

  const requiredDocIds = new Set(enrollment.course.documents.map((d) => d.id));
  const signedDocIds = new Set(enrollment.signatures.map((s) => s.courseDocumentId));
  const allDocsSigned = [...requiredDocIds].every((id) => signedDocIds.has(id));

  const requiredQuizModuleIds = enrollment.course.modules.filter((m) => !!m.quiz).map((m) => m.id);
  const passedModuleIds = new Set(
    enrollment.moduleProgress.filter((p) => p.quizPassed).map((p) => p.moduleId),
  );
  const allQuizzesPassed = requiredQuizModuleIds.every((id) => passedModuleIds.has(id));

  if (!allDocsSigned || !allQuizzesPassed) return enrollment;

  // Pick the completion timestamp. Backfills pass the historical moment they
  // actually finished; live paths use `now`. We refuse to backdate past the
  // user's enrollment date (data corruption guard — should never happen).
  const now = new Date();
  const isBackfill = !!options.completedAtOverride;
  const completedAtBase = options.completedAtOverride ?? now;
  const completionTimestamp =
    completedAtBase < enrollment.enrolledAt ? enrollment.enrolledAt : completedAtBase;

  // Compute expiresAt. CRITICAL: for backfills we must NOT propagate the
  // historical timestamp into expiresAt, because three places downstream
  // ((1) the login path in auth.service, (2) the active-enrollment fetcher
  // here, (3) the annual-expiry sweep in onboardingMaintenance) all check
  // `expiresAt <= now` and will treat a backdated expiry as "expired →
  // re-prompt for re-acknowledgment". That would force the very employees
  // and clients we just marked as completed to redo the whole course on
  // their next login — the opposite of the user's intent for this backfill.
  //
  // Resolution: completedAt is historical (for the PDF + audit trail),
  // expiresAt is calculated from MAX(historical, now) so the renewal clock
  // effectively restarts from today. Backfilled rows get the full validity
  // window from the moment the admin ran the sweep. Live signing paths
  // are unaffected (they don't pass an override, so `now` is used for both).
  const validityDays = enrollment.course.acknowledgmentValidityDays ?? 0;
  let expiresAt: Date | null = null;
  if (validityDays > 0) {
    const expiryBase = isBackfill && completionTimestamp < now ? now : completionTimestamp;
    expiresAt = new Date(expiryBase.getTime() + validityDays * 24 * 60 * 60 * 1000);
  }

  const completed = await prisma.enrollment.update({
    where: { id: enrollmentId },
    data: { completedAt: completionTimestamp, expiresAt },
  });

  // Sync the convenience flag on User. Only set it if THIS course is the
  // mandatory onboarding course; non-mandatory courses don't gate platform access.
  if (enrollment.course.isMandatoryOnHire) {
    await prisma.user.update({
      where: { id: enrollment.userId },
      data: { onboardingCompletedAt: completed.completedAt },
    });
  }

  await logActivity({
    userId: enrollment.userId,
    action: 'course_completed',
    targetType: 'course',
    targetId: enrollment.courseId,
    details: {
      enrollmentId,
      courseSlug: enrollment.course.slug,
      courseTitle: enrollment.course.title,
      completedAt: completionTimestamp.toISOString(),
      expiresAt: expiresAt?.toISOString() ?? null,
      // Marks rows whose completedAt was backdated to the real historical
      // moment by a SUPER_ADMIN sweep — useful when auditing why an
      // enrollment shows a completion date earlier than its activity log.
      // `renewalRestartedFromBackfillTime` is true when the historical
      // completedAt was old enough that we restarted the renewal clock from
      // `now` to avoid auto-re-prompting the user. That's why the math
      // `completedAt + validityDays === expiresAt` may not hold on
      // backfilled rows.
      backfilled: isBackfill,
      renewalRestartedFromBackfillTime:
        isBackfill && completionTimestamp < now && validityDays > 0,
    },
  });

  return completed;
}

// ─── Legal-name capture (one-time, before first signature) ───
//
// The user's display `name` is often a first-name shorthand derived
// from the email at lazy-create. That's not defensible as a legal
// signature. We require a separate, typed-out full legal name captured
// once before the first document signing in this enrollment.
//
// Once `user.legalName` is set, the user cannot change it from the
// learner-facing flow — only an admin can edit. This avoids "I just
// fixed my legal name to whatever the next document needs" tampering.
//
// Submitting the same name (case/whitespace-insensitive) when one is
// already on file is a no-op success — the user re-confirmed it.
export async function setLegalNameForEnrollment(
  enrollmentId: string,
  userId: string,
  typedName: string,
) {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    select: { id: true, userId: true, courseId: true, completedAt: true, declinedAt: true },
  });
  if (!enrollment) throw new NotFoundError('Enrollment');
  if (enrollment.userId !== userId) throw new ForbiddenError();
  if (enrollment.declinedAt) throw new ValidationError('Enrollment was declined');
  if (enrollment.completedAt) throw new ValidationError('Enrollment is already complete');

  const validation = validateLegalName(typedName);
  if (!validation.ok) {
    throw new ValidationError(validation.reason ?? 'Invalid legal name.');
  }
  const normalized = validation.normalized;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, legalName: true },
  });
  if (!user) throw new NotFoundError('User');

  if (user.legalName) {
    // Already on file — re-confirmation must match. We never overwrite a
    // legal name from the learner-facing path; an admin must edit it.
    if (!legalNameMatches(typedName, user.legalName)) {
      throw new ValidationError(
        'Your legal name on file is different. Contact an admin to correct it.',
      );
    }
    return { legalName: user.legalName, action: 'unchanged' as const };
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { legalName: normalized },
    select: { id: true, legalName: true },
  });

  await logActivity({
    userId,
    action: 'legal_name_captured',
    targetType: 'user',
    targetId: userId,
    details: { enrollmentId, courseId: enrollment.courseId, length: normalized.length },
  });

  return { legalName: updated.legalName!, action: 'created' as const };
}
