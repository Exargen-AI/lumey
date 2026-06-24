/**
 * Phase 2.6a — milestone.service.
 *
 * High-tier service. Smaller than task.service (108 LOC, 4 functions) but
 * carries one piece of math worth pinning: the `rollupProgress` helper
 * that drives the client-portal progress bars. The visibility gate on
 * `listMilestones` is the same pattern as `listTasks` — it now uses the
 * PER-PROJECT `canViewProjectInternal(viewer, projectId)` helper, so a
 * CLIENT member granted `ProjectMember.fullAccess` sees internal milestones
 * for that project (previously a role-level check that ignored the grant).
 *
 * Properties asserted:
 *
 *   1. **Visibility gate** — non-view_internal callers see only
 *      clientVisible milestones AND the embedded task list filters
 *      to clientVisible only (so client-facing progress bars don't
 *      get inflated by internal-only tasks).
 *
 *   2. **rollupProgress math**:
 *      - Prefers story-point completion when ANY scored work exists.
 *      - Falls back to task-count completion when nothing has points.
 *      - Empty milestones (0 tasks, 0 points) return 0% — never NaN.
 *
 *   3. **Status-change activity log** distinguishes
 *      `completed_milestone` from `updated_milestone` so the audit
 *      feed reads cleanly.
 *
 *   4. **Date normalization** — string dates from the API get cast
 *      to Date instances before the DB write.
 */

import './../test/prismaMock';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskStatus, UserRole } from '@prisma/client';
import { prismaMock } from '../test/prismaMock';
import { ConflictError, NotFoundError } from '../utils/errors';

const {
  canViewInternalSpy,
  logActivitySpy,
  notifyMilestoneCompletedSpy,
  notifyMilestoneDeletedSpy,
} = vi.hoisted(() => ({
  canViewInternalSpy: vi.fn(),
  logActivitySpy: vi.fn().mockResolvedValue(undefined),
  notifyMilestoneCompletedSpy: vi.fn().mockResolvedValue(undefined),
  notifyMilestoneDeletedSpy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./rbac.service', () => ({
  __esModule: true,
  // listMilestones now gates on the PER-PROJECT helper (so a CLIENT member
  // granted ProjectMember.fullAccess sees internal milestones), not the
  // role-level checkPermission it used before. checkPermission stays stubbed
  // in case sibling helpers reach for it.
  checkPermission: vi.fn().mockResolvedValue(false),
  canViewProjectInternal: canViewInternalSpy,
}));
vi.mock('./activity.service', () => ({
  __esModule: true,
  logActivity: logActivitySpy,
}));
vi.mock('./notification.service', () => ({
  __esModule: true,
  notifyMilestoneCompleted: notifyMilestoneCompletedSpy,
  notifyMilestoneDeleted: notifyMilestoneDeletedSpy,
}));

import {
  listMilestones,
  createMilestone,
  updateMilestone,
  deleteMilestone,
} from './milestone.service';

beforeEach(() => {
  canViewInternalSpy.mockReset();
  canViewInternalSpy.mockResolvedValue(false);
  logActivitySpy.mockClear();
});

// ─── listMilestones ────────────────────────────────────────────────────

describe('listMilestones', () => {
  it('orders by milestone date ascending', async () => {
    canViewInternalSpy.mockResolvedValue(true);
    prismaMock.milestone.findMany.mockResolvedValue([] as any);

    await listMilestones('proj-1', { role: UserRole.ADMIN });

    const args = prismaMock.milestone.findMany.mock.calls[0]?.[0] as any;
    expect(args.orderBy).toEqual({ date: 'asc' });
  });

  describe('visibility gate', () => {
    it('filters to clientVisible=true when caller lacks task.view_internal', async () => {
      canViewInternalSpy.mockResolvedValue(false);
      prismaMock.milestone.findMany.mockResolvedValue([] as any);

      await listMilestones('proj-1', { role: UserRole.CLIENT });

      expect(canViewInternalSpy).toHaveBeenCalledWith({ role: UserRole.CLIENT }, 'proj-1');
      const args = prismaMock.milestone.findMany.mock.calls[0]?.[0] as any;
      expect(args.where).toEqual({ projectId: 'proj-1', clientVisible: true });
    });

    it('omits clientVisible filter when caller has task.view_internal (admin)', async () => {
      canViewInternalSpy.mockResolvedValue(true);
      prismaMock.milestone.findMany.mockResolvedValue([] as any);

      await listMilestones('proj-1', { role: UserRole.ADMIN });

      const args = prismaMock.milestone.findMany.mock.calls[0]?.[0] as any;
      expect(args.where).toEqual({ projectId: 'proj-1' });
    });

    it('also filters the embedded task list to clientVisible-only for non-view_internal callers', async () => {
      // Critical: without this filter, a client's progress bar would
      // count internal tasks too — inflating the rollup denominator
      // with work the client can't see.
      canViewInternalSpy.mockResolvedValue(false);
      prismaMock.milestone.findMany.mockResolvedValue([] as any);

      await listMilestones('proj-1', { role: UserRole.CLIENT });

      const include = prismaMock.milestone.findMany.mock.calls[0]?.[0]?.include as any;
      expect(include.tasks.where).toEqual({ clientVisible: true });
    });

    it('passes the task list unfiltered for admin callers (see all tasks)', async () => {
      canViewInternalSpy.mockResolvedValue(true);
      prismaMock.milestone.findMany.mockResolvedValue([] as any);

      await listMilestones('proj-1', { role: UserRole.ADMIN });

      const include = prismaMock.milestone.findMany.mock.calls[0]?.[0]?.include as any;
      expect(include.tasks.where).toBeUndefined();
    });

    it('grants the full milestone set to a CLIENT member with per-project full access', async () => {
      // canViewProjectInternal resolves true for a CLIENT granted
      // ProjectMember.fullAccess. The service must NOT add a clientVisible
      // filter for them — they see internal milestones + the full embedded
      // task rollup, same as staff. This is the bug the screenshot surfaced:
      // milestones were gated by a role check that ignored the grant.
      canViewInternalSpy.mockResolvedValue(true);
      prismaMock.milestone.findMany.mockResolvedValue([] as any);

      await listMilestones('proj-1', { id: 'client-1', role: UserRole.CLIENT });

      expect(canViewInternalSpy).toHaveBeenCalledWith(
        { id: 'client-1', role: UserRole.CLIENT },
        'proj-1',
      );
      const args = prismaMock.milestone.findMany.mock.calls[0]?.[0] as any;
      expect(args.where).toEqual({ projectId: 'proj-1' });
      const include = prismaMock.milestone.findMany.mock.calls[0]?.[0]?.include as any;
      expect(include.tasks.where).toBeUndefined();
    });
  });

  describe('rollupProgress math (the client-facing progress bar)', () => {
    function buildMilestone(tasks: Array<{ storyPoints: number | null; status: TaskStatus }>) {
      return { id: 'm1', projectId: 'proj-1', tasks };
    }

    it('returns 0% completion for an empty milestone (no tasks, no points) — never NaN', async () => {
      canViewInternalSpy.mockResolvedValue(true);
      prismaMock.milestone.findMany.mockResolvedValue([buildMilestone([])] as any);

      const result = await listMilestones('proj-1', { role: UserRole.ADMIN });

      expect(result[0]!.progress).toEqual({
        totalTasks: 0,
        doneTasks: 0,
        totalPoints: 0,
        donePoints: 0,
        completionPct: 0,
      });
    });

    it('falls back to TASK-COUNT completion when no task has story points', async () => {
      canViewInternalSpy.mockResolvedValue(true);
      prismaMock.milestone.findMany.mockResolvedValue([
        buildMilestone([
          { storyPoints: null, status: TaskStatus.DONE },
          { storyPoints: null, status: TaskStatus.IN_PROGRESS },
          { storyPoints: null, status: TaskStatus.TODO },
          { storyPoints: null, status: TaskStatus.DONE },
        ]),
      ] as any);

      const result = await listMilestones('proj-1', { role: UserRole.ADMIN });

      // 2 of 4 tasks DONE → 50% by task count.
      expect(result[0]!.progress.completionPct).toBe(50);
      expect(result[0]!.progress.totalPoints).toBe(0);
    });

    it('PREFERS story-point completion when ANY task is scored', async () => {
      // Mixed-score scenario — the spec says "any scored work" triggers
      // the point path, even when most tasks are unscored.
      canViewInternalSpy.mockResolvedValue(true);
      prismaMock.milestone.findMany.mockResolvedValue([
        buildMilestone([
          { storyPoints: 5, status: TaskStatus.DONE },     // 5 done points
          { storyPoints: 3, status: TaskStatus.IN_PROGRESS }, // 0 done
          { storyPoints: null, status: TaskStatus.DONE },   // counted in task tally but 0 points
        ]),
      ] as any);

      const result = await listMilestones('proj-1', { role: UserRole.ADMIN });

      // donePoints: 5, totalPoints: 8 → 63% (Math.round)
      expect(result[0]!.progress.totalPoints).toBe(8);
      expect(result[0]!.progress.donePoints).toBe(5);
      expect(result[0]!.progress.completionPct).toBe(63);
      // Task counts still reported alongside.
      expect(result[0]!.progress.totalTasks).toBe(3);
      expect(result[0]!.progress.doneTasks).toBe(2);
    });

    it('rounds completionPct to the nearest integer (no fractional %)', async () => {
      canViewInternalSpy.mockResolvedValue(true);
      // 1 done of 3 same-points tasks → 33.33% → rounds to 33.
      prismaMock.milestone.findMany.mockResolvedValue([
        buildMilestone([
          { storyPoints: 5, status: TaskStatus.DONE },
          { storyPoints: 5, status: TaskStatus.IN_PROGRESS },
          { storyPoints: 5, status: TaskStatus.TODO },
        ]),
      ] as any);

      const result = await listMilestones('proj-1', { role: UserRole.ADMIN });
      expect(result[0]!.progress.completionPct).toBe(33);
    });

    it('strips the nested `tasks` array from the response (payload-bloat + leak risk)', async () => {
      canViewInternalSpy.mockResolvedValue(true);
      prismaMock.milestone.findMany.mockResolvedValue([
        { ...buildMilestone([{ storyPoints: 5, status: TaskStatus.DONE }]), title: 'X' },
      ] as any);

      const result = await listMilestones('proj-1', { role: UserRole.ADMIN });

      expect((result[0] as any).tasks).toBeUndefined();
      expect(result[0]!.progress).toBeDefined();
    });
  });
});

// ─── createMilestone ───────────────────────────────────────────────────

describe('createMilestone', () => {
  it('creates the row with projectId injected + date cast to Date instance', async () => {
    prismaMock.milestone.create.mockImplementation(((args: any) =>
      Promise.resolve({ id: 'm-new', ...args.data })
    ) as any);

    await createMilestone(
      'proj-1',
      { title: 'Alpha launch', date: '2026-06-01' },
      'u-creator',
    );

    const createCall = prismaMock.milestone.create.mock.calls[0]?.[0] as any;
    expect(createCall.data.projectId).toBe('proj-1');
    expect(createCall.data.title).toBe('Alpha launch');
    // Date is a real Date instance, not a string.
    expect(createCall.data.date).toBeInstanceOf(Date);
    expect(createCall.data.date.toISOString().slice(0, 10)).toBe('2026-06-01');
  });

  it('writes a created_milestone activity log entry on success', async () => {
    prismaMock.milestone.create.mockImplementation(((args: any) =>
      Promise.resolve({ id: 'm-new', ...args.data })
    ) as any);

    await createMilestone(
      'proj-1',
      { title: 'Alpha', date: '2026-06-01' },
      'u-creator',
    );

    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-creator',
        projectId: 'proj-1',
        action: 'created_milestone',
        targetType: 'milestone',
        details: { title: 'Alpha' },
      }),
    );
  });
});

// ─── updateMilestone ───────────────────────────────────────────────────

describe('updateMilestone', () => {
  beforeEach(() => {
    prismaMock.milestone.update.mockImplementation(((args: any) =>
      Promise.resolve({ id: 'm1', ...args.data })
    ) as any);
  });

  it('throws NotFoundError when the milestone does not exist', async () => {
    prismaMock.milestone.findUnique.mockResolvedValue(null);
    await expect(
      updateMilestone('gone', { title: 'X' }, 'u1'),
    ).rejects.toThrow(NotFoundError);
  });

  it('normalises string date to Date instance before persist', async () => {
    prismaMock.milestone.findUnique.mockResolvedValue({
      id: 'm1',
      projectId: 'proj-1',
      status: 'UPCOMING',
    } as any);

    await updateMilestone('m1', { date: '2026-09-01' }, 'u1');

    const updateCall = prismaMock.milestone.update.mock.calls[0]?.[0] as any;
    expect(updateCall.data.date).toBeInstanceOf(Date);
    expect(updateCall.data.date.toISOString().slice(0, 10)).toBe('2026-09-01');
  });

  it('logs `completed_milestone` action when status flips to COMPLETED', async () => {
    prismaMock.milestone.findUnique.mockResolvedValue({
      id: 'm1',
      projectId: 'proj-1',
      status: 'UPCOMING',
      title: 'Alpha',
    } as any);
    prismaMock.milestone.update.mockResolvedValue({
      id: 'm1',
      title: 'Alpha',
    } as any);

    await updateMilestone('m1', { status: 'COMPLETED' }, 'u-pm');

    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'completed_milestone',
        details: expect.objectContaining({ from: 'UPCOMING', to: 'COMPLETED' }),
      }),
    );
  });

  it('logs `reopened_milestone` when COMPLETED → UPCOMING (2026-05-15 audit — more precise than the original `updated_milestone` label)', async () => {
    // Pre-audit this transition logged the generic `updated_milestone`.
    // The new shape distinguishes reopen / missed / completed-late
    // so the activity feed surfaces what actually happened. See
    // `assertLegalMilestoneTransition` doc-comment for the full
    // transition table.
    prismaMock.milestone.findUnique.mockResolvedValue({
      id: 'm1',
      projectId: 'proj-1',
      status: 'COMPLETED',
      title: 'Alpha',
    } as any);
    prismaMock.milestone.update.mockResolvedValue({
      id: 'm1',
      title: 'Alpha',
    } as any);

    await updateMilestone('m1', { status: 'UPCOMING' }, 'u-pm');

    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'reopened_milestone',
        details: expect.objectContaining({ from: 'COMPLETED', to: 'UPCOMING' }),
      }),
    );
  });

  it('does NOT log a status-change entry when status is unchanged (no-op)', async () => {
    prismaMock.milestone.findUnique.mockResolvedValue({
      id: 'm1',
      projectId: 'proj-1',
      status: 'UPCOMING',
      title: 'Alpha',
    } as any);

    await updateMilestone('m1', { title: 'Alpha Renamed' }, 'u-pm');

    // Title change only — no activity log fires.
    expect(logActivitySpy).not.toHaveBeenCalled();
  });
});

// ─── deleteMilestone ───────────────────────────────────────────────────

describe('deleteMilestone', () => {
  it('throws NotFoundError when the milestone does not exist (no delete + no audit)', async () => {
    prismaMock.milestone.findUnique.mockResolvedValue(null);

    await expect(deleteMilestone('gone', 'u1')).rejects.toThrow(NotFoundError);

    expect(prismaMock.milestone.delete).not.toHaveBeenCalled();
    expect(logActivitySpy).not.toHaveBeenCalled();
  });

  it('deletes the row + writes a deleted_milestone audit entry (now with affectedTaskCount)', async () => {
    prismaMock.milestone.findUnique.mockResolvedValue({
      id: 'm1',
      projectId: 'proj-1',
      title: 'Alpha',
    } as any);
    // 2026-05-15 audit added a task.count query to surface
    // how many tasks lose their milestone tag on cascade.
    prismaMock.task.count.mockResolvedValue(0);

    await deleteMilestone('m1', 'u-deleter');

    expect(prismaMock.milestone.delete).toHaveBeenCalledWith({ where: { id: 'm1' } });
    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-deleter',
        projectId: 'proj-1',
        action: 'deleted_milestone',
        targetType: 'milestone',
        targetId: 'm1',
        // affectedTaskCount is the new field added by the audit so
        // members + audit log understand "these tasks lost their
        // milestone tag" rather than thinking the tasks themselves
        // were deleted.
        details: { title: 'Alpha', affectedTaskCount: 0 },
      }),
    );
  });
});

// ─── 2026-05-15 milestone-lifecycle audit — new bug-fix tests ──────────

describe('updateMilestone — status-transition validation (Bug A)', () => {
  // The pivotal regression: COMPLETED → MISSED was silently allowed,
  // letting a PM rewrite milestone history (a landed milestone
  // shouldn't be retroactively "missed"). Same shape as the
  // sprint-restart-completed bug fixed in #123.
  it('THROWS ValidationError when transitioning COMPLETED → MISSED (history-rewrite refused)', async () => {
    prismaMock.milestone.findUnique.mockResolvedValue({
      id: 'm1',
      projectId: 'proj-1',
      status: 'COMPLETED',
      title: 'Alpha',
    } as any);

    await expect(
      updateMilestone('m1', { status: 'MISSED' }, 'u-pm'),
    ).rejects.toThrow(/Cannot mark a completed milestone as missed/);

    // CRITICAL: the underlying update must not have fired.
    expect(prismaMock.milestone.update).not.toHaveBeenCalled();
    expect(logActivitySpy).not.toHaveBeenCalled();
  });

  it('ALLOWS COMPLETED → UPCOMING (reopen — sometimes the team decides the milestone wasn\'t hit)', async () => {
    prismaMock.milestone.findUnique.mockResolvedValue({
      id: 'm1',
      projectId: 'proj-1',
      status: 'COMPLETED',
      title: 'Alpha',
    } as any);
    prismaMock.milestone.update.mockResolvedValue({ id: 'm1', title: 'Alpha' } as any);

    await updateMilestone('m1', { status: 'UPCOMING' }, 'u-pm');

    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reopened_milestone' }),
    );
  });

  it('ALLOWS UPCOMING → MISSED (manual mark-as-missed before any cron exists)', async () => {
    prismaMock.milestone.findUnique.mockResolvedValue({
      id: 'm1', projectId: 'proj-1', status: 'UPCOMING', title: 'Alpha',
    } as any);
    prismaMock.milestone.update.mockResolvedValue({ id: 'm1', title: 'Alpha' } as any);

    await updateMilestone('m1', { status: 'MISSED' }, 'u-pm');

    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'missed_milestone' }),
    );
  });

  it('ALLOWS MISSED → COMPLETED (late delivery correcting history)', async () => {
    prismaMock.milestone.findUnique.mockResolvedValue({
      id: 'm1', projectId: 'proj-1', status: 'MISSED', title: 'Alpha',
    } as any);
    prismaMock.milestone.update.mockResolvedValue({ id: 'm1', title: 'Alpha' } as any);

    await updateMilestone('m1', { status: 'COMPLETED' }, 'u-pm');

    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'completed_milestone' }),
    );
  });

  it('ALLOWS MISSED → UPCOMING (reopen from miss)', async () => {
    prismaMock.milestone.findUnique.mockResolvedValue({
      id: 'm1', projectId: 'proj-1', status: 'MISSED', title: 'Alpha',
    } as any);
    prismaMock.milestone.update.mockResolvedValue({ id: 'm1', title: 'Alpha' } as any);

    await updateMilestone('m1', { status: 'UPCOMING' }, 'u-pm');

    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reopened_milestone' }),
    );
  });
});

describe('updateMilestone — completion notification (Bug B)', () => {
  beforeEach(() => {
    prismaMock.milestone.findUnique.mockResolvedValue({
      id: 'm1',
      projectId: 'proj-1',
      status: 'UPCOMING',
      title: 'Alpha',
    } as any);
    prismaMock.milestone.update.mockResolvedValue({ id: 'm1', title: 'Alpha' } as any);
    prismaMock.project.findUnique.mockResolvedValue({ name: 'Indigo' } as any);
    prismaMock.user.findUnique.mockResolvedValue({ name: 'Maya' } as any);
    notifyMilestoneCompletedSpy.mockReset();
    notifyMilestoneCompletedSpy.mockResolvedValue(undefined);
  });

  it('FIRES notifyMilestoneCompleted when status transitions to COMPLETED', async () => {
    await updateMilestone('m1', { status: 'COMPLETED' }, 'u-pm');

    expect(notifyMilestoneCompletedSpy).toHaveBeenCalledWith({
      milestoneId: 'm1',
      projectId: 'proj-1',
      milestoneTitle: 'Alpha',
      projectName: 'Indigo',
      completedBy: 'u-pm',
      completedByName: 'Maya',
    });
  });

  it('does NOT fire notification on other transitions (reopen, miss)', async () => {
    prismaMock.milestone.findUnique.mockResolvedValue({
      id: 'm1', projectId: 'proj-1', status: 'UPCOMING', title: 'Alpha',
    } as any);

    await updateMilestone('m1', { status: 'MISSED' }, 'u-pm');

    expect(notifyMilestoneCompletedSpy).not.toHaveBeenCalled();
  });

  it('does NOT BLOCK the update on notification failure (fire-and-forget)', async () => {
    notifyMilestoneCompletedSpy.mockRejectedValue(new Error('notify down'));

    await expect(
      updateMilestone('m1', { status: 'COMPLETED' }, 'u-pm'),
    ).resolves.toBeDefined();
    expect(prismaMock.milestone.update).toHaveBeenCalled();
  });
});

describe('deleteMilestone — member notification + affected-task count (Bug C)', () => {
  beforeEach(() => {
    prismaMock.milestone.findUnique.mockResolvedValue({
      id: 'm1',
      projectId: 'proj-1',
      title: 'Alpha',
    } as any);
    prismaMock.project.findUnique.mockResolvedValue({ name: 'Indigo' } as any);
    prismaMock.user.findUnique.mockResolvedValue({ name: 'Maya' } as any);
    notifyMilestoneDeletedSpy.mockReset();
    notifyMilestoneDeletedSpy.mockResolvedValue(undefined);
  });

  it('CAPTURES the affected-task count BEFORE the delete fires (pre-cascade snapshot)', async () => {
    prismaMock.task.count.mockResolvedValue(7);

    await deleteMilestone('m1', 'u-deleter');

    // Both audit + notification surfaces should carry the count.
    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({ affectedTaskCount: 7 }),
      }),
    );
    expect(notifyMilestoneDeletedSpy).toHaveBeenCalledWith(
      expect.objectContaining({ affectedTaskCount: 7 }),
    );
  });

  it('FIRES notifyMilestoneDeleted with deleter name + project name', async () => {
    prismaMock.task.count.mockResolvedValue(0);

    await deleteMilestone('m1', 'u-deleter');

    expect(notifyMilestoneDeletedSpy).toHaveBeenCalledWith({
      projectId: 'proj-1',
      milestoneTitle: 'Alpha',
      projectName: 'Indigo',
      deletedBy: 'u-deleter',
      deletedByName: 'Maya',
      affectedTaskCount: 0,
    });
  });

  it('order regression-pin: task.count fires BEFORE milestone.delete (so tasks are still linked)', async () => {
    prismaMock.task.count.mockResolvedValue(3);

    await deleteMilestone('m1', 'u-deleter');

    const countCallOrder = prismaMock.task.count.mock.invocationCallOrder[0];
    const deleteCallOrder = prismaMock.milestone.delete.mock.invocationCallOrder[0];
    expect(countCallOrder).toBeLessThan(deleteCallOrder);
  });

  it('does NOT BLOCK the delete on notification failure (fire-and-forget)', async () => {
    prismaMock.task.count.mockResolvedValue(0);
    notifyMilestoneDeletedSpy.mockRejectedValue(new Error('notify down'));

    await expect(deleteMilestone('m1', 'u-deleter')).resolves.toBeUndefined();
    expect(prismaMock.milestone.delete).toHaveBeenCalled();
  });
});

// ─── 2026-05-21 optimistic-locking expansion (PR #128 pattern → Milestone) ─

describe('updateMilestone — optimistic locking', () => {
  const SERVER_UPDATED_AT = new Date('2026-05-21T10:00:00.000Z');

  beforeEach(() => {
    prismaMock.milestone.findUnique.mockResolvedValue({
      id: 'm1',
      projectId: 'proj-1',
      status: 'UPCOMING',
      title: 'Old',
      updatedAt: SERVER_UPDATED_AT,
    } as any);
  });

  it('writes through unchanged when expectedUpdatedAt is omitted (backwards compat)', async () => {
    prismaMock.milestone.update.mockResolvedValue({ id: 'm1', title: 'New' } as any);

    await updateMilestone('m1', { title: 'New' }, 'u1');

    // No conflict thrown, plain update used (not updateMany).
    expect(prismaMock.milestone.update).toHaveBeenCalled();
    expect(prismaMock.milestone.updateMany).not.toHaveBeenCalled();
  });

  it('uses updateMany with a compound where when expectedUpdatedAt matches', async () => {
    prismaMock.milestone.updateMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.milestone.findUnique.mockResolvedValueOnce({
      id: 'm1',
      projectId: 'proj-1',
      status: 'UPCOMING',
      title: 'Old',
      updatedAt: SERVER_UPDATED_AT,
    } as any);
    // 2nd findUnique → post-write re-fetch
    prismaMock.milestone.findUnique.mockResolvedValueOnce({
      id: 'm1',
      title: 'New',
      updatedAt: new Date('2026-05-21T11:00:00.000Z'),
    } as any);

    await updateMilestone('m1', { title: 'New' }, 'u1', SERVER_UPDATED_AT.toISOString());

    const args = (prismaMock.milestone.updateMany as any).mock.calls[0]?.[0];
    expect(args.where).toEqual({ id: 'm1', updatedAt: SERVER_UPDATED_AT });
  });

  it('throws ConflictError at the EARLY check when expectedUpdatedAt is stale', async () => {
    await expect(
      updateMilestone(
        'm1',
        { title: 'New' },
        'u1',
        new Date('2026-05-21T09:00:00.000Z').toISOString(), // older than server
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    // Should NOT have reached the write at all.
    expect(prismaMock.milestone.update).not.toHaveBeenCalled();
    expect(prismaMock.milestone.updateMany).not.toHaveBeenCalled();
  });

  it('throws ConflictError at the WRITE-TIME check when the race wins between fetch and write', async () => {
    // updatedAt matches at the early check, but someone else slips a
    // write in before we get to the updateMany — count comes back 0.
    prismaMock.milestone.updateMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.milestone.findUnique.mockResolvedValueOnce({
      id: 'm1',
      projectId: 'proj-1',
      status: 'UPCOMING',
      updatedAt: SERVER_UPDATED_AT,
    } as any);
    prismaMock.milestone.findUnique.mockResolvedValueOnce({
      updatedAt: new Date('2026-05-21T10:00:01.000Z'),
    } as any);

    await expect(
      updateMilestone('m1', { title: 'New' }, 'u1', SERVER_UPDATED_AT.toISOString()),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
