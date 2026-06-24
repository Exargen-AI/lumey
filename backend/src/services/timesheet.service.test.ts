/**
 * 2026-05-15 TIMESHEET-LIFECYCLE-AUDIT.
 *
 * Most-used PM-tool feature after tasks; most-broken universally
 * (per the audit-pattern queue). Two HIGH data-integrity bugs +
 * two MEDIUM notification gaps fixed in this PR:
 *
 *   A (HIGH) — `logTime` upsert silently rewrote hours on an
 *     APPROVED week. Billable totals retroactively changed after
 *     sign-off with no audit trail, no error, nothing.
 *
 *   B (HIGH) — `deleteTimeEntry` allowed deleting entries from
 *     APPROVED weeks. Same shape as A — silent retroactive
 *     manipulation.
 *
 *   D — Submission was a silent fan-in. Approvers had to manually
 *     visit `/timesheet/pending` to see new ones. Now we ping
 *     every active ADMIN/PM/SUPER_ADMIN.
 *
 *   E — Approval / rejection was silent for the submitter. They
 *     saw their submission disappear from "pending" with no signal
 *     it had been approved (let alone rejected, with a reason). Now
 *     both actions notify the submitter; rejection inlines the
 *     reason text.
 *
 * Bug C (any `analytics.view_team` holder approves any timesheet
 * org-wide) is flagged but not fixed — single-tenant install model
 * makes this debatable. F/G/H (future dates, bulk atomicity,
 * no audit log on entry edits) are LOW-priority and queued for a
 * follow-up.
 */

import './../test/prismaMock';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import { ForbiddenError } from '../utils/errors';

const {
  notifyTimesheetSubmittedSpy,
  notifyTimesheetApprovedSpy,
  notifyTimesheetRejectedSpy,
} = vi.hoisted(() => ({
  notifyTimesheetSubmittedSpy: vi.fn().mockResolvedValue(undefined),
  notifyTimesheetApprovedSpy: vi.fn().mockResolvedValue(undefined),
  notifyTimesheetRejectedSpy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./notification.service', () => ({
  __esModule: true,
  notifyTimesheetSubmitted: notifyTimesheetSubmittedSpy,
  notifyTimesheetApproved: notifyTimesheetApprovedSpy,
  notifyTimesheetRejected: notifyTimesheetRejectedSpy,
}));

import { logTime, deleteTimeEntry, submitTimesheet, approveTimesheet, rejectTimesheet } from './timesheet.service';

beforeEach(() => {
  notifyTimesheetSubmittedSpy.mockReset();
  notifyTimesheetSubmittedSpy.mockResolvedValue(undefined);
  notifyTimesheetApprovedSpy.mockReset();
  notifyTimesheetApprovedSpy.mockResolvedValue(undefined);
  notifyTimesheetRejectedSpy.mockReset();
  notifyTimesheetRejectedSpy.mockResolvedValue(undefined);

  // Default: caller is a project member.
  prismaMock.projectMember.findUnique.mockResolvedValue({
    userId: 'eng-1', projectId: 'proj-1',
  } as any);
});

// ─── Bug A: logTime refuses APPROVED-week mutations ────────────────────

describe('logTime — approved-week guard (Bug A)', () => {
  it('THROWS ForbiddenError when the target date falls in an APPROVED week (the regression)', async () => {
    // Pivotal repro: pre-fix this call would SILENTLY upsert and
    // rewrite the user's hours on an already-approved week,
    // retroactively changing billable totals.
    prismaMock.timesheetWeek.findUnique.mockResolvedValue({ status: 'APPROVED' } as any);

    await expect(
      logTime('eng-1', { projectId: 'proj-1', taskId: 't-1', date: '2026-05-13', hours: 4 }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // Critical: the timeEntry upsert must NOT have fired.
    expect(prismaMock.timeEntry.upsert).not.toHaveBeenCalled();
    expect(prismaMock.timeEntry.create).not.toHaveBeenCalled();
    expect(prismaMock.timeEntry.update).not.toHaveBeenCalled();
  });

  it('PROCEEDS when the week is DRAFT', async () => {
    prismaMock.timesheetWeek.findUnique.mockResolvedValue({ status: 'DRAFT' } as any);
    prismaMock.timeEntry.upsert.mockResolvedValue({ id: 'te-1' } as any);

    await expect(
      logTime('eng-1', { projectId: 'proj-1', taskId: 't-1', date: '2026-05-13', hours: 4 }),
    ).resolves.toBeDefined();
    expect(prismaMock.timeEntry.upsert).toHaveBeenCalled();
  });

  it('PROCEEDS when the week is SUBMITTED (still in flight — user can edit before approval)', async () => {
    prismaMock.timesheetWeek.findUnique.mockResolvedValue({ status: 'SUBMITTED' } as any);
    prismaMock.timeEntry.upsert.mockResolvedValue({ id: 'te-1' } as any);

    await expect(
      logTime('eng-1', { projectId: 'proj-1', taskId: 't-1', date: '2026-05-13', hours: 4 }),
    ).resolves.toBeDefined();
  });

  it('PROCEEDS when the week is REJECTED (user is fixing and will re-submit)', async () => {
    prismaMock.timesheetWeek.findUnique.mockResolvedValue({ status: 'REJECTED' } as any);
    prismaMock.timeEntry.upsert.mockResolvedValue({ id: 'te-1' } as any);

    await expect(
      logTime('eng-1', { projectId: 'proj-1', taskId: 't-1', date: '2026-05-13', hours: 4 }),
    ).resolves.toBeDefined();
  });

  it('PROCEEDS when there is no TimesheetWeek row yet (first entry of the week)', async () => {
    prismaMock.timesheetWeek.findUnique.mockResolvedValue(null as any);
    prismaMock.timeEntry.upsert.mockResolvedValue({ id: 'te-1' } as any);

    await expect(
      logTime('eng-1', { projectId: 'proj-1', taskId: 't-1', date: '2026-05-13', hours: 4 }),
    ).resolves.toBeDefined();
  });

  it('runs the membership check BEFORE the week-status check (better error UX)', async () => {
    // Non-member should get the membership error, not a misleading
    // "approved week" error — even if their week happens to be
    // approved.
    prismaMock.projectMember.findUnique.mockResolvedValue(null as any);
    prismaMock.timesheetWeek.findUnique.mockResolvedValue({ status: 'APPROVED' } as any);

    await expect(
      logTime('non-member', { projectId: 'proj-1', date: '2026-05-13', hours: 4 }),
    ).rejects.toThrow(/Not a member/);
  });
});

// ─── Bug B: deleteTimeEntry refuses APPROVED-week mutations ────────────

describe('deleteTimeEntry — approved-week guard (Bug B)', () => {
  it('THROWS ForbiddenError when the entry\'s date falls in an APPROVED week (the regression)', async () => {
    prismaMock.timeEntry.findUnique.mockResolvedValue({
      id: 'te-1', userId: 'eng-1', date: new Date('2026-05-13'),
    } as any);
    prismaMock.timesheetWeek.findUnique.mockResolvedValue({ status: 'APPROVED' } as any);

    await expect(deleteTimeEntry('te-1', 'eng-1')).rejects.toBeInstanceOf(ForbiddenError);
    expect(prismaMock.timeEntry.delete).not.toHaveBeenCalled();
  });

  it('PROCEEDS when the entry\'s date falls in a DRAFT week', async () => {
    prismaMock.timeEntry.findUnique.mockResolvedValue({
      id: 'te-1', userId: 'eng-1', date: new Date('2026-05-13'),
    } as any);
    prismaMock.timesheetWeek.findUnique.mockResolvedValue({ status: 'DRAFT' } as any);
    prismaMock.timeEntry.delete.mockResolvedValue({ id: 'te-1' } as any);

    await deleteTimeEntry('te-1', 'eng-1');
    expect(prismaMock.timeEntry.delete).toHaveBeenCalledWith({ where: { id: 'te-1' } });
  });

  it('THROWS "not authorized" when the entry belongs to a different user', async () => {
    // Pre-existing check; regression-pin so a future refactor that
    // adds the week-status guard doesn't accidentally drop the
    // ownership check.
    prismaMock.timeEntry.findUnique.mockResolvedValue({
      id: 'te-1', userId: 'eng-other', date: new Date('2026-05-13'),
    } as any);

    await expect(deleteTimeEntry('te-1', 'eng-1')).rejects.toThrow(/Not authorized/);
    expect(prismaMock.timesheetWeek.findUnique).not.toHaveBeenCalled();
  });
});

// ─── Bug D: submitTimesheet notifies approvers ─────────────────────────

describe('submitTimesheet — approver notification (Bug D) + re-submit guard', () => {
  beforeEach(() => {
    prismaMock.timeEntry.findMany.mockResolvedValue([
      { hours: 4 }, { hours: 4 },
    ] as any);
    prismaMock.timesheetWeek.upsert.mockResolvedValue({
      id: 'tw-1',
      userId: 'eng-1',
      user: { id: 'eng-1', name: 'Vikram' },
    } as any);
  });

  it('FIRES notifyTimesheetSubmitted on successful submission', async () => {
    prismaMock.timesheetWeek.findUnique.mockResolvedValue(null as any);

    await submitTimesheet('eng-1', '2026-05-11'); // Monday

    // Note: weekStart string format depends on the runtime's local
    // timezone (`toDateOnlyString` uses local-date getters). The
    // production code has this same timezone footgun (pre-existing,
    // out of scope for this audit) — we assert on the OTHER args
    // and just check `weekStart` matches the ISO date shape.
    expect(notifyTimesheetSubmittedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        timesheetId: 'tw-1',
        submittedBy: 'eng-1',
        submittedByName: 'Vikram',
        weekStart: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        totalHours: 8,
      }),
    );
  });

  it('THROWS ForbiddenError when the week is already APPROVED (no silent revoke)', async () => {
    // Pre-fix the upsert would happily flip APPROVED → SUBMITTED,
    // effectively un-approving the week without the approver's
    // consent.
    prismaMock.timesheetWeek.findUnique.mockResolvedValue({ status: 'APPROVED' } as any);

    await expect(submitTimesheet('eng-1', '2026-05-11')).rejects.toBeInstanceOf(ForbiddenError);
    expect(prismaMock.timesheetWeek.upsert).not.toHaveBeenCalled();
    expect(notifyTimesheetSubmittedSpy).not.toHaveBeenCalled();
  });

  it('does NOT BLOCK on notification failure (fire-and-forget)', async () => {
    prismaMock.timesheetWeek.findUnique.mockResolvedValue(null as any);
    notifyTimesheetSubmittedSpy.mockRejectedValue(new Error('notify down'));

    await expect(submitTimesheet('eng-1', '2026-05-11')).resolves.toBeDefined();
    expect(prismaMock.timesheetWeek.upsert).toHaveBeenCalled();
  });
});

// ─── Bug E: approveTimesheet + rejectTimesheet notify submitter ────────

describe('approveTimesheet — submitter notification (Bug E)', () => {
  beforeEach(() => {
    prismaMock.timesheetWeek.findUnique.mockResolvedValue({
      id: 'tw-1',
      userId: 'eng-1',
      status: 'SUBMITTED',
      weekStart: new Date('2026-05-11'),
      totalHours: 40,
    } as any);
    prismaMock.timesheetWeek.update.mockResolvedValue({
      id: 'tw-1',
      user: { id: 'eng-1', name: 'Vikram' },
    } as any);
    prismaMock.user.findUnique.mockResolvedValue({ name: 'Maya' } as any);
  });

  it('FIRES notifyTimesheetApproved with approver name + week + total hours', async () => {
    await approveTimesheet('tw-1', 'pm-1');

    expect(notifyTimesheetApprovedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        submitterUserId: 'eng-1',
        approverName: 'Maya',
        weekStart: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        totalHours: 40,
      }),
    );
  });

  it('THROWS when trying to approve a non-SUBMITTED timesheet (regression-pin)', async () => {
    prismaMock.timesheetWeek.findUnique.mockResolvedValue({
      id: 'tw-1', status: 'APPROVED', userId: 'eng-1',
    } as any);

    await expect(approveTimesheet('tw-1', 'pm-1')).rejects.toThrow(/Only submitted/);
    expect(prismaMock.timesheetWeek.update).not.toHaveBeenCalled();
    expect(notifyTimesheetApprovedSpy).not.toHaveBeenCalled();
  });

  it('THROWS when approver IS the submitter (self-approval guard regression-pin)', async () => {
    await expect(approveTimesheet('tw-1', 'eng-1')).rejects.toThrow(/Cannot approve your own/);
    expect(notifyTimesheetApprovedSpy).not.toHaveBeenCalled();
  });
});

describe('rejectTimesheet — submitter notification with REASON inlined (Bug E)', () => {
  beforeEach(() => {
    prismaMock.timesheetWeek.findUnique.mockResolvedValue({
      id: 'tw-1',
      userId: 'eng-1',
      status: 'SUBMITTED',
      weekStart: new Date('2026-05-11'),
      totalHours: 40,
    } as any);
    prismaMock.timesheetWeek.update.mockResolvedValue({
      id: 'tw-1',
      user: { id: 'eng-1', name: 'Vikram' },
    } as any);
    prismaMock.user.findUnique.mockResolvedValue({ name: 'Maya' } as any);
  });

  it('FIRES notifyTimesheetRejected with the REJECTION REASON in the body (closes the loop pre-fix left open)', async () => {
    // Pivotal: pre-fix the reason was captured on the row but
    // NEVER surfaced. Engineers were stuck in a re-submit loop with
    // no idea why their timesheet kept getting rejected. The
    // notification body inlines the reason so the next action is
    // obvious from the lock screen.
    await rejectTimesheet('tw-1', 'pm-1', 'Friday hours seem high — please double-check');

    expect(notifyTimesheetRejectedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        submitterUserId: 'eng-1',
        approverName: 'Maya',
        weekStart: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        reason: 'Friday hours seem high — please double-check',
      }),
    );
  });

  it('uses "No reason provided" when the approver omitted the reason field', async () => {
    await rejectTimesheet('tw-1', 'pm-1', '');

    expect(notifyTimesheetRejectedSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'No reason provided' }),
    );
  });

  it('THROWS when trying to reject a non-SUBMITTED timesheet (regression-pin)', async () => {
    prismaMock.timesheetWeek.findUnique.mockResolvedValue({
      id: 'tw-1', status: 'REJECTED', userId: 'eng-1',
    } as any);

    await expect(rejectTimesheet('tw-1', 'pm-1', 'reason')).rejects.toThrow(/Only submitted/);
    expect(notifyTimesheetRejectedSpy).not.toHaveBeenCalled();
  });
});
