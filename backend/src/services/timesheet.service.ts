import prisma from '../config/database';
import { ForbiddenError } from '../utils/errors';
import { toDateOnlyString } from '../utils/date';
import {
  notifyTimesheetSubmitted,
  notifyTimesheetApproved,
  notifyTimesheetRejected,
} from './notification.service';
import { logger } from '../lib/logger';

interface TimeEntryInput {
  projectId: string;
  taskId?: string;
  date: string;
  hours: number;
  description?: string;
}

/**
 * Compute the Monday of the week containing `date` (UTC date-only).
 * The TimesheetWeek table keys off `weekStart` which is always a
 * Monday — mutations that target a specific date need to look up the
 * corresponding week row to gate against APPROVED status.
 *
 * JS `getDay()` returns 0=Sunday..6=Saturday. We adjust so Monday is
 * the start of the week (ISO-8601 convention; matches the existing
 * `getMonday` helper in the handler).
 */
function weekStartFor(date: Date): Date {
  const monday = new Date(date);
  const day = monday.getDay();
  const diff = monday.getDate() - day + (day === 0 ? -6 : 1);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

/**
 * Refuse the mutation when the affected week's TimesheetWeek is
 * APPROVED. Without this gate, any timesheet mutation (logTime,
 * deleteTimeEntry, bulkLogTime) could retroactively change a
 * billable-finalized week's hours — the original audit found that
 * `logTime` was an UPSERT with no week-status check, so a user
 * could rewrite hours days/weeks after their week was approved
 * with no error and no audit trail.
 *
 * DRAFT / SUBMITTED / REJECTED are all editable. APPROVED is locked:
 * to make a correction, an admin needs to reject the week first
 * (which auto-flows to REJECTED → user reopens → edits → resubmits).
 * That's the supported correction path; the alternative — admin-
 * reopen of APPROVED — is queued as a separate UX feature.
 */
async function assertWeekEditable(userId: string, date: Date): Promise<void> {
  const weekStart = weekStartFor(date);
  const week = await prisma.timesheetWeek.findUnique({
    where: { userId_weekStart: { userId, weekStart } },
    select: { status: true },
  });
  if (week?.status === 'APPROVED') {
    throw new ForbiddenError(
      'Cannot edit time on an approved week. Ask an admin to reject the week first if a correction is needed.',
    );
  }
}

export async function logTime(userId: string, input: TimeEntryInput) {
  if (!input.projectId || !input.date || input.hours == null) {
    throw new Error('projectId, date, and hours are required');
  }
  if (input.hours < 0 || input.hours > 24) {
    throw new Error('Hours must be between 0 and 24');
  }

  // Verify user is a member of the project
  const membership = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId, projectId: input.projectId } },
  });
  if (!membership) throw new Error('Not a member of this project');

  const date = new Date(input.date);
  date.setHours(0, 0, 0, 0);

  // 2026-05-15 timesheet-lifecycle audit: refuse mutations to an
  // already-APPROVED week. See `assertWeekEditable` for rationale.
  // Runs AFTER project-membership check so a non-member gets the
  // membership error rather than a misleading "approved" message.
  await assertWeekEditable(userId, date);

  // Two cases — Prisma's upsert helper needs a non-null unique key.
  //
  // 1. taskId set: the @@unique([userId, projectId, date, taskId]) row index
  //    works as before. Use Prisma upsert.
  //
  // 2. taskId null: previously the upsert substituted '' for null in the
  //    `where` clause but wrote `null` in `create`, so the WHERE never
  //    matched an existing row and every call inserted a new row (QA
  //    finding #45 — Postgres NULL ≠ NULL). Replaced with an explicit
  //    findFirst + update/create against the partial unique index defined
  //    in migration `20260505300000_cms_soft_delete_and_timeentry`.
  if (input.taskId) {
    return prisma.timeEntry.upsert({
      where: {
        userId_projectId_date_taskId: {
          userId,
          projectId: input.projectId,
          date,
          taskId: input.taskId,
        },
      },
      update: {
        hours: input.hours,
        description: input.description?.trim() || null,
      },
      create: {
        userId,
        projectId: input.projectId,
        taskId: input.taskId,
        date,
        hours: input.hours,
        description: input.description?.trim() || null,
      },
      include: {
        project: { select: { id: true, name: true } },
        task: { select: { id: true, title: true } },
      },
    });
  }

  // taskId is null — manual upsert against the partial-unique index.
  const existing = await prisma.timeEntry.findFirst({
    where: { userId, projectId: input.projectId, date, taskId: null },
    select: { id: true },
  });
  if (existing) {
    return prisma.timeEntry.update({
      where: { id: existing.id },
      data: {
        hours: input.hours,
        description: input.description?.trim() || null,
      },
      include: {
        project: { select: { id: true, name: true } },
        task: { select: { id: true, title: true } },
      },
    });
  }
  return prisma.timeEntry.create({
    data: {
      userId,
      projectId: input.projectId,
      taskId: null,
      date,
      hours: input.hours,
      description: input.description?.trim() || null,
    },
    include: {
      project: { select: { id: true, name: true } },
      task: { select: { id: true, title: true } },
    },
  });
}

export async function bulkLogTime(userId: string, entries: TimeEntryInput[]) {
  // Was N+1: 50 sequential round-trips (QA finding #26). Now Promise.all,
  // so the total wall time becomes ~one logTime call rather than the sum
  // (each upsert + project-membership lookup runs concurrently).
  return Promise.all(entries.map((entry) => logTime(userId, entry)));
}

export async function getMyWeeklyTimesheet(userId: string, weekStart: string) {
  const start = new Date(weekStart);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  const entries = await prisma.timeEntry.findMany({
    where: { userId, date: { gte: start, lt: end } },
    include: {
      project: { select: { id: true, name: true } },
      task: { select: { id: true, title: true } },
    },
    orderBy: [{ date: 'asc' }, { projectId: 'asc' }],
  });

  // Also get user's projects for empty row rendering
  const memberships = await prisma.projectMember.findMany({
    where: { userId },
    include: { project: { select: { id: true, name: true } } },
  });

  // Group by project, then by date
  const projectMap = new Map<string, { projectId: string; projectName: string; days: Record<string, number>; totalHours: number }>();

  // Init with all projects user is a member of
  memberships.forEach((m) => {
    projectMap.set(m.projectId, {
      projectId: m.project.id,
      projectName: m.project.name,
      days: {},
      totalHours: 0,
    });
  });

  entries.forEach((e) => {
    const dateKey = toDateOnlyString(e.date);
    const proj = projectMap.get(e.projectId);
    if (proj) {
      proj.days[dateKey] = (proj.days[dateKey] || 0) + e.hours;
      proj.totalHours += e.hours;
    }
  });

  const weekTotal = entries.reduce((sum, e) => sum + e.hours, 0);

  return {
    weekStart: toDateOnlyString(start),
    projects: Array.from(projectMap.values()),
    entries,
    weekTotal,
  };
}

export async function deleteTimeEntry(entryId: string, userId: string) {
  const entry = await prisma.timeEntry.findUnique({ where: { id: entryId } });
  if (!entry) throw new Error('Time entry not found');
  if (entry.userId !== userId) throw new Error('Not authorized to delete this entry');

  // 2026-05-15 timesheet-lifecycle audit: refuse delete on an
  // already-APPROVED week. Same shape as logTime guard — without
  // this an engineer could delete entries from a billable-
  // finalized week and silently shrink their approved hours.
  await assertWeekEditable(userId, entry.date);

  return prisma.timeEntry.delete({ where: { id: entryId } });
}

// ─── Timesheet Approval Workflow ───

export async function getTimesheetStatus(userId: string, weekStart: string) {
  const date = new Date(weekStart);
  date.setHours(0, 0, 0, 0);
  const ts = await prisma.timesheetWeek.findUnique({
    where: { userId_weekStart: { userId, weekStart: date } },
    include: { approver: { select: { id: true, name: true } } },
  });
  return ts || { status: 'DRAFT', totalHours: 0 };
}

export async function submitTimesheet(userId: string, weekStart: string) {
  const date = new Date(weekStart);
  date.setHours(0, 0, 0, 0);
  const endDate = new Date(date);
  endDate.setDate(endDate.getDate() + 7);

  // Calculate total hours for the week
  const entries = await prisma.timeEntry.findMany({
    where: { userId, date: { gte: date, lt: endDate } },
  });
  const totalHours = entries.reduce((sum, e) => sum + e.hours, 0);

  if (totalHours <= 0) throw new Error('Cannot submit a timesheet with 0 hours');

  // 2026-05-15 audit: refuse re-submit of an already-APPROVED week.
  // Without this the upsert would silently flip APPROVED → SUBMITTED
  // and the approval would be lost (a "soft-revoke" the approver
  // never authorized).
  const existing = await prisma.timesheetWeek.findUnique({
    where: { userId_weekStart: { userId, weekStart: date } },
    select: { status: true },
  });
  if (existing?.status === 'APPROVED') {
    throw new ForbiddenError(
      'This week is already approved. Ask an admin to reopen it before re-submitting.',
    );
  }

  const timesheet = await prisma.timesheetWeek.upsert({
    where: { userId_weekStart: { userId, weekStart: date } },
    update: { status: 'SUBMITTED', totalHours, submittedAt: new Date(), rejectionReason: null },
    create: { userId, weekStart: date, status: 'SUBMITTED', totalHours, submittedAt: new Date() },
    include: { user: { select: { id: true, name: true } } },
  });

  // ── Notify approvers (2026-05-15 audit, Bug D) ──────────────────
  //
  // Pre-fix: submission was a silent fan-in to the approval queue.
  // Approvers had to manually visit `/timesheet/pending` to see new
  // submissions. Now we ping every active ADMIN/PM/SUPER_ADMIN
  // (the `analytics.view_team` audience). Fire-and-forget so a
  // notification failure can't roll back the submission.
  notifyTimesheetSubmitted({
    timesheetId: timesheet.id,
    submittedBy: userId,
    submittedByName: timesheet.user.name,
    weekStart: toDateOnlyString(date),
    totalHours,
  }).catch((err) => logger.warn({ err: err?.message }, '[notify] notifyTimesheetSubmitted failed:'));

  return timesheet;
}

export async function approveTimesheet(timesheetId: string, approverId: string) {
  const ts = await prisma.timesheetWeek.findUnique({ where: { id: timesheetId } });
  if (!ts) throw new Error('Timesheet not found');
  if (ts.status !== 'SUBMITTED') throw new Error('Only submitted timesheets can be approved');
  if (ts.userId === approverId) throw new Error('Cannot approve your own timesheet');

  const updated = await prisma.timesheetWeek.update({
    where: { id: timesheetId },
    data: { status: 'APPROVED', approvedBy: approverId, approvedAt: new Date() },
    include: { user: { select: { id: true, name: true } } },
  });

  // ── Notify the submitter (2026-05-15 audit, Bug E) ──────────────
  //
  // Pre-fix: approval was silent. Engineers had to manually check
  // their timesheet status page. Now we ping them with the
  // approver's name + the week + the hours, so the notification
  // body is actionable on the lock screen / mobile preview.
  const approver = await prisma.user.findUnique({
    where: { id: approverId },
    select: { name: true },
  });
  notifyTimesheetApproved({
    submitterUserId: ts.userId,
    approverName: approver?.name ?? 'An approver',
    weekStart: toDateOnlyString(ts.weekStart),
    totalHours: ts.totalHours,
  }).catch((err) => logger.warn({ err: err?.message }, '[notify] notifyTimesheetApproved failed:'));

  return updated;
}

export async function rejectTimesheet(timesheetId: string, approverId: string, reason: string) {
  const ts = await prisma.timesheetWeek.findUnique({ where: { id: timesheetId } });
  if (!ts) throw new Error('Timesheet not found');
  if (ts.status !== 'SUBMITTED') throw new Error('Only submitted timesheets can be rejected');
  if (ts.userId === approverId) throw new Error('Cannot reject your own timesheet');

  const finalReason = reason || 'No reason provided';
  const updated = await prisma.timesheetWeek.update({
    where: { id: timesheetId },
    data: { status: 'REJECTED', approvedBy: approverId, rejectionReason: finalReason },
    include: { user: { select: { id: true, name: true } } },
  });

  // ── Notify the submitter with the rejection REASON (audit, Bug E) ─
  //
  // Pre-fix: the rejection reason was captured on TimesheetWeek but
  // NEVER surfaced to the submitter. They saw their submission
  // disappear from "pending" with no signal it had been rejected,
  // let alone why. Engineers ended up re-submitting unchanged
  // timesheets that got re-rejected — a loop with no escape.
  // Surfacing the reason in the notification body breaks the loop.
  const approver = await prisma.user.findUnique({
    where: { id: approverId },
    select: { name: true },
  });
  notifyTimesheetRejected({
    submitterUserId: ts.userId,
    approverName: approver?.name ?? 'An approver',
    weekStart: toDateOnlyString(ts.weekStart),
    reason: finalReason,
  }).catch((err) => logger.warn({ err: err?.message }, '[notify] notifyTimesheetRejected failed:'));

  return updated;
}

/**
 * Approver list — pending by default, with optional status filter for the
 * history view (Pending / Approved / Rejected / All) on the admin page.
 *
 * Bug fix: previously hard-coded `where: { status: 'SUBMITTED' }`, so the
 * moment a timesheet was approved or rejected it disappeared from the UI
 * with no way to see what was actioned. The page rendered "All timesheets
 * reviewed" — technically true but useless as an audit trail. Tabs in the
 * UI now drive this filter and admins can scroll back through history.
 *
 * Sort order:
 *   - Pending — oldest submission first (FIFO queue, most-stale gets
 *     attention).
 *   - Approved/Rejected/All — most-recently decided first, falling back
 *     to submittedAt for ones still pending in the All view.
 *
 * Includes the approver relation so the row can show "Approved by Pankaj
 * on May 6". Without this, a history view is just a list with no audit
 * info, which defeats the purpose.
 */
export type ApprovalStatusFilter = 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'ALL';

export async function listApprovals(filter: { status?: ApprovalStatusFilter } = {}) {
  const status = filter.status ?? 'SUBMITTED';
  // Cast to a mutable array — Prisma's generated `EnumTimesheetStatusFilter`
  // rejects `readonly` tuples (it expects to be free to mutate the input).
  const where =
    status === 'ALL'
      ? { status: { in: ['SUBMITTED', 'APPROVED', 'REJECTED'] as ('SUBMITTED' | 'APPROVED' | 'REJECTED')[] } }
      : { status };

  // Pending tab keeps its FIFO ordering so the oldest submission floats
  // to the top — that's what the queue model wants. History tabs sort by
  // most-recent decision so admins see what they just did.
  const orderBy =
    status === 'SUBMITTED'
      ? [{ submittedAt: 'asc' as const }]
      : status === 'APPROVED' || status === 'REJECTED'
        ? [{ approvedAt: 'desc' as const }, { submittedAt: 'desc' as const }]
        : // ALL — newest activity first across statuses
          [{ updatedAt: 'desc' as const }];

  return prisma.timesheetWeek.findMany({
    where,
    include: {
      user: { select: { id: true, name: true, role: true } },
      approver: { select: { id: true, name: true } },
    },
    orderBy,
  });
}

// Backward-compat shim. Some callers may still reference the old name; the
// frontend has been migrated, but leave this until the next pass.
export async function getPendingApprovals() {
  return listApprovals({ status: 'SUBMITTED' });
}

/**
 * Counts per status for the approvals tabs. Mirrors the leave-side
 * `getLeaveCounts` so the UI can render "Pending (3)" while sitting on
 * the Approved tab. One grouped query — cheap.
 */
export async function getApprovalCounts(): Promise<Record<'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'ALL', number>> {
  const groups = await prisma.timesheetWeek.groupBy({
    by: ['status'],
    where: { status: { in: ['SUBMITTED', 'APPROVED', 'REJECTED'] } },
    _count: { _all: true },
  });
  const out = { SUBMITTED: 0, APPROVED: 0, REJECTED: 0, ALL: 0 };
  for (const g of groups) {
    if (g.status === 'SUBMITTED' || g.status === 'APPROVED' || g.status === 'REJECTED') {
      out[g.status] = g._count._all;
      out.ALL += g._count._all;
    }
  }
  return out;
}

export async function reopenTimesheet(userId: string, weekStart: string) {
  const date = new Date(weekStart);
  date.setHours(0, 0, 0, 0);
  const ts = await prisma.timesheetWeek.findUnique({ where: { userId_weekStart: { userId, weekStart: date } } });
  if (!ts) throw new Error('Timesheet not found');
  if (ts.status !== 'REJECTED') throw new Error('Only rejected timesheets can be reopened');

  return prisma.timesheetWeek.update({
    where: { id: ts.id },
    data: { status: 'DRAFT', rejectionReason: null },
  });
}
