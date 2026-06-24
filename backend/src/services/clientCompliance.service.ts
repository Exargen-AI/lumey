import { UserRole } from '@prisma/client';
import prisma from '../config/database';

/**
 * Client-facing compliance summary for a project.
 *
 * For a given project, returns the project's INTERNAL team members
 * (admins, PMs, engineers — not other clients) and, per member, the
 * mandatory compliance courses + per-document signature dates.
 *
 * What clients see vs. what admins see:
 *   - The admin compliance audit page surfaces forensic detail (IP,
 *     userAgent, signedTextSnapshot, externalEnvelopeId). NONE of that
 *     leaves this endpoint — clients don't need or want forensic data.
 *   - The shape here is: who signed what, when. That's enough for the
 *     trust signal we're after ("yes, your engineer signed an NDA on
 *     this date").
 *   - Members whose courses are still incomplete show up with
 *     `signedAt: null` so the client sees them as "pending" rather
 *     than a missing row (which would read as "this person isn't on
 *     the project").
 *
 * Course scoping:
 *   - Only PUBLISHED courses with `applicableRoles` overlapping internal
 *     team roles (everything except CLIENT). A course that's
 *     CLIENT-only doesn't show on this view — clients don't need to see
 *     a list of agreements they themselves haven't signed.
 *
 * Ordering:
 *   - Members sorted by role (most senior first) then name. Helps the
 *     "who's leading the project" read at a glance.
 *   - Documents per member follow `CourseDocument.order` so NDA-IP-
 *     conduct-security reads in the deliberate sequence the team
 *     authored.
 */

const TEAM_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.ADMIN,
  UserRole.PRODUCT_MANAGER,
  UserRole.ENGINEER,
];

const ROLE_RANK: Record<UserRole, number> = {
  [UserRole.SUPER_ADMIN]: 0,
  [UserRole.ADMIN]: 1,
  [UserRole.PRODUCT_MANAGER]: 2,
  [UserRole.ENGINEER]: 3,
  [UserRole.CLIENT]: 4,
  [UserRole.TESTING]: 0,
};

export interface ComplianceMember {
  userId: string;
  name: string;
  role: UserRole;
  company: string | null;
  /** Aggregate convenience flag — true iff every applicable document is signed. */
  allSigned: boolean;
  documents: Array<{
    courseSlug: string;
    courseTitle: string;
    documentSlug: string;
    documentTitle: string;
    documentVersion: number | null;
    signedAt: string | null; // ISO; null = not yet signed
    signedName: string | null; // null until the user signs
  }>;
}

export interface ComplianceSummary {
  projectId: string;
  generatedAt: string;
  members: ComplianceMember[];
  /** Number of distinct (member × document) pairs counted in this view. */
  totalAgreements: number;
  /** Of those, how many have a signedAt set. */
  signedAgreements: number;
}

export async function getProjectCompliance(projectId: string): Promise<ComplianceSummary> {
  // Pull the internal-team membership for this project. We intentionally
  // omit CLIENT members — the audience for this view is a client; they
  // don't get to see other clients on the same project (different
  // confidentiality posture).
  const members = await prisma.projectMember.findMany({
    where: {
      projectId,
      user: {
        isActive: true,
        role: { in: TEAM_ROLES },
      },
    },
    include: {
      user: {
        select: { id: true, name: true, role: true, company: true },
      },
    },
  });

  // Sort members by role rank then name. JS sort is stable, which is
  // fine here.
  members.sort((a, b) => {
    const rankDiff = (ROLE_RANK[a.user.role] ?? 99) - (ROLE_RANK[b.user.role] ?? 99);
    if (rankDiff !== 0) return rankDiff;
    return a.user.name.localeCompare(b.user.name);
  });

  // Published mandatory courses that apply to ANY internal role. The
  // service `isMandatoryOnHire` flag (the NDA/IP/conduct course family)
  // is the right scope for this view — annual refreshers and other
  // courses are out of scope for v1 (they'd dilute the trust signal).
  const courses = await prisma.course.findMany({
    where: {
      status: 'PUBLISHED',
      isMandatoryOnHire: true,
      applicableRoles: { hasSome: TEAM_ROLES },
    },
    include: {
      documents: {
        orderBy: { order: 'asc' },
        select: { id: true, slug: true, title: true, version: true, courseId: true },
      },
    },
  });

  // Index courses + their documents for the per-member loop.
  const documentLookup = new Map<string, { courseSlug: string; courseTitle: string; doc: typeof courses[number]['documents'][number] }>();
  for (const c of courses) {
    for (const d of c.documents) {
      documentLookup.set(d.id, { courseSlug: c.slug, courseTitle: c.title, doc: d });
    }
  }
  const allDocumentIds = [...documentLookup.keys()];
  if (members.length === 0 || allDocumentIds.length === 0) {
    return {
      projectId,
      generatedAt: new Date().toISOString(),
      members: members.map((m) => ({
        userId: m.user.id,
        name: m.user.name,
        role: m.user.role,
        company: m.user.company,
        allSigned: true,
        documents: [],
      })),
      totalAgreements: 0,
      signedAgreements: 0,
    };
  }

  // Pull every signature row that belongs to one of these (members × docs).
  // Joining via the enrollment row keeps the per-member tie strict.
  const memberUserIds = members.map((m) => m.user.id);
  const signatures = await prisma.documentSignature.findMany({
    where: {
      courseDocumentId: { in: allDocumentIds },
      enrollment: {
        userId: { in: memberUserIds },
      },
    },
    select: {
      signedAt: true,
      signedName: true,
      documentVersion: true,
      courseDocumentId: true,
      enrollment: { select: { userId: true } },
    },
    orderBy: { signedAt: 'desc' },
  });

  // Map: userId → courseDocumentId → most-recent signature
  const sigByUserDoc = new Map<string, Map<string, (typeof signatures)[number]>>();
  for (const sig of signatures) {
    const uid = sig.enrollment.userId;
    if (!sigByUserDoc.has(uid)) sigByUserDoc.set(uid, new Map());
    // findMany above ordered by signedAt desc → first hit per
    // (user, document) wins; later (older) rows are skipped.
    const inner = sigByUserDoc.get(uid)!;
    if (!inner.has(sig.courseDocumentId)) {
      inner.set(sig.courseDocumentId, sig);
    }
  }

  // Build per-member document list. Documents come from the courses
  // applicable to this user's role (an engineer doesn't show an
  // ADMIN-only course's documents, etc.).
  const builtMembers: ComplianceMember[] = members.map((m) => {
    const applicableDocs: ComplianceMember['documents'] = [];
    for (const course of courses) {
      if (!course.applicableRoles.includes(m.user.role)) continue;
      for (const d of course.documents) {
        const sig = sigByUserDoc.get(m.user.id)?.get(d.id) ?? null;
        applicableDocs.push({
          courseSlug: course.slug,
          courseTitle: course.title,
          documentSlug: d.slug,
          documentTitle: d.title,
          documentVersion: sig?.documentVersion ?? null,
          signedAt: sig?.signedAt?.toISOString() ?? null,
          signedName: sig?.signedName ?? null,
        });
      }
    }
    const allSigned = applicableDocs.length > 0 && applicableDocs.every((d) => d.signedAt != null);
    return {
      userId: m.user.id,
      name: m.user.name,
      role: m.user.role,
      company: m.user.company,
      allSigned,
      documents: applicableDocs,
    };
  });

  // Aggregate counts for the page header strip.
  let totalAgreements = 0;
  let signedAgreements = 0;
  for (const m of builtMembers) {
    totalAgreements += m.documents.length;
    signedAgreements += m.documents.filter((d) => d.signedAt != null).length;
  }

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    members: builtMembers,
    totalAgreements,
    signedAgreements,
  };
}
