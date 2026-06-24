import prisma from '../config/database';
import { logActivity } from './activity.service';

// Batch maintenance — finds expired completed enrollments for mandatory courses
// and creates fresh enrollments at the current course version + next cycle.
// Idempotent: re-running won't double-create.
//
// Designed to be called by either:
//   - admin-triggered "Run annual expiry" button (current Phase 3 surface), or
//   - a daily scheduled task (cron / external scheduler — whatever the team uses)
//
// What it does NOT do: it never overwrites historical enrollments. Past
// completions remain immutable evidence; a new row is created for re-ack.

interface ExpiryResult {
  scanned: number;
  refreshed: number;
  refreshedUserIds: string[];
}

export async function expireStaleCompletions(triggeredByUserId: string | null): Promise<ExpiryResult> {
  const now = new Date();

  // Find every completed enrollment for a mandatory course whose expiry is in
  // the past. We process per-user-per-course (the (userId, courseId) pair is
  // what matters; we may have multiple historic completions and we only act on
  // the latest one).
  const candidates = await prisma.enrollment.findMany({
    where: {
      completedAt: { not: null },
      declinedAt: null,
      expiresAt: { lt: now },
      course: { isMandatoryOnHire: true, status: 'PUBLISHED' },
    },
    include: {
      course: { select: { id: true, slug: true, version: true, title: true } },
    },
    orderBy: [{ enrolledAt: 'desc' }, { cycle: 'desc' }],
  });

  // Deduplicate to "latest per (user, course)".
  const latestByPair = new Map<string, (typeof candidates)[number]>();
  for (const e of candidates) {
    const key = `${e.userId}::${e.courseId}`;
    if (!latestByPair.has(key)) latestByPair.set(key, e);
  }

  let refreshed = 0;
  const refreshedUserIds: string[] = [];

  for (const e of latestByPair.values()) {
    // Skip if a NEWER enrollment exists for this (user, course) — this means
    // the user has already been re-prompted via another path.
    const newer = await prisma.enrollment.findFirst({
      where: {
        userId: e.userId,
        courseId: e.courseId,
        OR: [{ courseVersion: { gt: e.courseVersion } }, { cycle: { gt: e.cycle } }],
      },
    });
    if (newer) continue;

    // Find the latest cycle at the CURRENT course version (may already exist
    // in some race; if so, no-op).
    const sameVersionLatest = await prisma.enrollment.findFirst({
      where: { userId: e.userId, courseId: e.courseId, courseVersion: e.course.version },
      orderBy: { cycle: 'desc' },
    });
    if (sameVersionLatest && !sameVersionLatest.completedAt && !sameVersionLatest.declinedAt) {
      // Already in progress at current version — nothing to do.
      continue;
    }
    const nextCycle = (sameVersionLatest?.cycle ?? 0) + 1;

    await prisma.enrollment.create({
      data: {
        userId: e.userId,
        courseId: e.courseId,
        courseVersion: e.course.version,
        cycle: nextCycle,
      },
    });

    // Blank the convenience flag so /auth/me reports them as non-compliant.
    await prisma.user.update({ where: { id: e.userId }, data: { onboardingCompletedAt: null } });

    refreshed += 1;
    refreshedUserIds.push(e.userId);

    await logActivity({
      userId: triggeredByUserId ?? e.userId,
      action: 'course_acknowledgment_expired',
      targetType: 'course',
      targetId: e.courseId,
      details: {
        courseSlug: e.course.slug,
        courseTitle: e.course.title,
        userId: e.userId,
        previousCycle: e.cycle,
        newCycle: nextCycle,
        previousExpiresAt: e.expiresAt?.toISOString() ?? null,
      },
    });
  }

  return {
    scanned: latestByPair.size,
    refreshed,
    refreshedUserIds,
  };
}

// Force-expire ALL completions for a specific course (admin "force everyone to
// re-ack now" button, e.g., after a regulatory event). Different from version
// bump in that it preserves the same course version — we just blank the
// convenience flag and create new in-progress enrollments at next cycle.
export async function forceExpireCourseCompletions(
  courseId: string,
  triggeredByUserId: string,
): Promise<ExpiryResult> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, slug: true, title: true, version: true, isMandatoryOnHire: true },
  });
  if (!course) throw new Error('Course not found');

  const now = new Date();

  // Find latest completed enrollment per user for this course.
  const latest = await prisma.$queryRaw<Array<{ id: string; userId: string; cycle: number; courseVersion: number }>>`
    SELECT DISTINCT ON ("userId") id, "userId", "cycle", "courseVersion"
    FROM "enrollments"
    WHERE "courseId" = ${courseId} AND "completedAt" IS NOT NULL AND "declinedAt" IS NULL
    ORDER BY "userId", "enrolledAt" DESC, "cycle" DESC
  `;

  let refreshed = 0;
  const refreshedUserIds: string[] = [];

  for (const e of latest) {
    const sameVersionLatest = await prisma.enrollment.findFirst({
      where: { userId: e.userId, courseId, courseVersion: course.version },
      orderBy: { cycle: 'desc' },
    });
    if (sameVersionLatest && !sameVersionLatest.completedAt && !sameVersionLatest.declinedAt) continue;
    const nextCycle = (sameVersionLatest?.cycle ?? 0) + 1;

    // Mark the existing latest enrollment as expired NOW (so audit trail is correct).
    await prisma.enrollment.update({
      where: { id: e.id },
      data: { expiresAt: now },
    });

    await prisma.enrollment.create({
      data: {
        userId: e.userId,
        courseId,
        courseVersion: course.version,
        cycle: nextCycle,
      },
    });

    if (course.isMandatoryOnHire) {
      await prisma.user.update({ where: { id: e.userId }, data: { onboardingCompletedAt: null } });
    }

    refreshed += 1;
    refreshedUserIds.push(e.userId);
  }

  await logActivity({
    userId: triggeredByUserId,
    action: 'course_force_expired',
    targetType: 'course',
    targetId: courseId,
    details: { courseSlug: course.slug, refreshed },
  });

  return { scanned: latest.length, refreshed, refreshedUserIds };
}
