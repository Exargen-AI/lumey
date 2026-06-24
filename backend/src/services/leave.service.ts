import { LeaveStatus, LeaveType, UserRole } from '@prisma/client';
import prisma from '../config/database';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { logActivity } from './activity.service';
import { createBulkNotifications, createNotification } from './notification.service';
import { logger } from '../lib/logger';

/**
 * Leave tracker — v1 service layer.
 *
 * Approval policy: only an active SUPER_ADMIN can approve, reject, or
 * (re-)decide a leave request. This matches the founder's instruction
 * that Pankaj is the sole approver. The check happens here in the
 * service, not just on the route, so even a route-misconfig wouldn't
 * let an ADMIN sneak through.
 *
 * Quota / accrual / carry-over are not modeled in v1 — company policies
 * are still being authored. When they're settled, a `LeaveBalance`
 * model can deduct inside the same transaction as `applyLeave`.
 */

// Reason is optional — empty / whitespace gets coerced to null in apply.
const MAX_REASON_LEN = 2_000;
const MAX_LEAVE_DAYS = 365;   // sanity cap; a single request shouldn't exceed a year

interface ApplyLeaveInput {
  startDate: string;          // ISO date or YYYY-MM-DD
  endDate: string;
  leaveType: LeaveType;
  reason?: string | null;
}

interface DecideInput {
  decisionNote?: string | null;
}

/** Inclusive day count between two midnight-UTC dates. */
function calcTotalDays(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  if (ms < 0) throw new ValidationError('endDate must not be before startDate');
  return Math.round(ms / 86_400_000) + 1;
}

/** Parse a date input and stamp it at midnight UTC of that calendar day. */
function parseDateAtMidnight(input: string, field: string): Date {
  // Accept either "YYYY-MM-DD" or full ISO. We strip time so two requests
  // for the same day always compare equal.
  const m = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) throw new ValidationError(`${field} must be a YYYY-MM-DD date`);
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new ValidationError(`${field} is not a valid date`);
  return d;
}

/** Throws if the actor isn't an active SUPER_ADMIN. */
async function assertSuperAdmin(actorId: string, action: string): Promise<void> {
  const actor = await prisma.user.findUnique({
    where: { id: actorId },
    select: { role: true, isActive: true },
  });
  if (!actor || !actor.isActive || actor.role !== UserRole.SUPER_ADMIN) {
    throw new ForbiddenError(`Only a Super Admin can ${action} leave requests`);
  }
}

// ─── Apply ─────────────────────────────────────────────────────────────────

export async function applyLeave(applicantId: string, input: ApplyLeaveInput) {
  const start = parseDateAtMidnight(input.startDate, 'startDate');
  const end = parseDateAtMidnight(input.endDate, 'endDate');
  const totalDays = calcTotalDays(start, end);
  if (totalDays > MAX_LEAVE_DAYS) {
    throw new ValidationError(`Leave cannot exceed ${MAX_LEAVE_DAYS} days. Split into multiple requests.`);
  }

  const reason = (input.reason ?? '').trim();
  if (reason.length > MAX_REASON_LEN) {
    throw new ValidationError(`Reason must be at most ${MAX_REASON_LEN} characters`);
  }

  // Refuse overlapping non-cancelled non-rejected requests by the same
  // applicant. The team's complaint shouldn't be "I applied for leave
  // twice on the same day by accident and now you have two records."
  // Cancelled / rejected don't block — those are dead.
  const overlap = await prisma.leaveRequest.findFirst({
    where: {
      applicantId,
      status: { in: [LeaveStatus.PENDING, LeaveStatus.APPROVED] },
      startDate: { lte: end },
      endDate: { gte: start },
    },
    select: { id: true, status: true, startDate: true, endDate: true },
  });
  if (overlap) {
    throw new ValidationError(
      `You already have a ${overlap.status.toLowerCase()} leave request that overlaps these dates. Cancel that one first if you want to re-apply.`,
    );
  }

  const leave = await prisma.leaveRequest.create({
    data: {
      applicantId,
      startDate: start,
      endDate: end,
      totalDays,
      leaveType: input.leaveType,
      reason: reason || null,
      status: LeaveStatus.PENDING,
    },
    include: {
      applicant: { select: { id: true, name: true, email: true } },
    },
  });

  await logActivity({
    userId: applicantId,
    action: 'applied_leave',
    targetType: 'leave',
    targetId: leave.id,
    details: { startDate: input.startDate, endDate: input.endDate, totalDays, leaveType: input.leaveType },
  }).catch(() => { /* non-blocking */ });

  // Notify every active SUPER_ADMIN — Pankaj sees the queue. We bulk-fan
  // out so adding a co-approver later (delegated approval) needs no
  // service change, just another active SUPER_ADMIN row.
  notifyApprovers(leave).catch((err) => logger.warn({ err: err?.message }, '[notify] applyLeave fan-out failed:'));

  return leave;
}

async function notifyApprovers(leave: { id: string; totalDays: number; startDate: Date; endDate: Date; applicant: { id: string; name: string } }) {
  const approvers = await prisma.user.findMany({
    where: { role: UserRole.SUPER_ADMIN, isActive: true },
    select: { id: true },
  });
  if (approvers.length === 0) return;
  await createBulkNotifications(
    approvers.map((a) => ({
      userId: a.id,
      type: 'leave_request',
      title: `${leave.applicant.name} applied for leave`,
      body: `${leave.totalDays} ${leave.totalDays === 1 ? 'day' : 'days'} from ${formatDate(leave.startDate)} to ${formatDate(leave.endDate)}`,
      link: `/admin/leaves`,
    })),
  );
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── Listing ───────────────────────────────────────────────────────────────

/** Caller's own history — no permission gate beyond authentication. */
export async function getMyLeaves(applicantId: string) {
  return prisma.leaveRequest.findMany({
    where: { applicantId },
    include: {
      decidedBy: { select: { id: true, name: true } },
    },
    // Stable tiebreaker so two leaves on the same start date render in a
    // deterministic order across renders (QA L-L6).
    orderBy: [{ startDate: 'desc' }, { createdAt: 'desc' }],
  });
}

/**
 * Approver queue — every leave request, optionally filtered by status.
 * Gated to SUPER_ADMIN: nobody else needs to see who applied for what
 * (privacy — sick leave reasons can be sensitive).
 */
export async function listAllLeaves(actorId: string, filter?: { status?: LeaveStatus }) {
  await assertSuperAdmin(actorId, 'list all');
  return prisma.leaveRequest.findMany({
    where: filter?.status ? { status: filter.status } : {},
    include: {
      applicant: { select: { id: true, name: true, email: true, role: true } },
      decidedBy: { select: { id: true, name: true } },
    },
    // Pending first (work to do), then most-recently-applied.
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
  });
}

/** Single record — applicant or SUPER_ADMIN can see. */
export async function getLeave(leaveId: string, actorId: string) {
  const leave = await prisma.leaveRequest.findUnique({
    where: { id: leaveId },
    include: {
      applicant: { select: { id: true, name: true, email: true } },
      decidedBy: { select: { id: true, name: true } },
    },
  });
  if (!leave) throw new NotFoundError('Leave request');
  if (leave.applicantId !== actorId) {
    await assertSuperAdmin(actorId, 'view another user\'s');
  }
  return leave;
}

// QA L-L1: `getApprovedLeavesForRange` removed — the timesheet uses
// `useMyLeaves` and filters client-side, so this server-side helper had
// no callers. Bring it back if/when an admin "view someone else's leave
// overlay on their timesheet" feature lands.

// ─── Approve / reject ──────────────────────────────────────────────────────

export async function approveLeave(leaveId: string, actorId: string, input: DecideInput = {}) {
  await assertSuperAdmin(actorId, 'approve');
  return decideLeave(leaveId, actorId, LeaveStatus.APPROVED, input.decisionNote ?? null);
}

export async function rejectLeave(leaveId: string, actorId: string, input: DecideInput = {}) {
  await assertSuperAdmin(actorId, 'reject');
  return decideLeave(leaveId, actorId, LeaveStatus.REJECTED, input.decisionNote ?? null);
}

/**
 * Revoke an APPROVED leave (founder-initiated). Distinct from applicant
 * cancellation — preserves the original approval audit row, marks the
 * record as REJECTED with a fresh decision note, and notifies the
 * applicant. Required for the "approved leave conflicts with a new
 * deliverable, founder needs to undo" workflow (QA L-H2: previously
 * approval was final from the founder's side; only the applicant
 * could withdraw via cancel).
 *
 * Note requirement is enforced — revoking without explanation is a
 * footgun. The applicant deserves to know why.
 */
export async function revokeApprovedLeave(leaveId: string, actorId: string, note: string) {
  await assertSuperAdmin(actorId, 'revoke');
  const cleanedNote = note?.trim();
  if (!cleanedNote) {
    throw new ValidationError('A note is required when revoking an approved leave so the applicant knows why.');
  }
  return prisma.$transaction(async (tx) => {
    const leave = await tx.leaveRequest.findUnique({ where: { id: leaveId } });
    if (!leave) throw new NotFoundError('Leave request');
    if (leave.status !== LeaveStatus.APPROVED) {
      throw new ValidationError(
        `Only APPROVED leaves can be revoked. This one is ${leave.status.toLowerCase()}.`,
      );
    }
    const updated = await tx.leaveRequest.update({
      where: { id: leaveId },
      data: {
        status: LeaveStatus.REJECTED,
        decidedById: actorId,
        decidedAt: new Date(),
        decisionNote: cleanedNote,
      },
      include: {
        applicant: { select: { id: true, name: true, email: true } },
        decidedBy: { select: { id: true, name: true } },
      },
    });
    await logActivity({
      userId: actorId,
      action: 'revoked_approved_leave',
      targetType: 'leave',
      targetId: leaveId,
      details: {
        applicantId: updated.applicantId,
        applicantName: updated.applicant.name,
        startDate: formatDate(updated.startDate),
        endDate: formatDate(updated.endDate),
        totalDays: updated.totalDays,
        decisionNote: cleanedNote,
      },
    }, tx);
    createNotification({
      userId: updated.applicantId,
      type: 'leave_revoked',
      title: 'Approved leave revoked',
      body: `${formatDate(updated.startDate)} – ${formatDate(updated.endDate)} (${updated.totalDays} ${updated.totalDays === 1 ? 'day' : 'days'}) — ${cleanedNote}`,
      link: `/leaves`,
    }).catch((err) => logger.warn({ err: err?.message }, '[notify] revokeApprovedLeave failed:'));
    return updated;
  });
}

async function decideLeave(
  leaveId: string,
  actorId: string,
  toStatus: typeof LeaveStatus.APPROVED | typeof LeaveStatus.REJECTED,
  note: string | null,
) {
  return prisma.$transaction(async (tx) => {
    const leave = await tx.leaveRequest.findUnique({ where: { id: leaveId } });
    if (!leave) throw new NotFoundError('Leave request');

    if (leave.status !== LeaveStatus.PENDING) {
      throw new ValidationError(
        `Leave request is already ${leave.status.toLowerCase()}; only pending requests can be ${toStatus.toLowerCase()}.`,
      );
    }

    const updated = await tx.leaveRequest.update({
      where: { id: leaveId },
      data: {
        status: toStatus,
        decidedById: actorId,
        decidedAt: new Date(),
        decisionNote: note?.trim() || null,
      },
      include: {
        applicant: { select: { id: true, name: true, email: true } },
        decidedBy: { select: { id: true, name: true } },
      },
    });

    await logActivity({
      userId: actorId,
      action: toStatus === LeaveStatus.APPROVED ? 'approved_leave' : 'rejected_leave',
      targetType: 'leave',
      targetId: leaveId,
      details: {
        applicantId: updated.applicantId,
        applicantName: updated.applicant.name,
        startDate: formatDate(updated.startDate),
        endDate: formatDate(updated.endDate),
        totalDays: updated.totalDays,
        ...(note ? { decisionNote: note } : {}),
      },
    }, tx);

    // Notify the applicant — non-blocking outside the tx so a notify
    // hiccup doesn't roll back the decision.
    createNotification({
      userId: updated.applicantId,
      type: toStatus === LeaveStatus.APPROVED ? 'leave_approved' : 'leave_rejected',
      title: toStatus === LeaveStatus.APPROVED
        ? 'Leave approved'
        : 'Leave rejected',
      body: `${formatDate(updated.startDate)} – ${formatDate(updated.endDate)} (${updated.totalDays} ${updated.totalDays === 1 ? 'day' : 'days'})${note ? ` — ${note}` : ''}`,
      link: `/leaves`,
    }).catch((err) => logger.warn({ err: err?.message }, '[notify] decideLeave applicant failed:'));

    return updated;
  });
}

// ─── Cancel ────────────────────────────────────────────────────────────────

/**
 * Applicant withdraws their own request. Allowed in any status that isn't
 * already CANCELLED — including APPROVED (e.g. plans changed, no longer
 * taking the leave). When cancelling an APPROVED leave, we leave the
 * `decidedBy*` fields intact so the audit trail still shows who originally
 * approved.
 */
export async function cancelLeave(leaveId: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const leave = await tx.leaveRequest.findUnique({ where: { id: leaveId } });
    if (!leave) throw new NotFoundError('Leave request');
    if (leave.applicantId !== actorId) {
      throw new ForbiddenError('You can only cancel your own leave requests');
    }
    if (leave.status === LeaveStatus.CANCELLED) {
      throw new ValidationError('Leave request is already cancelled');
    }
    if (leave.status === LeaveStatus.REJECTED) {
      throw new ValidationError('Cannot cancel a rejected request — it\'s already closed.');
    }

    const updated = await tx.leaveRequest.update({
      where: { id: leaveId },
      data: { status: LeaveStatus.CANCELLED, cancelledAt: new Date() },
      include: { applicant: { select: { id: true, name: true } } },
    });

    await logActivity({
      userId: actorId,
      action: 'cancelled_leave',
      targetType: 'leave',
      targetId: leaveId,
      details: {
        previousStatus: leave.status,
        startDate: formatDate(leave.startDate),
        endDate: formatDate(leave.endDate),
      },
    }, tx);

    // If we cancelled an APPROVED request, ping the approvers so they
    // know the calendar is freed up. Skipped for PENDING (the approver
    // just sees one less item in their queue, no surprise).
    if (leave.status === LeaveStatus.APPROVED) {
      const approvers = await tx.user.findMany({
        where: { role: UserRole.SUPER_ADMIN, isActive: true },
        select: { id: true },
      });
      if (approvers.length > 0) {
        createBulkNotifications(
          approvers.map((a) => ({
            userId: a.id,
            type: 'leave_cancelled',
            title: `${updated.applicant.name} cancelled their leave`,
            body: `${formatDate(leave.startDate)} – ${formatDate(leave.endDate)} (${leave.totalDays} ${leave.totalDays === 1 ? 'day' : 'days'})`,
            link: `/admin/leaves`,
          })),
        ).catch((err) => logger.warn({ err: err?.message }, '[notify] cancelLeave fan-out failed:'));
      }
    }

    return updated;
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Pending count for the admin sidebar badge. SUPER_ADMIN-gated read. */
export async function getPendingLeaveCount(actorId: string): Promise<number> {
  await assertSuperAdmin(actorId, 'count pending');
  return prisma.leaveRequest.count({ where: { status: LeaveStatus.PENDING } });
}

/**
 * Counts per status for the approvals page tab badges. QA L-H1: previously
 * the page only fetched the active-tab list, so non-active tabs always
 * showed `0`. Pankaj couldn't see "Pending (3)" while sitting on the
 * Approved tab. This endpoint returns all five at once so every tab
 * label can render its real count without five separate queries.
 *
 * Implemented as a single grouped count for efficiency.
 */
export async function getLeaveCounts(actorId: string): Promise<Record<LeaveStatus | 'ALL', number>> {
  await assertSuperAdmin(actorId, 'count');
  const groups = await prisma.leaveRequest.groupBy({
    by: ['status'],
    _count: { _all: true },
  });
  const out: Record<LeaveStatus | 'ALL', number> = {
    PENDING: 0,
    APPROVED: 0,
    REJECTED: 0,
    CANCELLED: 0,
    ALL: 0,
  };
  for (const g of groups) {
    out[g.status] = g._count._all;
    out.ALL += g._count._all;
  }
  return out;
}
