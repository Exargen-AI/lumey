import { Prisma } from '@prisma/client';
import prisma from '../config/database';
import { logActivity } from './activity.service';
import { ForbiddenError, NotFoundError } from '../utils/errors';
import { checkPermission } from './rbac.service';

// The boilerplate text every user must agree to before accessing a project.
// We snapshot this string into each ProjectAcknowledgment row, so future
// edits to this text don't retroactively change what users agreed to —
// preserves the legal audit chain.
export const CONFIDENTIALITY_TEXT = [
  'You are about to access confidential and proprietary information belonging to Exargen and its clients.',
  '',
  'By proceeding, you acknowledge and agree:',
  '',
  '1. All information you access on this project — including but not limited to source code, designs, business strategies, financial data, client information, technical specifications, internal communications, and any deliverables — is CONFIDENTIAL.',
  '',
  '2. You will NOT disclose, copy, reproduce, share, transmit, store, or use any project information for any purpose other than your authorized work on this project.',
  '',
  '3. You will NOT remove project information to personal devices, personal cloud storage, or any system not explicitly authorized by Exargen.',
  '',
  '4. Your obligations of confidentiality survive your employment, engagement, or working relationship with Exargen, and continue indefinitely.',
  '',
  '5. Violation of these obligations may result in disciplinary action, termination, civil liability, and/or criminal prosecution under applicable trade-secret and intellectual-property law.',
  '',
  'Your acceptance is recorded with a timestamp, IP address, and user-agent for legal audit purposes.',
].join('\n');

export async function getMyAcknowledgment(userId: string, projectId: string) {
  return prisma.projectAcknowledgment.findUnique({
    where: { userId_projectId: { userId, projectId } },
    select: { id: true, acknowledgedAt: true },
  });
}

interface AckContext {
  ipAddress: string | null;
  userAgent: string | null;
}

export async function acknowledgeProject(
  userId: string,
  projectId: string,
  ctx: AckContext,
) {
  // Defense-in-depth: re-verify access server-side. Route layer already
  // applies projectAccess, but a future caller could land here through a
  // different path (QA findings #48, #56).
  //
  // Bug fix: previously this only checked `projectMember`, so SUPER_ADMINs
  // (and anyone else with `project.view_all`) — who are intentionally NOT
  // added as explicit members of every project — got 403 here even though
  // the route middleware had let them through. The fix mirrors the
  // `projectAccess` middleware: anyone with `project.view_all` skips the
  // membership requirement.
  const [project, user, membership] = await Promise.all([
    prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    }),
    prisma.projectMember.findUnique({
      where: { userId_projectId: { userId, projectId } },
      select: { id: true },
    }),
  ]);
  if (!project) throw new NotFoundError('Project');
  if (!user) throw new ForbiddenError('User no longer exists');

  const canViewAllProjects = await checkPermission(user.role, 'project.view_all');
  if (!canViewAllProjects && !membership) {
    throw new ForbiddenError('Not a member of this project');
  }

  // Race-safe upsert. Previously this was a "find then create" pair: two
  // concurrent POSTs both passed the existence check, the second hit P2002
  // and surfaced as a 500 with a Prisma-shaped error message (QA finding
  // #12). createMany + skipDuplicates makes the create idempotent at the
  // DB level; the returned count tells us whether THIS call did the work
  // (so the audit log fires exactly once, not once per concurrent caller).
  const created = await prisma.projectAcknowledgment.createMany({
    data: [{
      userId,
      projectId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      acknowledgedText: CONFIDENTIALITY_TEXT,
    }],
    skipDuplicates: true,
  });

  const ack = await prisma.projectAcknowledgment.findUniqueOrThrow({
    where: { userId_projectId: { userId, projectId } },
  });

  // Only the call that actually created the row writes the audit entry.
  // Concurrent retries see count=0 and stay quiet.
  if (created.count > 0) {
    await logActivity({
      userId,
      projectId,
      action: 'acknowledged_confidentiality',
      targetType: 'project',
      targetId: projectId,
      details: { projectName: project.name },
    });
  }

  return ack;
}

// Admin-only — returns every user × project ack so we can prove who agreed
// to what + when, with full forensic context.
export async function listAcknowledgmentsForProject(projectId: string) {
  return prisma.projectAcknowledgment.findMany({
    where: { projectId },
    include: {
      user: { select: { id: true, name: true, email: true, role: true } },
    },
    orderBy: { acknowledgedAt: 'desc' },
  });
}
