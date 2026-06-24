/**
 * 2026-05-23 PM-tool active-bug-hunt audit — regression tests for the 3
 * REAL bugs found by reading code looking for common PM-tool failure modes.
 *
 * Each `describe` block pins one bug + its fix. Tests are written so the
 * test FAILS if the buggy behaviour ever comes back. The audit found:
 *
 *   Bug #1 (HIGH): TaskSubscription rows orphaned on project-member
 *                  removal. Removed user kept getting comment / edit
 *                  notifications about tasks in a project they no
 *                  longer had access to (privacy + spam).
 *
 *   Bug #2 (MEDIUM): TOCTOU race on the Done-gate. The AC check ran
 *                    BEFORE the move transaction opened. A concurrent
 *                    AC uncheck between read and write could let a
 *                    task land in DONE with unchecked criteria.
 *
 *   Bug #3 (MEDIUM): status-history hole in updateTask. Form-driven
 *                    status changes mutated `status` without writing a
 *                    TaskStatusHistory row. Broke the aging-dot
 *                    calculation and the streak-encouragement counter
 *                    that both read from history.
 */

import './../test/prismaMock';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import { TaskStatus, UserRole } from '@prisma/client';
import { ValidationError } from '../utils/errors';

const { logActivitySpy, notifySpy, checkPermissionSpy } = vi.hoisted(() => ({
  logActivitySpy: vi.fn().mockResolvedValue(undefined),
  notifySpy: {
    notifyRemovedFromProject: vi.fn().mockResolvedValue(undefined),
    notifyMemberRemovedFromProject: vi.fn().mockResolvedValue(undefined),
    notifyTaskCompletionEncouragement: vi.fn().mockResolvedValue(undefined),
    notifyTaskBlocked: vi.fn().mockResolvedValue(undefined),
    notifyTaskAssigned: vi.fn().mockResolvedValue(undefined),
    notifyTaskPriorityChanged: vi.fn().mockResolvedValue(undefined),
    notifyTaskDueDateChanged: vi.fn().mockResolvedValue(undefined),
    notifyTaskSubscribersOfEdit: vi.fn().mockResolvedValue(undefined),
  },
  checkPermissionSpy: vi.fn().mockResolvedValue(true),
}));

vi.mock('./activity.service', () => ({
  __esModule: true,
  logActivity: logActivitySpy,
}));
vi.mock('./notification.service', () => ({
  __esModule: true,
  ...notifySpy,
}));
vi.mock('./rbac.service', () => ({
  __esModule: true,
  checkPermission: checkPermissionSpy,
}));
vi.mock('./taskSubscription.service', () => ({
  __esModule: true,
  subscribeToTask: vi.fn().mockResolvedValue(undefined),
  unsubscribeFromTask: vi.fn().mockResolvedValue(undefined),
  listTaskSubscribers: vi.fn().mockResolvedValue([]),
  getSubscriberIdsForNotify: vi.fn().mockResolvedValue([]),
}));
vi.mock('./customField.service', () => ({
  __esModule: true,
  validateValuesForProject: vi.fn(async (_pid: string, v: any) => v),
}));

import { removeProjectMember } from './project.service';
import { moveTask, updateTask } from './task.service';

beforeEach(() => {
  vi.clearAllMocks();
  checkPermissionSpy.mockResolvedValue(true);
  prismaMock.$transaction.mockImplementation(async (fn: any, _opts?: any) => fn(prismaMock));
});

// ─── Bug #1 — Subscription cleanup on project-member removal ─────────

describe('Bug #1 fix: removeProjectMember drops the user\'s task subscriptions for this project', () => {
  it('calls taskSubscription.deleteMany scoped to (userId, project tasks)', async () => {
    prismaMock.project.findUnique.mockResolvedValue({ name: 'Indigo' } as any);
    prismaMock.user.findUnique.mockResolvedValue({ name: 'Alice' } as any);
    prismaMock.task.findMany.mockResolvedValue([] as any); // no assignee/reviewer orphans
    prismaMock.task.updateMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.taskSubscription.deleteMany.mockResolvedValue({ count: 3 } as any);
    prismaMock.projectMember.delete.mockResolvedValue({} as any);
    prismaMock.projectMember.findMany.mockResolvedValue([] as any);

    await removeProjectMember('proj-1', 'leaving-user', 'admin-1');

    // The CRITICAL assertion: subscriptions for the leaving user, scoped
    // to tasks in this project (NOT every subscription they hold), get
    // deleted. Scoping is what prevents over-zealous cleanup (subs on
    // other projects must survive).
    expect(prismaMock.taskSubscription.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: 'leaving-user',
        task: { projectId: 'proj-1' },
      },
    });
  });

  it('records droppedSubscriptionCount in the activity log details', async () => {
    prismaMock.project.findUnique.mockResolvedValue({ name: 'Indigo' } as any);
    prismaMock.user.findUnique.mockResolvedValue({ name: 'Alice' } as any);
    prismaMock.task.findMany.mockResolvedValue([] as any);
    prismaMock.task.updateMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.taskSubscription.deleteMany.mockResolvedValue({ count: 5 } as any);
    prismaMock.projectMember.delete.mockResolvedValue({} as any);
    prismaMock.projectMember.findMany.mockResolvedValue([] as any);

    await removeProjectMember('proj-1', 'leaving-user', 'admin-1');

    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'removed_member',
        details: expect.objectContaining({ droppedSubscriptionCount: 5 }),
      }),
      expect.anything(),
    );
  });

  it('omits droppedSubscriptionCount from activity log when there are no subscriptions to drop (clean removal)', async () => {
    prismaMock.project.findUnique.mockResolvedValue({ name: 'Indigo' } as any);
    prismaMock.user.findUnique.mockResolvedValue({ name: 'Alice' } as any);
    prismaMock.task.findMany.mockResolvedValue([] as any);
    prismaMock.task.updateMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.taskSubscription.deleteMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.projectMember.delete.mockResolvedValue({} as any);
    prismaMock.projectMember.findMany.mockResolvedValue([] as any);

    await removeProjectMember('proj-1', 'leaving-user', 'admin-1');

    const call = logActivitySpy.mock.calls.find(
      (c: any) => c[0]?.action === 'removed_member',
    );
    expect(call?.[0]?.details).toBeUndefined();
  });
});

// Note: the defence-in-depth filter test for `getSubscriberIdsForNotify`
// (user.isActive=true) lives in `taskSubscription.service.test.ts`
// where the real helper is already imported. Keeping the test next to
// the helper rather than here, where vi.mock has replaced the module.

// ─── Bug #2 — TOCTOU race on the Done-gate ────────────────────────────

describe('Bug #2 fix: moveTask re-reads AC inside the transaction to close the TOCTOU window', () => {
  it('blocks the move when AC was unchecked by a concurrent edit between the outer read and the inner-tx write', async () => {
    // Outer read: AC appears fully checked. Owned so the active-status
    // assignee gate passes and the AC gate is the one under test.
    prismaMock.task.findUnique
      .mockResolvedValueOnce({
        id: 't1',
        projectId: 'p1',
        status: TaskStatus.IN_PROGRESS,
        assigneeId: 'user-1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        acceptanceCriteria: [{ text: 'A', done: true }],
      } as any)
      // Inner-tx re-read: a concurrent edit unticked the AC.
      .mockResolvedValueOnce({
        acceptanceCriteria: [{ text: 'A', done: false }],
      } as any);

    // moveTask calls aggregate to compute sortOrder before the tx opens.
    prismaMock.task.aggregate.mockResolvedValue({ _max: { sortOrder: 0 } } as any);
    checkPermissionSpy.mockResolvedValue(true); // transition.done permitted

    await expect(
      moveTask('t1', TaskStatus.DONE, undefined, 'user-1', {
        userType: 'HUMAN',
        role: UserRole.ENGINEER,
      }),
    ).rejects.toThrow(/acceptance criterion is still unchecked/);

    // CRITICAL: the rejection MUST come from the inner-tx re-read, not
    // the outer one. If the outer one had fired, the test would have
    // thrown without ever invoking the transaction. We can verify the
    // tx was entered by checking the inner findUnique was called.
    expect(prismaMock.task.findUnique).toHaveBeenCalledTimes(2);
    expect(prismaMock.task.update).not.toHaveBeenCalled();
  });

  it('succeeds when both reads see AC as fully checked (the happy path is unchanged)', async () => {
    const checkedAC = [{ text: 'A', done: true }];
    prismaMock.task.findUnique
      .mockResolvedValueOnce({
        id: 't1',
        projectId: 'p1',
        status: TaskStatus.IN_PROGRESS,
        // Owned + createdAt: the active-status gate passes and the
        // task-closed productivity emit (runs on a successful DONE) has the
        // age inputs it needs.
        assigneeId: 'user-1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        acceptanceCriteria: checkedAC,
      } as any)
      .mockResolvedValueOnce({ acceptanceCriteria: checkedAC } as any);
    prismaMock.task.aggregate.mockResolvedValue({ _max: { sortOrder: 0 } } as any);
    prismaMock.task.update.mockResolvedValue({
      id: 't1',
      status: TaskStatus.DONE,
    } as any);
    prismaMock.taskStatusHistory.create.mockResolvedValue({} as any);
    checkPermissionSpy.mockResolvedValue(true);

    const result = await moveTask('t1', TaskStatus.DONE, undefined, 'user-1', {
      userType: 'HUMAN',
      role: UserRole.ENGINEER,
    });
    expect(result?.status).toBe(TaskStatus.DONE);
  });
});

// ─── Bug #3 — Status-history hole in updateTask ────────────────────────

describe('Bug #3 fix: updateTask writes a taskStatusHistory row when status changes', () => {
  const existingTask = {
    id: 't1',
    projectId: 'proj-1',
    assigneeId: 'user-1',
    creatorId: 'user-1',
    status: TaskStatus.IN_PROGRESS,
    title: 'Build login',
    isBlocked: false,
    acceptanceCriteria: [],
    updatedAt: new Date('2026-05-23T10:00:00Z'),
  };

  beforeEach(() => {
    prismaMock.task.findUnique.mockResolvedValue(existingTask as any);
    prismaMock.task.update.mockImplementation(((args: any) =>
      Promise.resolve({ ...existingTask, ...args.data })
    ) as any);
    prismaMock.taskStatusHistory.create.mockResolvedValue({} as any);
    prismaMock.projectMember.findFirst.mockResolvedValue({ id: 'm-1' } as any);
    prismaMock.project.findUnique.mockResolvedValue({ name: 'Indigo' } as any);
    prismaMock.user.findUnique.mockResolvedValue({ name: 'User' } as any);
  });

  it('writes a TaskStatusHistory row when status changes via the form (was silently missing pre-fix)', async () => {
    await updateTask('t1', { status: TaskStatus.IN_REVIEW }, 'user-1', UserRole.ENGINEER);

    expect(prismaMock.taskStatusHistory.create).toHaveBeenCalledWith({
      data: {
        taskId: 't1',
        fromStatus: TaskStatus.IN_PROGRESS,
        toStatus: TaskStatus.IN_REVIEW,
        changedBy: 'user-1',
      },
    });
  });

  it('does NOT write a history row when only non-status fields change (title-only edit)', async () => {
    await updateTask('t1', { title: 'Renamed' }, 'user-1', UserRole.ENGINEER);
    expect(prismaMock.taskStatusHistory.create).not.toHaveBeenCalled();
  });

  it('does NOT write a history row when status patch equals current status (no-op write)', async () => {
    await updateTask(
      't1',
      { status: TaskStatus.IN_PROGRESS },
      'user-1',
      UserRole.ENGINEER,
    );
    expect(prismaMock.taskStatusHistory.create).not.toHaveBeenCalled();
  });

  it('writes the history row INSIDE the same $transaction as the status update (audit-trail atomicity)', async () => {
    await updateTask('t1', { status: TaskStatus.IN_REVIEW }, 'user-1', UserRole.ENGINEER);
    // $transaction was used exactly once (the write block).
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.task.update).toHaveBeenCalled();
    expect(prismaMock.taskStatusHistory.create).toHaveBeenCalled();
  });

  it('writes a history row for the optimistic-locking path too (expectedUpdatedAt provided)', async () => {
    prismaMock.task.updateMany.mockResolvedValue({ count: 1 } as any);
    // The path also calls findUnique inside the tx after updateMany.
    prismaMock.task.findUnique
      .mockResolvedValueOnce(existingTask as any) // initial outer-read
      .mockResolvedValueOnce({ ...existingTask, status: TaskStatus.IN_REVIEW } as any); // post-write

    await updateTask(
      't1',
      { status: TaskStatus.IN_REVIEW, expectedUpdatedAt: existingTask.updatedAt.toISOString() } as any,
      'user-1',
      UserRole.ENGINEER,
    );

    expect(prismaMock.taskStatusHistory.create).toHaveBeenCalledWith({
      data: {
        taskId: 't1',
        fromStatus: TaskStatus.IN_PROGRESS,
        toStatus: TaskStatus.IN_REVIEW,
        changedBy: 'user-1',
      },
    });
  });

  it('refuses the DONE transition when AC is unchecked (gate still fires from the form path)', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      ...existingTask,
      acceptanceCriteria: [{ done: false }],
    } as any);
    await expect(
      updateTask('t1', { status: TaskStatus.DONE }, 'user-1', UserRole.ENGINEER),
    ).rejects.toThrow(ValidationError);
    // History row must NOT have been written on the failed move.
    expect(prismaMock.taskStatusHistory.create).not.toHaveBeenCalled();
  });
});
