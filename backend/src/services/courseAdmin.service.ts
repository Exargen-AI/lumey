import prisma from '../config/database';
import { NotFoundError, ValidationError } from '../utils/errors';
import { logActivity } from './activity.service';

// Admin-side course operations: read with stats, edit document text + bump
// versions. Authoring of modules / quizzes is intentionally NOT here in v1 —
// the seed script is the source of truth for module structure. The most
// legally meaningful edit (and the one HR/legal will actually run) is
// "lawyer reviewed our NDA, here's the updated text" — that flow is
// supported with full version-bump semantics.

export async function listCoursesForAdmin() {
  const courses = await prisma.course.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: { modules: true, documents: true, enrollments: true },
      },
    },
  });

  // Get per-course completion stats in one go.
  const stats = await prisma.enrollment.groupBy({
    by: ['courseId'],
    _count: { _all: true },
  });
  const completedStats = await prisma.enrollment.groupBy({
    by: ['courseId'],
    where: { completedAt: { not: null } },
    _count: { _all: true },
  });
  const declinedStats = await prisma.enrollment.groupBy({
    by: ['courseId'],
    where: { declinedAt: { not: null } },
    _count: { _all: true },
  });

  const byCourse = new Map<string, { total: number; completed: number; declined: number }>();
  stats.forEach((s) => byCourse.set(s.courseId, { total: s._count._all, completed: 0, declined: 0 }));
  completedStats.forEach((s) => {
    const x = byCourse.get(s.courseId);
    if (x) x.completed = s._count._all;
  });
  declinedStats.forEach((s) => {
    const x = byCourse.get(s.courseId);
    if (x) x.declined = s._count._all;
  });

  return courses.map((c) => ({
    id: c.id,
    slug: c.slug,
    title: c.title,
    description: c.description,
    version: c.version,
    isMandatoryOnHire: c.isMandatoryOnHire,
    passingScore: c.passingScore,
    acknowledgmentValidityDays: c.acknowledgmentValidityDays,
    applicableRoles: c.applicableRoles,
    status: c.status,
    publishedAt: c.publishedAt,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    counts: {
      modules: c._count.modules,
      documents: c._count.documents,
      totalEnrollments: c._count.enrollments,
      completed: byCourse.get(c.id)?.completed ?? 0,
      declined: byCourse.get(c.id)?.declined ?? 0,
      inProgress:
        c._count.enrollments -
        (byCourse.get(c.id)?.completed ?? 0) -
        (byCourse.get(c.id)?.declined ?? 0),
    },
  }));
}

export async function getCourseForAdmin(id: string) {
  const course = await prisma.course.findUnique({
    where: { id },
    include: {
      modules: {
        orderBy: { order: 'asc' },
        include: {
          quiz: {
            include: { questions: { orderBy: { order: 'asc' } } },
          },
        },
      },
      documents: { orderBy: { order: 'asc' } },
    },
  });
  if (!course) throw new NotFoundError('Course');
  // Admin sees the FULL question options including isCorrect — they need it
  // to author/review answers. Learners see the sanitized version.
  return course;
}

// Edit a document's body text. Mandatory side-effects:
//   1. bump CourseDocument.version
//   2. bump Course.version (so completed enrollments are re-flagged out-of-date)
//   3. log to activity feed
// Old DocumentSignature rows are immutable and remain — they pin an older
// document version, which is exactly the legally-defensible behavior.
export async function updateCourseDocumentBody(
  courseId: string,
  documentId: string,
  bodyText: string,
  actorUserId: string,
) {
  const trimmed = bodyText.trim();
  if (trimmed.length < 50) {
    throw new ValidationError('Document body must be at least 50 characters');
  }

  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) throw new NotFoundError('Course');

  const document = await prisma.courseDocument.findUnique({ where: { id: documentId } });
  if (!document || document.courseId !== courseId) throw new NotFoundError('Course document');

  // No-op if body is unchanged.
  if (document.bodyText === bodyText) return { course, document };

  const result = await prisma.$transaction(async (tx) => {
    const updatedDoc = await tx.courseDocument.update({
      where: { id: documentId },
      data: { bodyText, version: { increment: 1 } },
    });
    const updatedCourse = await tx.course.update({
      where: { id: courseId },
      data: { version: { increment: 1 } },
    });
    return { course: updatedCourse, document: updatedDoc };
  });

  await logActivity({
    userId: actorUserId,
    action: 'course_document_updated',
    targetType: 'course_document',
    targetId: documentId,
    details: {
      courseId,
      courseSlug: course.slug,
      documentSlug: document.slug,
      newDocumentVersion: result.document.version,
      newCourseVersion: result.course.version,
    },
  });

  return result;
}

// Manually bump course version without editing any document. Useful when an
// admin updates the course description, applicable roles, or just wants to
// force re-acknowledgment for a compliance reason.
export async function bumpCourseVersion(courseId: string, actorUserId: string, note?: string) {
  const course = await prisma.course.findUnique({ where: { id: courseId } });
  if (!course) throw new NotFoundError('Course');

  const updated = await prisma.course.update({
    where: { id: courseId },
    data: { version: { increment: 1 } },
  });

  await logActivity({
    userId: actorUserId,
    action: 'course_version_bumped',
    targetType: 'course',
    targetId: courseId,
    details: { courseSlug: course.slug, newVersion: updated.version, note: note ?? null },
  });

  return updated;
}
