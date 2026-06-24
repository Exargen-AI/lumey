import { UserRole, TaskStatus } from '@prisma/client';
import prisma from '../config/database';
import { LIST_QUERY_CAP } from '../constants/listLimits';
import { generateSlug, ensureUniqueSlug } from '../utils/slug';
import { NotFoundError, ConflictError, ValidationError } from '../utils/errors';
import { logActivity } from './activity.service';
import { checkPermission } from './rbac.service';
import {
  notifyAddedToProject,
  notifyRemovedFromProject,
  notifyProjectRoleChanged,
  notifyProjectPMsOfOrphanedTasks,
  notifyProjectDeleted,
} from './notification.service';
import { logger } from '../lib/logger';

interface ListProjectsParams {
  userId: string;
  role: UserRole;
  category?: string;
  phase?: string;
  health?: string;
  search?: string;
}

export async function listProjects(params: ListProjectsParams) {
  const { userId, role, category, phase, health, search } = params;

  const where: any = {};
  const canViewAllProjects = await checkPermission(role, 'project.view_all');

  // Role-based filtering
  if (!canViewAllProjects) {
    where.members = { some: { userId } };
  }

  if (category) where.category = category;
  if (phase) where.phase = phase;
  if (health) where.healthStatus = health;
  if (search) where.name = { contains: search, mode: 'insensitive' };

  const projects = await prisma.project.findMany({
    where,
    include: {
      members: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
      _count: { select: { tasks: true } },
    },
    orderBy: { name: 'asc' },
    // Defensive ceiling (2026-06-01 hardening) — see constants/listLimits.
    take: LIST_QUERY_CAP,
  });

  // Aggregate task counts across ALL projects in 2 queries instead of
  // (2 × N projects). Was N+1: ~10 projects = ~20 round-trips. Now: 2.
  const projectIds = projects.map((p) => p.id);
  const [statusGroups, blockedGroups] = await Promise.all([
    prisma.task.groupBy({
      by: ['projectId', 'status'],
      where: { projectId: { in: projectIds } },
      _count: true,
    }),
    prisma.task.groupBy({
      by: ['projectId'],
      where: { projectId: { in: projectIds }, isBlocked: true },
      _count: true,
    }),
  ]);

  // Index for O(1) lookup as we walk projects.
  const countsByProject = new Map<string, { total: number; inProgress: number; done: number; blocked: number }>();
  for (const id of projectIds) {
    countsByProject.set(id, { total: 0, inProgress: 0, done: 0, blocked: 0 });
  }
  for (const g of statusGroups) {
    const c = countsByProject.get(g.projectId)!;
    c.total += g._count;
    if (g.status === TaskStatus.IN_PROGRESS) c.inProgress = g._count;
    if (g.status === TaskStatus.DONE) c.done = g._count;
  }
  for (const g of blockedGroups) {
    countsByProject.get(g.projectId)!.blocked = g._count;
  }

  return projects.map((project) => ({
    ...project,
    taskCounts: countsByProject.get(project.id)!,
  }));
}

export async function getProject(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      members: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
      _count: { select: { tasks: true } },
    },
  });

  if (!project) throw new NotFoundError('Project');
  return project;
}

export async function createProject(data: any, creatorId: string) {
  // Reject obvious duplicates by name (case-insensitive). Slug uniqueness
  // already protects URL collisions, but two projects called "BountiPOS"
  // make UI selection ambiguous and confuse activity feeds (QA finding —
  // duplicate name accepted). The check is best-effort: a concurrent create
  // could still race past, but slug uniqueness will reject it at the DB.
  //
  // 2026-05-21 follow-up bug fix: pre-fix the dup check used the trimmed
  // name BUT the create persisted `data.name` verbatim. So a user posting
  // "  Foo  " (with spaces) would clear the dup-check vs "Foo" and store
  // the spaced version — and a subsequent "Foo" create would NOT see the
  // stored "  Foo  " (Postgres `mode: 'insensitive'` is case-insensitive
  // but NOT whitespace-insensitive), allowing two "same-named" projects
  // to coexist. We now trim at the create site too so the stored value
  // matches the dup-check shape exactly.
  const trimmedName = String(data.name || '').trim();
  const dupe = await prisma.project.findFirst({
    where: { name: { equals: trimmedName, mode: 'insensitive' } },
    select: { id: true },
  });
  if (dupe) {
    throw new ConflictError(`A project named "${trimmedName}" already exists`);
  }

  const baseSlug = data.slug || generateSlug(data.name);
  const slug = await ensureUniqueSlug(baseSlug, async (s) => {
    const exists = await prisma.project.findUnique({ where: { slug: s } });
    return !!exists;
  });

  const { memberIds, ...projectData } = data;
  // Persist the trimmed, canonical name — see comment above.
  projectData.name = trimmedName;
  const creator = await prisma.user.findUnique({
    where: { id: creatorId },
    select: { role: true },
  });

  const membershipMap = new Map<string, UserRole>();
  if (creator) {
    membershipMap.set(creatorId, creator.role);
  }
  if (Array.isArray(memberIds)) {
    for (const member of memberIds) {
      membershipMap.set(member.userId, member.role);
    }
  }

  const project = await prisma.project.create({
    data: {
      ...projectData,
      slug,
      startDate: data.startDate ? new Date(data.startDate) : null,
      targetDate: data.targetDate ? new Date(data.targetDate) : null,
    },
  });

  // Create member associations
  if (membershipMap.size > 0) {
    await prisma.projectMember.createMany({
      data: Array.from(membershipMap.entries()).map(([userId, role]) => ({
        projectId: project.id,
        userId,
        role,
      })),
      skipDuplicates: true,
    });
  }

  await logActivity({
    userId: creatorId,
    projectId: project.id,
    action: 'created_project',
    targetType: 'project',
    targetId: project.id,
    details: { name: project.name },
  });

  return getProject(project.id);
}

export async function updateProject(
  projectId: string,
  data: any,
  userId: string,
  // 2026-05-21 optimistic-locking expansion (matches Task pattern from
  // PR #128). OPT-IN ISO timestamp; service refuses the write if the
  // server's updatedAt no longer matches.
  expectedUpdatedAt?: string,
) {
  const existing = await prisma.project.findUnique({ where: { id: projectId } });
  if (!existing) throw new NotFoundError('Project');

  // Early conflict detection. Even with the transaction below the
  // early-exit is worth keeping — it fails fast before we run the
  // member-rewrite logic only to roll back.
  if (expectedUpdatedAt && existing.updatedAt.toISOString() !== expectedUpdatedAt) {
    throw new ConflictError(
      `This project was edited by someone else. Refresh and reapply your changes. (server updatedAt: ${existing.updatedAt.toISOString()})`,
    );
  }

  const { memberIds, ...projectFields } = data;
  // Strip expectedUpdatedAt — it's a service-only param, never a
  // column on Project. Without this, Prisma would error on the
  // unknown field at runtime.
  delete projectFields.expectedUpdatedAt;
  const updateData: any = { ...projectFields };
  if (data.startDate !== undefined) updateData.startDate = data.startDate ? new Date(data.startDate) : null;
  if (data.targetDate !== undefined) updateData.targetDate = data.targetDate ? new Date(data.targetDate) : null;

  // Wrap project update + member rewrite + activity logs in a single transaction.
  // Previously each step was a separate write — a failure mid-sequence would
  // leave the project in a half-updated state (e.g., new project name but stale
  // members, or phase change without an audit row).
  const project = await prisma.$transaction(async (tx) => {
    // Race-safe write — when expectedUpdatedAt is set, use
    // updateMany so a concurrent edit within the transaction's
    // visibility window is detected (count===0 → 409). The plain
    // update path stays for back-compat callers.
    if (expectedUpdatedAt) {
      const result = await tx.project.updateMany({
        where: { id: projectId, updatedAt: existing.updatedAt },
        data: updateData,
      });
      if (result.count === 0) {
        const current = await tx.project.findUnique({
          where: { id: projectId },
          select: { updatedAt: true },
        });
        throw new ConflictError(
          `This project was edited by someone else. Refresh and reapply your changes. (server updatedAt: ${current?.updatedAt.toISOString() ?? 'unknown'})`,
        );
      }
    } else {
      await tx.project.update({
        where: { id: projectId },
        data: updateData,
      });
    }
    const updated = await tx.project.findUniqueOrThrow({ where: { id: projectId } });

    if (Array.isArray(memberIds)) {
      await tx.projectMember.deleteMany({ where: { projectId } });
      if (memberIds.length > 0) {
        await tx.projectMember.createMany({
          data: memberIds.map((member: any) => ({
            projectId,
            userId: member.userId,
            role: member.role,
          })),
          skipDuplicates: true,
        });
      }
    }

    if (data.phase && data.phase !== existing.phase) {
      await logActivity({
        userId,
        projectId,
        action: 'changed_phase',
        targetType: 'project',
        targetId: projectId,
        details: { from: existing.phase, to: data.phase },
      }, tx);
    }

    if (data.healthStatus && data.healthStatus !== existing.healthStatus) {
      await logActivity({
        userId,
        projectId,
        action: 'set_health',
        targetType: 'project',
        targetId: projectId,
        details: { from: existing.healthStatus, to: data.healthStatus },
      }, tx);
    }

    return updated;
  });

  return getProject(project.id);
}

export async function deleteProject(projectId: string, userId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundError('Project');

  // ── 2026-05-15 project-deletion audit (Bug A — billing safety gate) ──
  //
  // The schema has `onDelete: Cascade` on every Project relation
  // including `TimeEntry.projectId`. That means a hard delete here
  // ATOMICALLY destroys every billable hour ever logged on this
  // project — including hours that have been approved + invoiced.
  // The audit row at the org level survives (it has no projectId
  // FK), but the per-week TimesheetWeek snapshots become
  // disconnected from reality, and the per-entry detail is gone.
  //
  // For a real billing system this is unrecoverable data loss.
  //
  // The minimal-disruption fix: refuse delete when any TimeEntry
  // exists. If an admin genuinely wants to wipe a project, they
  // can manually purge time entries first (which itself goes
  // through approval-gates per the timesheet audit). This is a
  // paper-cut for the rare "delete a never-used test project"
  // case (zero entries → delete proceeds), but it's the right
  // default — destructive ops should not silently destroy billing
  // history.
  //
  // The longer-term fix is a soft-delete/archive flag on Project
  // so admins can hide projects without destroying data. That's
  // a schema change + migration + read-path updates throughout
  // the codebase, queued as a follow-up product decision.
  const timeEntryCount = await prisma.timeEntry.count({ where: { projectId } });
  if (timeEntryCount > 0) {
    throw new ConflictError(
      `Cannot delete this project — it has ${timeEntryCount} time ${
        timeEntryCount === 1 ? 'entry' : 'entries'
      } logged against it. Time-entry deletion is the wrong tool for closing out a project; archiving (when supported) is the right path.`,
    );
  }

  // ── Capture member IDs BEFORE the delete so we can notify them ──
  // after the tx commits. The cascade will destroy ProjectMember
  // rows along with everything else, so we need to read this first.
  const memberRows = await prisma.projectMember.findMany({
    where: { projectId },
    select: { userId: true },
  });
  const memberIds = memberRows.map((m) => m.userId);

  // Atomic delete + audit so we never lose the audit trail on partial failure.
  // The activity row deliberately has NO projectId set — it would otherwise
  // get cascade-deleted along with the project itself. Stored as an
  // org-level event (projectId=null) so it survives.
  await prisma.$transaction(async (tx) => {
    await tx.project.delete({ where: { id: projectId } });
    await logActivity({
      userId,
      action: 'deleted_project',
      targetType: 'project',
      targetId: projectId,
      details: { name: project.name, memberCount: memberIds.length },
    }, tx);
  });

  // ── Notify members AFTER the tx commits (Bug C) ──────────────────
  //
  // Pre-fix: project deletion was silent for project members. They
  // discovered via 404 on their next visit. Now they get a clear
  // signal with who deleted, what was deleted, and a link back to
  // their dashboard (deep-linking to the deleted project would 404).
  // Fire-and-forget — a notification failure can't undo the delete.
  if (memberIds.length > 0) {
    const deleter = await prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    notifyProjectDeleted({
      projectName: project.name,
      deletedBy: userId,
      deletedByName: deleter?.name ?? 'An admin',
      memberIds,
    }).catch((err) => logger.warn({ err: err?.message }, '[notify] notifyProjectDeleted failed:'));
  }
}

export async function getProjectMembers(projectId: string, opts: { hideAgents?: boolean } = {}) {
  return prisma.projectMember.findMany({
    where: {
      projectId,
      user: {
        isActive: true,
        // 2026-05-22 Pankaj policy: when the requester is a CLIENT
        // (the route layer wraps this with hideAgents=true), AGENT
        // users never reach the response. Defense in depth on top of
        // the route-level `task.view_internal` guard.
        ...(opts.hideAgents ? { userType: { not: 'AGENT' } } : {}),
      },
    },
    include: {
      // userType now selected so the FE can mask agent identities for
      // CLIENT viewers when this endpoint is exposed to them in the
      // future. Additive field; no consumer breaks.
      user: { select: { id: true, name: true, email: true, role: true, userType: true } },
    },
  });
}

/**
 * Grant or revoke per-project full access for a CLIENT member (2026-06-02).
 *
 * When `fullAccess` is true on a CLIENT membership, that client sees the
 * full internal view of THIS project (every task, decisions, internal
 * comments) — see `rbac.service.canViewProjectInternal`. SUPER_ADMIN-only:
 * the route gates with `requireRoles('SUPER_ADMIN')`. Restricted to CLIENT
 * members — staff already see internal work via their role, so toggling it
 * on them would be meaningless and confusing.
 */
export async function setMemberFullAccess(
  projectId: string,
  userId: string,
  fullAccess: boolean,
  actingUserId: string,
) {
  const membership = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId, projectId } },
    include: { user: { select: { id: true, role: true } } },
  });
  if (!membership) throw new NotFoundError('Project member');
  if (membership.user.role !== UserRole.CLIENT) {
    throw new ValidationError('Full project access can only be granted to CLIENT members');
  }

  const updated = await prisma.projectMember.update({
    where: { userId_projectId: { userId, projectId } },
    data: { fullAccess },
    include: {
      user: { select: { id: true, name: true, email: true, role: true, userType: true } },
    },
  });

  await logActivity({
    userId: actingUserId,
    action: fullAccess
      ? 'project_member_full_access_granted'
      : 'project_member_full_access_revoked',
    targetType: 'project_member',
    targetId: membership.id,
    details: { projectId, memberUserId: userId, fullAccess },
  });

  return updated;
}

export async function addProjectMember(projectId: string, userId: string, role: UserRole, actingUserId: string) {
  // Run the upsert + activity log inside a transaction; do the
  // notification AFTER the tx commits (notification helpers don't
  // accept tx clients and we don't want a notification failure to
  // roll back the membership change).
  const { action, before, member } = await prisma.$transaction(async (tx) => {
    // Capture pre-state so we can record old→new on a role *change* vs.
    // pure add. The QA audit flagged that role updates were silently
    // logged as "added_member" with no diff (finding #28).
    const before = await tx.projectMember.findUnique({
      where: { userId_projectId: { userId, projectId } },
      select: { role: true },
    });

    const member = await tx.projectMember.upsert({
      where: { userId_projectId: { userId, projectId } },
      create: { projectId, userId, role },
      update: { role },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });

    const action = before ? (before.role === role ? 'noop_member' : 'changed_member_role') : 'added_member';
    if (action !== 'noop_member') {
      await logActivity({
        userId: actingUserId,
        projectId,
        action,
        targetType: 'user',
        targetId: userId,
        details: action === 'changed_member_role'
          ? { from: before!.role, to: role }
          : { role },
      }, tx);
    }

    return { action, before, member };
  });

  // ── Notify the affected user (added by 2026-05-15 audit) ────────
  //
  // Pre-fix: a user added to a project (or role-changed within one)
  // discovered the change by refreshing their dashboard. Silent
  // surface change. Now: ping the user so they understand WHY new
  // tasks/projects appeared, or why their permissions in a project
  // suddenly shifted.
  //
  // Skip the self-ping case (an admin adding themselves to a
  // project they're managing — they obviously know).
  if (action !== 'noop_member' && userId !== actingUserId) {
    const [project, actor] = await Promise.all([
      prisma.project.findUnique({ where: { id: projectId }, select: { name: true } }),
      prisma.user.findUnique({ where: { id: actingUserId }, select: { name: true } }),
    ]);
    const projectName = project?.name ?? 'a project';
    const actorName = actor?.name ?? 'A teammate';

    if (action === 'added_member') {
      notifyAddedToProject({
        userId,
        projectId,
        projectName,
        addedByName: actorName,
        memberRole: String(role),
      }).catch((err) => logger.warn({ err: err?.message }, '[notify] notifyAddedToProject failed:'));
    } else if (action === 'changed_member_role') {
      notifyProjectRoleChanged({
        userId,
        projectId,
        projectName,
        changedByName: actorName,
        fromRole: String(before!.role),
        toRole: String(role),
      }).catch((err) => logger.warn({ err: err?.message }, '[notify] notifyProjectRoleChanged failed:'));
    }
  }

  return member;
}

export async function removeProjectMember(projectId: string, userId: string, actingUserId: string) {
  // Capture for the post-tx PM notification. We can't run the
  // notify INSIDE the tx because findMany on projectMember would
  // race with the projectMember.delete that happens at the end of
  // the tx (depending on isolation level, the PM list could
  // include the leaving user if they were themselves a PM).
  let unassignedCount = 0;
  let unreviewerCount = 0;
  let leavingUserName: string | null = null;
  await prisma.$transaction(async (tx) => {
    // Find every task in this project still assigned to the leaving user
    // BEFORE we drop them from the membership row. We need the ids for the
    // audit row so the trail records exactly what was orphaned. (Round 2
    // finding R1: previously a removed member's tasks stayed
    // assigneeId=<them> indefinitely. Backend correctly refused new
    // assignments to non-members but never cleaned up the old ones, so
    // dashboards / "my tasks" filters kept surfacing them, and reassign
    // batch-reports treated those tasks as still-owned.)
    const orphanedTasks = await tx.task.findMany({
      where: { projectId, assigneeId: userId },
      select: { id: true },
    });

    if (orphanedTasks.length > 0) {
      await tx.task.updateMany({
        where: { projectId, assigneeId: userId },
        data: { assigneeId: null },
      });
    }

    // 2026-05-15 audit: ALSO clear `reviewerId` on tasks where the
    // departing user was the reviewer. Pre-fix this was missed —
    // tasks in `IN_REVIEW` status with reviewer = <departing user>
    // would stay stuck forever (the original assignee couldn't
    // re-request from a different reviewer without admin help,
    // because the reviewer slot was held by someone who couldn't
    // even open the project anymore). Symmetric to the assigneeId
    // orphan fix R1 — the same shape just on the other side of the
    // review handshake.
    const orphanedReviewerTasks = await tx.task.findMany({
      where: { projectId, reviewerId: userId },
      select: { id: true },
    });

    if (orphanedReviewerTasks.length > 0) {
      await tx.task.updateMany({
        where: { projectId, reviewerId: userId },
        data: { reviewerId: null },
      });
    }

    // 2026-05-23 audit bug-fix: ALSO delete any TaskSubscription rows
    // this user holds for tasks in this project. Pre-fix, the
    // subscription rows were orphaned — the user would keep getting
    // comment / edit notifications about tasks in a project they no
    // longer have access to (privacy issue + notification spam).
    // Symmetric to the assigneeId / reviewerId orphan cleanups above.
    const orphanedSubscriptions = await tx.taskSubscription.deleteMany({
      where: {
        userId,
        task: { projectId },
      },
    });

    await tx.projectMember.delete({
      where: { userId_projectId: { userId, projectId } },
    });

    await logActivity({
      userId: actingUserId,
      projectId,
      action: 'removed_member',
      targetType: 'user',
      targetId: userId,
      details: (orphanedTasks.length > 0 || orphanedReviewerTasks.length > 0 || orphanedSubscriptions.count > 0)
        ? {
            ...(orphanedTasks.length > 0
              ? { unassignedTaskCount: orphanedTasks.length, unassignedTaskIds: orphanedTasks.map((t) => t.id) }
              : {}),
            ...(orphanedReviewerTasks.length > 0
              ? { unreviewerTaskCount: orphanedReviewerTasks.length, unreviewerTaskIds: orphanedReviewerTasks.map((t) => t.id) }
              : {}),
            ...(orphanedSubscriptions.count > 0
              ? { droppedSubscriptionCount: orphanedSubscriptions.count }
              : {}),
          }
        : undefined,
    }, tx);

    // Capture for the post-tx PM notify. Looking up the leaving
    // user's name inside the tx keeps us consistent with what was
    // recorded in the audit log even if the user record is later
    // soft-deleted.
    unassignedCount = orphanedTasks.length;
    unreviewerCount = orphanedReviewerTasks.length;
    const leavingUser = await tx.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    leavingUserName = leavingUser?.name ?? null;
  });

  // ── Notify the removed user (added by 2026-05-15 audit) ─────────
  //
  // Pre-fix the removed user discovered the change via a 403 the
  // next time they tried to open the project — hostile UX. Now
  // they get a notification with WHO removed them and WHEN, so
  // they can ask in Slack if it was a mistake.
  //
  // Skip if the user removed themselves (e.g. leaving voluntarily
  // — they obviously know).
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
  const projectName = project?.name ?? 'a project';

  if (userId !== actingUserId) {
    const actor = await prisma.user.findUnique({ where: { id: actingUserId }, select: { name: true } });
    notifyRemovedFromProject({
      userId,
      projectId,
      projectName,
      removedByName: actor?.name ?? 'An admin',
    }).catch((err) => logger.warn({ err: err?.message }, '[notify] notifyRemovedFromProject failed:'));
  }

  // ── Notify project PMs about orphaned tasks (this PR follow-up) ─
  //
  // The activity log already records `unassignedTaskCount` and
  // `unreviewerTaskCount`, but the project's PMs don't read the
  // log proactively. Without an explicit ping, orphaned tasks
  // accumulate silently until someone notices via dashboard or
  // the next planning meeting.
  //
  // Helper internally:
  //   • skips when both counts are zero
  //   • dedupes if a single PM holds both roles (Set under the hood)
  //   • does NOT fan out to global SUPER_ADMINs — the project's
  //     own PM/ADMIN members are the right audience
  if (unassignedCount > 0 || unreviewerCount > 0) {
    notifyProjectPMsOfOrphanedTasks({
      projectId,
      projectName,
      leavingUserName: leavingUserName ?? 'A teammate',
      unassignedCount,
      unreviewerCount,
    }).catch((err) =>
      logger.warn({ err: err?.message }, '[notify] notifyProjectPMsOfOrphanedTasks failed:'),
    );
  }
}
