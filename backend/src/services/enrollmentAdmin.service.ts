import prisma from '../config/database';
import { NotFoundError, ValidationError } from '../utils/errors';
import { createNotification } from './notification.service';
import { logActivity } from './activity.service';
import { tryMarkEnrollmentCompleted } from './enrollment.service';

// Admin views over enrollments + onboarding compliance status.

export interface EnrollmentAdminFilters {
  courseId?: string;
  status?: 'in_progress' | 'completed' | 'declined' | 'out_of_date';
}

// Returns a flat list with user info + status for the admin enrollments page.
// The "status" field is computed from completedAt / declinedAt / version
// staleness — the API consumer should not have to derive it.
export async function listEnrollmentsForAdmin(filters: EnrollmentAdminFilters) {
  const where: any = {};
  if (filters.courseId) where.courseId = filters.courseId;
  if (filters.status === 'completed') where.completedAt = { not: null };
  if (filters.status === 'declined') where.declinedAt = { not: null };
  if (filters.status === 'in_progress') {
    where.completedAt = null;
    where.declinedAt = null;
  }

  const rows = await prisma.enrollment.findMany({
    where,
    include: {
      user: { select: { id: true, name: true, email: true, role: true, isActive: true } },
      course: {
        select: {
          id: true,
          slug: true,
          title: true,
          version: true,
          // Per-course gate definition — needed so each row can report
          // "Sigs N/M · Quiz P/Q" (i.e. how close it is to meeting the
          // completion gate). Admins use this to spot which historical
          // rows are stuck because of the bug vs. genuinely incomplete.
          documents: { select: { id: true } },
          modules: { select: { id: true, quiz: { select: { id: true } } } },
        },
      },
      // Distinct-by-document. The completion gate is "every required doc
      // signed once" — re-signing after a version bump counts as one for
      // gate purposes.
      signatures: { select: { courseDocumentId: true, signedAt: true } },
      moduleProgress: {
        select: { moduleId: true, quizPassed: true, completedAt: true },
      },
      _count: { select: { signatures: true, quizAttempts: true } },
    },
    orderBy: [{ enrolledAt: 'desc' }],
  });

  let result = rows.map((e) => {
    const outOfDate = !!e.completedAt && e.courseVersion < e.course.version;
    let status: 'in_progress' | 'completed' | 'declined' | 'out_of_date' = 'in_progress';
    if (e.declinedAt) status = 'declined';
    else if (outOfDate) status = 'out_of_date';
    else if (e.completedAt) status = 'completed';

    // Gate progress — these mirror tryMarkEnrollmentCompleted's two checks
    // so the UI can show admins what's missing.
    const requiredDocIds = new Set(e.course.documents.map((d) => d.id));
    const signedDocIds = new Set(e.signatures.map((s) => s.courseDocumentId));
    const signaturesUnique = [...requiredDocIds].filter((id) => signedDocIds.has(id)).length;
    const requiredQuizModuleIds = e.course.modules.filter((m) => !!m.quiz).map((m) => m.id);
    const passedModuleIds = new Set(
      e.moduleProgress.filter((p) => p.quizPassed).map((p) => p.moduleId),
    );
    const quizzesPassed = requiredQuizModuleIds.filter((id) => passedModuleIds.has(id)).length;

    // Latest historical activity — useful when an admin needs to backdate
    // a completion to the real moment the employee finished.
    const latestSignatureAt = e.signatures.reduce<Date | null>(
      (acc, s) => (acc && acc > s.signedAt ? acc : s.signedAt),
      null,
    );

    return {
      id: e.id,
      enrolledAt: e.enrolledAt,
      completedAt: e.completedAt,
      declinedAt: e.declinedAt,
      courseVersion: e.courseVersion,
      currentCourseVersion: e.course.version,
      user: e.user,
      course: { id: e.course.id, slug: e.course.slug, title: e.course.title },
      counts: { signatures: e._count.signatures, quizAttempts: e._count.quizAttempts },
      // Gate diagnostics. Required vs satisfied, both for signatures (by
      // distinct document) and quizzes (by module). When `signaturesUnique
      // === requiredDocuments && quizzesPassed === requiredQuizzes` the
      // row should auto-flip on the next `Re-check open enrollments`.
      gate: {
        requiredDocuments: requiredDocIds.size,
        signaturesUnique,
        requiredQuizzes: requiredQuizModuleIds.length,
        quizzesPassed,
        latestSignatureAt,
        gateMet:
          signaturesUnique === requiredDocIds.size &&
          quizzesPassed === requiredQuizModuleIds.length,
      },
      status,
    };
  });

  if (filters.status === 'out_of_date') {
    result = result.filter((r) => r.status === 'out_of_date');
  }

  return result;
}

// Aggregate stats for the dashboard cards — total enrolled, completed,
// completion rate, by-role breakdown.
export async function getCourseEnrollmentStats(courseId: string) {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, slug: true, title: true, version: true, applicableRoles: true },
  });
  if (!course) throw new NotFoundError('Course');

  const all = await prisma.enrollment.findMany({
    where: { courseId },
    select: {
      id: true,
      courseVersion: true,
      completedAt: true,
      declinedAt: true,
      user: { select: { role: true, isActive: true } },
    },
  });

  const total = all.length;
  const completed = all.filter((e) => !!e.completedAt && e.courseVersion === course.version).length;
  const outOfDate = all.filter((e) => !!e.completedAt && e.courseVersion < course.version).length;
  const declined = all.filter((e) => !!e.declinedAt).length;
  const inProgress = total - completed - outOfDate - declined;

  // By-role breakdown for active users.
  const byRole = new Map<string, { total: number; completed: number }>();
  for (const e of all) {
    if (!e.user.isActive) continue;
    const r = e.user.role;
    if (!byRole.has(r)) byRole.set(r, { total: 0, completed: 0 });
    byRole.get(r)!.total += 1;
    if (e.completedAt && e.courseVersion === course.version) byRole.get(r)!.completed += 1;
  }

  return {
    course: { id: course.id, slug: course.slug, title: course.title, version: course.version },
    total,
    completed,
    outOfDate,
    declined,
    inProgress,
    completionPercent: total > 0 ? Math.round((completed / total) * 100) : 0,
    byRole: Array.from(byRole.entries()).map(([role, c]) => ({
      role,
      total: c.total,
      completed: c.completed,
      completionPercent: c.total > 0 ? Math.round((c.completed / c.total) * 100) : 0,
    })),
  };
}

// "Send reminder" — admin action that creates a Notification visible in the
// user's bell. Throttled at the service level: refuses to send another
// reminder for the same enrollment within a 24-hour window. Audit-logged.
export async function sendEnrollmentReminder(enrollmentId: string, actorUserId: string) {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      user: { select: { id: true, name: true, email: true } },
      course: { select: { id: true, slug: true, title: true } },
    },
  });
  if (!enrollment) throw new NotFoundError('Enrollment');
  if (enrollment.completedAt) throw new ValidationError('Enrollment is already complete; no reminder needed');
  if (enrollment.declinedAt) throw new ValidationError('Enrollment was declined; reminder not applicable');

  // Throttle: don't spam. Look up the most recent reminder we've sent.
  const sinceCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await prisma.notification.findFirst({
    where: {
      userId: enrollment.userId,
      type: 'onboarding_reminder',
      createdAt: { gt: sinceCutoff },
    },
  });
  if (recent) {
    throw new ValidationError('A reminder was already sent in the last 24 hours');
  }

  // Admin-initiated onboarding reminders bypass user mute preferences.
  // Operational rationale: the actor is a SUPER_ADMIN who deliberately
  // clicked "send reminder" — the platform's compliance need (legally-
  // mandated training completion) outweighs the user's preference to
  // suppress this specific notification. The non-admin onboarding ping
  // (e.g. an automatic ping when a user is enrolled) does NOT bypass.
  const notification = await createNotification({
    userId: enrollment.userId,
    type: 'onboarding_reminder',
    title: 'Action required: complete your onboarding',
    body: `Please complete the "${enrollment.course.title}" course to regain platform access.`,
    link: '/',
    bypassMute: true,
  });

  await logActivity({
    userId: actorUserId,
    action: 'onboarding_reminder_sent',
    targetType: 'enrollment',
    targetId: enrollmentId,
    details: {
      recipientUserId: enrollment.userId,
      recipientEmail: enrollment.user.email,
      courseSlug: enrollment.course.slug,
    },
  });

  return { id: notification.id, sentAt: notification.createdAt };
}

/**
 * 2026-05-22 backfill (Pankaj reported: "everything shows in progress,
 * nothing shows completed"). Before today's enrollment-fix shipped, the
 * `submitQuizAttempt` path didn't trigger the enrollment-level
 * completion check — so any user who signed all required documents
 * FIRST and then passed the quiz LAST got their enrollment stuck
 * in_progress forever (the gates were satisfied, but nobody flipped
 * `completedAt`).
 *
 * This admin-only sweep walks every still-open enrollment and runs the
 * same `tryMarkEnrollmentCompleted` check the live paths now invoke.
 * Idempotent: enrollments that genuinely aren't ready (missing
 * signature or quiz) stay open and become a no-op. Safe to run
 * repeatedly — produces the same result.
 *
 * Returns a summary so the admin UI can show "scanned N, completed M".
 */
export async function recheckOpenEnrollments(actorUserId: string) {
  const open = await prisma.enrollment.findMany({
    where: {
      completedAt: null,
      declinedAt: null,
    },
    select: {
      id: true,
      // Pull every historical timestamp we'll need to compute the real
      // moment the employee finished, so the backfill writes an authentic
      // completedAt rather than today's date. The PDF receipts already
      // surface per-signature `signedAt` from the Signature rows — this
      // makes the enrollment-level "Completed at" agree with them.
      signatures: { select: { signedAt: true } },
      moduleProgress: {
        where: { quizPassed: true },
        select: { completedAt: true, startedAt: true },
      },
    },
  });

  let completed = 0;
  let scanned = 0;
  for (const row of open) {
    scanned += 1;
    try {
      // The "real" completion moment is the latest of: every signature's
      // signedAt + every passed-quiz moduleProgress.completedAt. If the
      // module-progress completedAt is null (older rows where we only
      // recorded startedAt), fall back to startedAt. If neither set has
      // data we let the function default to `now` — it'll be a no-op
      // anyway because the gate requires at least one signature.
      const candidateTimestamps: Date[] = [
        ...row.signatures.map((s) => s.signedAt),
        ...row.moduleProgress.map((p) => p.completedAt ?? p.startedAt),
      ].filter((d): d is Date => d instanceof Date);
      const historical =
        candidateTimestamps.length > 0
          ? new Date(Math.max(...candidateTimestamps.map((d) => d.getTime())))
          : undefined;

      const result = await tryMarkEnrollmentCompleted(row.id, {
        completedAtOverride: historical,
      });
      if (result?.completedAt) completed += 1;
    } catch {
      // The check is best-effort across the batch — one bad row
      // (e.g. course was deleted mid-sweep) doesn't block the rest.
    }
  }

  await logActivity({
    userId: actorUserId,
    action: 'recheck_open_enrollments',
    targetType: 'enrollment',
    targetId: 'batch',
    details: { scanned, completed, historicalBackfill: true },
  });

  return { scanned, completed };
}
