/**
 * 2026-05-15 PROJECT-MEMBERSHIP-LIFECYCLE-AUDIT.
 *
 * Surfaced 4 gaps in the add/remove/role-change flow:
 *
 *   1. **REAL BUG — reviewerId orphans on member removal.** R1's
 *      `assigneeId` cleanup landed but missed the symmetric
 *      `reviewerId` case. A task in IN_REVIEW with reviewer =
 *      <departing user> would stay stuck because the reviewer slot
 *      held a user who couldn't even open the project. Fixed.
 *
 *   2. Added user got no notification — they discovered the
 *      addition by refreshing their dashboard. Fixed.
 *
 *   3. Removed user got no notification — they discovered the
 *      removal via 403 on their next request. Fixed.
 *
 *   4. Per-project role change was silently logged but the affected
 *      user got no notification. Fixed.
 *
 * Tests below pin the new behavior. The pre-existing
 * `assigneeId`-null path is also regression-locked so a future
 * refactor can't drop the R1 fix while landing this one.
 */

import './../test/prismaMock';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserRole } from '@prisma/client';
import { prismaMock } from '../test/prismaMock';

const { logActivitySpy } = vi.hoisted(() => ({
  logActivitySpy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./activity.service', () => ({
  __esModule: true,
  logActivity: logActivitySpy,
}));

// Notification helpers are the surface the audit added; mock them
// individually so each test can assert on the exact call shape.
const {
  notifyAddedToProjectSpy,
  notifyRemovedFromProjectSpy,
  notifyProjectRoleChangedSpy,
  notifyProjectPMsOfOrphanedTasksSpy,
  notifyProjectDeletedSpy,
} = vi.hoisted(() => ({
  notifyAddedToProjectSpy: vi.fn().mockResolvedValue(undefined),
  notifyRemovedFromProjectSpy: vi.fn().mockResolvedValue(undefined),
  notifyProjectRoleChangedSpy: vi.fn().mockResolvedValue(undefined),
  notifyProjectPMsOfOrphanedTasksSpy: vi.fn().mockResolvedValue(undefined),
  notifyProjectDeletedSpy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./notification.service', () => ({
  __esModule: true,
  notifyAddedToProject: notifyAddedToProjectSpy,
  notifyRemovedFromProject: notifyRemovedFromProjectSpy,
  notifyProjectRoleChanged: notifyProjectRoleChangedSpy,
  notifyProjectPMsOfOrphanedTasks: notifyProjectPMsOfOrphanedTasksSpy,
  notifyProjectDeleted: notifyProjectDeletedSpy,
}));

// rbac.service is imported by project.service for permission checks
// in other functions; we only exercise add/remove member here, which
// don't call into rbac. Stub it anyway so the import resolves.
vi.mock('./rbac.service', () => ({
  __esModule: true,
  checkPermission: vi.fn().mockResolvedValue(false),
}));

import {
  addProjectMember,
  removeProjectMember,
  setMemberFullAccess,
  deleteProject,
  listProjects,
  getProject,
  createProject,
  updateProject,
} from './project.service';
import { ConflictError, NotFoundError, ValidationError } from '../utils/errors';

beforeEach(() => {
  logActivitySpy.mockReset();
  logActivitySpy.mockResolvedValue(undefined);
  notifyAddedToProjectSpy.mockReset();
  notifyAddedToProjectSpy.mockResolvedValue(undefined);
  notifyRemovedFromProjectSpy.mockReset();
  notifyRemovedFromProjectSpy.mockResolvedValue(undefined);
  notifyProjectRoleChangedSpy.mockReset();
  notifyProjectRoleChangedSpy.mockResolvedValue(undefined);
  notifyProjectPMsOfOrphanedTasksSpy.mockReset();
  notifyProjectPMsOfOrphanedTasksSpy.mockResolvedValue(undefined);
  notifyProjectDeletedSpy.mockReset();
  notifyProjectDeletedSpy.mockResolvedValue(undefined);
  (prismaMock.$transaction as any).mockImplementation(async (fn: any) => fn(prismaMock));
});

// ─── setMemberFullAccess — per-project client full access ──────────────

describe('setMemberFullAccess', () => {
  it('updates the membership + logs activity for a CLIENT member', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue({
      id: 'pm-1',
      user: { id: 'client-1', role: UserRole.CLIENT },
    } as any);
    prismaMock.projectMember.update.mockResolvedValue({
      id: 'pm-1',
      fullAccess: true,
      user: { id: 'client-1', name: 'Furix', email: 'c@furix.com', role: UserRole.CLIENT, userType: 'HUMAN' },
    } as any);

    const result = await setMemberFullAccess('proj-1', 'client-1', true, 'admin-1');

    expect(prismaMock.projectMember.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_projectId: { userId: 'client-1', projectId: 'proj-1' } },
        data: { fullAccess: true },
      }),
    );
    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        action: 'project_member_full_access_granted',
        targetType: 'project_member',
      }),
    );
    expect((result as any).fullAccess).toBe(true);
  });

  it('logs the revoke action when fullAccess is set false', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue({
      id: 'pm-1',
      user: { id: 'client-1', role: UserRole.CLIENT },
    } as any);
    prismaMock.projectMember.update.mockResolvedValue({ id: 'pm-1', fullAccess: false } as any);

    await setMemberFullAccess('proj-1', 'client-1', false, 'admin-1');

    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'project_member_full_access_revoked' }),
    );
  });

  it('throws NotFoundError when the membership does not exist', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue(null as any);

    await expect(
      setMemberFullAccess('proj-1', 'ghost', true, 'admin-1'),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(prismaMock.projectMember.update).not.toHaveBeenCalled();
  });

  it('refuses to grant full access to a non-CLIENT member', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue({
      id: 'pm-1',
      user: { id: 'eng-1', role: UserRole.ENGINEER },
    } as any);

    await expect(
      setMemberFullAccess('proj-1', 'eng-1', true, 'admin-1'),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(prismaMock.projectMember.update).not.toHaveBeenCalled();
  });
});

// ─── addProjectMember — notification on add + role change ──────────────

describe('addProjectMember — notification wiring', () => {
  beforeEach(() => {
    prismaMock.project.findUnique.mockResolvedValue({ name: 'Indigo' } as any);
    prismaMock.user.findUnique.mockResolvedValue({ name: 'Maya' } as any);
  });

  it('NOTIFIES the added user when they\'re a new project member', async () => {
    // before === null → action = added_member
    prismaMock.projectMember.findUnique.mockResolvedValue(null as any);
    prismaMock.projectMember.upsert.mockResolvedValue({
      userId: 'new-user',
      projectId: 'proj-1',
      role: UserRole.ENGINEER,
      user: { id: 'new-user', name: 'Vikram', email: 'v@example.com' },
    } as any);

    await addProjectMember('proj-1', 'new-user', UserRole.ENGINEER, 'admin-1');

    expect(notifyAddedToProjectSpy).toHaveBeenCalledWith({
      userId: 'new-user',
      projectId: 'proj-1',
      projectName: 'Indigo',
      addedByName: 'Maya',
      memberRole: 'ENGINEER',
    });
    expect(notifyProjectRoleChangedSpy).not.toHaveBeenCalled();
  });

  it('NOTIFIES with role-change shape (not added shape) when an existing member\'s role is changed', async () => {
    prismaMock.projectMember.findUnique.mockResolvedValue({ role: UserRole.ENGINEER } as any);
    prismaMock.projectMember.upsert.mockResolvedValue({
      userId: 'eng-1',
      projectId: 'proj-1',
      role: UserRole.PRODUCT_MANAGER,
      user: { id: 'eng-1', name: 'Vikram', email: 'v@example.com' },
    } as any);

    await addProjectMember('proj-1', 'eng-1', UserRole.PRODUCT_MANAGER, 'admin-1');

    expect(notifyProjectRoleChangedSpy).toHaveBeenCalledWith({
      userId: 'eng-1',
      projectId: 'proj-1',
      projectName: 'Indigo',
      changedByName: 'Maya',
      fromRole: 'ENGINEER',
      toRole: 'PRODUCT_MANAGER',
    });
    // Different shape than 'added_member' — must NOT fire the added
    // notification, otherwise the user gets two pings for one op.
    expect(notifyAddedToProjectSpy).not.toHaveBeenCalled();
  });

  it('does NOT NOTIFY on a no-op (re-add at same role — upsert update with same data)', async () => {
    // Existing member already at this role — upsert.update is a
    // no-op write. Logging or notifying here would spam.
    prismaMock.projectMember.findUnique.mockResolvedValue({ role: UserRole.ENGINEER } as any);
    prismaMock.projectMember.upsert.mockResolvedValue({
      userId: 'eng-1',
      projectId: 'proj-1',
      role: UserRole.ENGINEER,
      user: { id: 'eng-1', name: 'Vikram', email: 'v@example.com' },
    } as any);

    await addProjectMember('proj-1', 'eng-1', UserRole.ENGINEER, 'admin-1');

    expect(notifyAddedToProjectSpy).not.toHaveBeenCalled();
    expect(notifyProjectRoleChangedSpy).not.toHaveBeenCalled();
    expect(logActivitySpy).not.toHaveBeenCalled();
  });

  it('does NOT NOTIFY when the actor adds themselves (self-skip)', async () => {
    // E.g. a SUPER_ADMIN adding themselves to a project as ADMIN to
    // pick up the per-project role. They obviously know.
    prismaMock.projectMember.findUnique.mockResolvedValue(null as any);
    prismaMock.projectMember.upsert.mockResolvedValue({
      userId: 'super-1',
      projectId: 'proj-1',
      role: UserRole.ADMIN,
      user: { id: 'super-1', name: 'Pankaj', email: 'p@example.com' },
    } as any);

    await addProjectMember('proj-1', 'super-1', UserRole.ADMIN, 'super-1');

    expect(notifyAddedToProjectSpy).not.toHaveBeenCalled();
  });

  it('does NOT BLOCK the membership change if the notification fails', async () => {
    // Operational: a notification failure (DB down, rate limit) must
    // NOT undo a membership change. The activity log already
    // committed inside the tx; the notify is fire-and-forget.
    prismaMock.projectMember.findUnique.mockResolvedValue(null as any);
    prismaMock.projectMember.upsert.mockResolvedValue({
      userId: 'new-user',
      projectId: 'proj-1',
      role: UserRole.ENGINEER,
      user: { id: 'new-user', name: 'Vikram', email: 'v@example.com' },
    } as any);
    notifyAddedToProjectSpy.mockRejectedValue(new Error('notify down'));

    await expect(
      addProjectMember('proj-1', 'new-user', UserRole.ENGINEER, 'admin-1'),
    ).resolves.toMatchObject({ userId: 'new-user', role: UserRole.ENGINEER });
  });
});

// ─── removeProjectMember — reviewerId orphan fix + notify ──────────────

describe('removeProjectMember — orphan cleanup (assignee + reviewer) + notify', () => {
  beforeEach(() => {
    prismaMock.project.findUnique.mockResolvedValue({ name: 'Indigo' } as any);
    prismaMock.user.findUnique.mockResolvedValue({ name: 'Maya' } as any);
    // 2026-05-23 audit fix: removeProjectMember now also deletes
    // TaskSubscription rows for the leaving user's tasks in this
    // project. Default the mock to "0 dropped" so existing tests
    // that don't care about subscriptions still pass; the new
    // subscription-cleanup test overrides this per-case.
    prismaMock.taskSubscription.deleteMany.mockResolvedValue({ count: 0 } as any);
  });

  /**
   * THE REAL BUG REGRESSION. Pre-fix this scenario left Task t-rev
   * with reviewerId = 'leaving-user' forever — Maya (the assignee)
   * couldn't progress the review because the reviewer slot was held
   * by someone who couldn't even open the project. Admin had to
   * manually clear it.
   */
  it('CLEARS reviewerId on every task the leaving member was reviewing (R1-parallel fix)', async () => {
    // No assignee orphans — only reviewer orphans, to isolate the
    // new path from the existing assigneeId path.
    prismaMock.task.findMany
      .mockResolvedValueOnce([] as any)  // assignee orphan query → none
      .mockResolvedValueOnce([           // reviewer orphan query → 2 tasks
        { id: 't-rev-1' },
        { id: 't-rev-2' },
      ] as any);
    prismaMock.task.updateMany.mockResolvedValue({ count: 2 } as any);

    await removeProjectMember('proj-1', 'leaving-user', 'admin-1');

    // The CRITICAL assertion: a task.updateMany call MUST fire to
    // null out reviewerId for the 2 tasks.
    const updateManyCalls = prismaMock.task.updateMany.mock.calls;
    const reviewerNullCall = updateManyCalls.find(
      (call: any) => call[0]?.where?.reviewerId === 'leaving-user',
    );
    expect(reviewerNullCall).toBeDefined();
    expect(reviewerNullCall?.[0]).toMatchObject({
      where: { projectId: 'proj-1', reviewerId: 'leaving-user' },
      data: { reviewerId: null },
    });

    // Audit log records the reviewer-orphan count + task IDs.
    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'removed_member',
        details: expect.objectContaining({
          unreviewerTaskCount: 2,
          unreviewerTaskIds: ['t-rev-1', 't-rev-2'],
        }),
      }),
      expect.anything(),
    );
  });

  it('STILL clears assigneeId on tasks (R1 regression-pin — pre-existing fix not lost)', async () => {
    prismaMock.task.findMany
      .mockResolvedValueOnce([{ id: 't-asg-1' }, { id: 't-asg-2' }] as any) // assignee
      .mockResolvedValueOnce([] as any);                                     // reviewer

    await removeProjectMember('proj-1', 'leaving-user', 'admin-1');

    const updateManyCalls = prismaMock.task.updateMany.mock.calls;
    const assigneeNullCall = updateManyCalls.find(
      (call: any) => call[0]?.where?.assigneeId === 'leaving-user',
    );
    expect(assigneeNullCall?.[0]).toMatchObject({
      where: { projectId: 'proj-1', assigneeId: 'leaving-user' },
      data: { assigneeId: null },
    });

    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'removed_member',
        details: expect.objectContaining({
          unassignedTaskCount: 2,
          unassignedTaskIds: ['t-asg-1', 't-asg-2'],
        }),
      }),
      expect.anything(),
    );
  });

  it('clears BOTH assigneeId AND reviewerId when the leaving user wore both hats on different tasks', async () => {
    // The audit-log details should carry BOTH the unassigned and
    // unreviewer counts.
    prismaMock.task.findMany
      .mockResolvedValueOnce([{ id: 't-asg-1' }] as any)
      .mockResolvedValueOnce([{ id: 't-rev-1' }, { id: 't-rev-2' }] as any);

    await removeProjectMember('proj-1', 'leaving-user', 'admin-1');

    const logCall = logActivitySpy.mock.calls[0]?.[0] as any;
    expect(logCall.details).toMatchObject({
      unassignedTaskCount: 1,
      unassignedTaskIds: ['t-asg-1'],
      unreviewerTaskCount: 2,
      unreviewerTaskIds: ['t-rev-1', 't-rev-2'],
    });
  });

  it('NOTIFIES the removed user (added by 2026-05-15 audit)', async () => {
    prismaMock.task.findMany.mockResolvedValue([] as any);

    await removeProjectMember('proj-1', 'leaving-user', 'admin-1');

    expect(notifyRemovedFromProjectSpy).toHaveBeenCalledWith({
      userId: 'leaving-user',
      projectId: 'proj-1',
      projectName: 'Indigo',
      removedByName: 'Maya',
    });
  });

  it('does NOT NOTIFY when a user removes themselves (voluntary leave — they know)', async () => {
    prismaMock.task.findMany.mockResolvedValue([] as any);

    await removeProjectMember('proj-1', 'self-user', 'self-user');

    expect(notifyRemovedFromProjectSpy).not.toHaveBeenCalled();
  });

  it('logs `removed_member` without details when there were no orphans (no count clutter)', async () => {
    prismaMock.task.findMany.mockResolvedValue([] as any);

    await removeProjectMember('proj-1', 'clean-departure', 'admin-1');

    const logCall = logActivitySpy.mock.calls[0]?.[0] as any;
    expect(logCall.action).toBe('removed_member');
    expect(logCall.details).toBeUndefined();
  });

  it('does NOT BLOCK the removal if the notification fails (fire-and-forget)', async () => {
    prismaMock.task.findMany.mockResolvedValue([] as any);
    notifyRemovedFromProjectSpy.mockRejectedValue(new Error('notify down'));

    await expect(
      removeProjectMember('proj-1', 'leaving-user', 'admin-1'),
    ).resolves.toBeUndefined();
    expect(prismaMock.projectMember.delete).toHaveBeenCalled();
  });

  // ── PM-orphan-notify follow-up (this PR commit 2) ────────────────

  it('NOTIFIES the project PMs when there are unassigned tasks (orphan-PM signal)', async () => {
    // Leaving user had 3 task assignees, no reviewer responsibilities.
    prismaMock.task.findMany
      .mockResolvedValueOnce([{ id: 't-asg-1' }, { id: 't-asg-2' }, { id: 't-asg-3' }] as any)
      .mockResolvedValueOnce([] as any);
    // user.findUnique fires twice: once for the actor's name (in
    // the post-tx notifyRemovedFromProject path), once for the
    // leaving user's name (captured inside the tx for the PM
    // ping). The order is `actor first` because the
    // notifyRemovedFromProject branch fires before the orphan
    // notify in code.
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ name: 'Vikram' } as any)  // leaving user (inside tx)
      .mockResolvedValueOnce({ name: 'Maya' } as any);    // actor (post-tx)

    await removeProjectMember('proj-1', 'leaving-user', 'admin-1');

    expect(notifyProjectPMsOfOrphanedTasksSpy).toHaveBeenCalledWith({
      projectId: 'proj-1',
      projectName: 'Indigo',
      leavingUserName: 'Vikram',
      unassignedCount: 3,
      unreviewerCount: 0,
    });
  });

  it('NOTIFIES the PMs with BOTH counts when the leaving user was both an assignee AND a reviewer', async () => {
    prismaMock.task.findMany
      .mockResolvedValueOnce([{ id: 't-asg-1' }] as any)
      .mockResolvedValueOnce([{ id: 't-rev-1' }, { id: 't-rev-2' }] as any);
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ name: 'Vikram' } as any)
      .mockResolvedValueOnce({ name: 'Maya' } as any);

    await removeProjectMember('proj-1', 'leaving-user', 'admin-1');

    expect(notifyProjectPMsOfOrphanedTasksSpy).toHaveBeenCalledWith({
      projectId: 'proj-1',
      projectName: 'Indigo',
      leavingUserName: 'Vikram',
      unassignedCount: 1,
      unreviewerCount: 2,
    });
  });

  it('does NOT NOTIFY PMs when there are zero orphaned tasks (clean departure — no noise)', async () => {
    prismaMock.task.findMany.mockResolvedValue([] as any);

    await removeProjectMember('proj-1', 'clean-leaver', 'admin-1');

    expect(notifyProjectPMsOfOrphanedTasksSpy).not.toHaveBeenCalled();
  });

  it('NOTIFIES PMs even when the leaving user removed THEMSELVES (orphan signal stands regardless of who triggered the removal)', async () => {
    // Self-leave: the removed user doesn't need notifyRemovedFromProject
    // (they know they left), but PMs STILL need to know they have
    // orphaned tasks to re-assign.
    prismaMock.task.findMany
      .mockResolvedValueOnce([{ id: 't-asg-1' }] as any)
      .mockResolvedValueOnce([] as any);
    prismaMock.user.findUnique
      .mockResolvedValueOnce({ name: 'Vikram' } as any);

    await removeProjectMember('proj-1', 'self-user', 'self-user');

    // notifyRemovedFromProject skipped (self-leave).
    expect(notifyRemovedFromProjectSpy).not.toHaveBeenCalled();
    // PMs STILL notified — orphans are orphans.
    expect(notifyProjectPMsOfOrphanedTasksSpy).toHaveBeenCalled();
  });
});

// ─── deleteProject — billing-safety gate + member notification ─────────
//     (2026-05-15 project-delete audit)

describe('deleteProject — notify members (Bug C)', () => {
  beforeEach(() => {
    prismaMock.project.findUnique.mockResolvedValue({
      id: 'proj-1',
      name: 'Acme Corp',
    } as any);
    prismaMock.user.findUnique.mockResolvedValue({ name: 'Pankaj' } as any);
  });

  it('THROWS NotFoundError when the project does not exist (regression-pin)', async () => {
    prismaMock.project.findUnique.mockResolvedValue(null as any);

    await expect(deleteProject('p-gone', 'admin-1')).rejects.toBeInstanceOf(NotFoundError);
    expect(prismaMock.project.delete).not.toHaveBeenCalled();
  });

  it('PROCEEDS with delete + notification', async () => {
    prismaMock.projectMember.findMany.mockResolvedValue([
      { userId: 'member-1' },
      { userId: 'member-2' },
    ] as any);

    await deleteProject('proj-1', 'admin-1');

    expect(prismaMock.project.delete).toHaveBeenCalledWith({ where: { id: 'proj-1' } });
    expect(notifyProjectDeletedSpy).toHaveBeenCalledWith({
      projectName: 'Acme Corp',
      deletedBy: 'admin-1',
      deletedByName: 'Pankaj',
      memberIds: ['member-1', 'member-2'],
    });
  });

  it('writes the deleted_project activity row WITHOUT setting projectId (so it survives the cascade)', async () => {
    prismaMock.projectMember.findMany.mockResolvedValue([] as any);

    await deleteProject('proj-1', 'admin-1');

    // The activity row must NOT carry projectId — otherwise the
    // cascade would delete it along with everything else. The
    // org-level row (projectId=null) survives.
    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'deleted_project',
        targetType: 'project',
        targetId: 'proj-1',
        details: expect.objectContaining({ name: 'Acme Corp' }),
      }),
      expect.anything(), // tx client
    );
    const logCall = logActivitySpy.mock.calls[0]?.[0] as any;
    // Defensive: projectId field should be undefined on this org-
    // level event. If a future refactor adds projectId here, the
    // cascade will eat the audit row.
    expect(logCall.projectId).toBeUndefined();
  });

  it('SKIPS the notification fan-out when the project has no members', async () => {
    prismaMock.projectMember.findMany.mockResolvedValue([] as any);

    await deleteProject('proj-1', 'admin-1');

    expect(prismaMock.project.delete).toHaveBeenCalled();
    expect(notifyProjectDeletedSpy).not.toHaveBeenCalled();
  });

  it('does NOT BLOCK the delete on notification failure (fire-and-forget)', async () => {
    prismaMock.projectMember.findMany.mockResolvedValue([{ userId: 'member-1' }] as any);
    notifyProjectDeletedSpy.mockRejectedValue(new Error('notify down'));

    await expect(deleteProject('proj-1', 'admin-1')).resolves.toBeUndefined();
    expect(prismaMock.project.delete).toHaveBeenCalled();
  });

  it('captures memberIds BEFORE the delete (pre-cascade snapshot)', async () => {
    // Verify the projectMember.findMany call happens BEFORE
    // prisma.project.delete — otherwise the cascade would have
    // already destroyed the ProjectMember rows by the time we look.
    prismaMock.projectMember.findMany.mockResolvedValue([{ userId: 'member-1' }] as any);

    await deleteProject('proj-1', 'admin-1');

    const findManyCallOrder = prismaMock.projectMember.findMany.mock.invocationCallOrder[0];
    const deleteCallOrder = prismaMock.project.delete.mock.invocationCallOrder[0];
    expect(findManyCallOrder).toBeLessThan(deleteCallOrder);
  });
});

// ─── 2026-05-21 optimistic-locking expansion (PR #128 pattern → Project) ─

describe('updateProject — optimistic locking', () => {
  const SERVER_UPDATED_AT = new Date('2026-05-21T10:00:00.000Z');

  // updateProject ends by calling `getProject(id)` which does its
  // own findUnique with includes. Provide a generic baseline so the
  // post-write return doesn't trip NotFoundError. Individual tests
  // mockResolvedValueOnce to override for the early-exit fetch.
  const HYDRATED_PROJECT = {
    id: 'p1',
    name: 'New',
    phase: 'DEVELOPMENT',
    healthStatus: 'GREEN',
    members: [],
    _count: { tasks: 0 },
  };

  beforeEach(() => {
    (prismaMock.$transaction as any).mockImplementation(async (fn: any) => fn(prismaMock));
    prismaMock.project.findUnique.mockResolvedValue(HYDRATED_PROJECT as any);
  });

  it('writes through unchanged when expectedUpdatedAt is omitted (backwards compat)', async () => {
    const { updateProject } = await import('./project.service');
    prismaMock.project.findUnique.mockResolvedValueOnce({
      id: 'p1', updatedAt: SERVER_UPDATED_AT, phase: 'DEVELOPMENT', healthStatus: 'GREEN',
    } as any);
    prismaMock.project.findUniqueOrThrow.mockResolvedValue({ id: 'p1', name: 'New' } as any);

    await updateProject('p1', { name: 'New' }, 'u1');

    expect(prismaMock.project.update).toHaveBeenCalled();
    expect(prismaMock.project.updateMany).not.toHaveBeenCalled();
  });

  it('uses updateMany when expectedUpdatedAt matches', async () => {
    const { updateProject } = await import('./project.service');
    prismaMock.project.findUnique.mockResolvedValueOnce({
      id: 'p1', updatedAt: SERVER_UPDATED_AT, phase: 'DEVELOPMENT', healthStatus: 'GREEN',
    } as any);
    prismaMock.project.updateMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.project.findUniqueOrThrow.mockResolvedValue({ id: 'p1', name: 'New' } as any);

    await updateProject('p1', { name: 'New' }, 'u1', SERVER_UPDATED_AT.toISOString());

    const args = (prismaMock.project.updateMany as any).mock.calls[0]?.[0];
    expect(args.where).toEqual({ id: 'p1', updatedAt: SERVER_UPDATED_AT });
  });

  it('throws ConflictError at the early check when expectedUpdatedAt is stale', async () => {
    const { updateProject } = await import('./project.service');
    prismaMock.project.findUnique.mockResolvedValueOnce({
      id: 'p1', updatedAt: SERVER_UPDATED_AT, phase: 'DEVELOPMENT', healthStatus: 'GREEN',
    } as any);

    await expect(
      updateProject('p1', { name: 'New' }, 'u1', new Date('2026-05-21T09:00:00.000Z').toISOString()),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(prismaMock.project.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.project.update).not.toHaveBeenCalled();
  });
});

// ─── 2026-05-21 coverage expansion: untested read + create + update paths ─

describe('listProjects — role-based filtering', () => {
  beforeEach(() => {
    (prismaMock.project.findMany as any).mockResolvedValue([]);
    (prismaMock.task.groupBy as any).mockResolvedValue([]);
  });

  it('does NOT scope by membership when the caller has project.view_all (admin)', async () => {
    const checkPermission = (await import('./rbac.service')).checkPermission as any;
    checkPermission.mockResolvedValueOnce(true);

    await listProjects({ userId: 'admin-1', role: UserRole.SUPER_ADMIN });

    const where = (prismaMock.project.findMany as any).mock.calls[0][0].where;
    // Critical: admins must see ALL projects, including ones they
    // aren't members of (the "view across the org" case).
    expect(where).not.toHaveProperty('members');
  });

  it('scopes by membership when the caller does NOT have project.view_all', async () => {
    const checkPermission = (await import('./rbac.service')).checkPermission as any;
    checkPermission.mockResolvedValueOnce(false);

    await listProjects({ userId: 'eng-1', role: UserRole.ENGINEER });

    const where = (prismaMock.project.findMany as any).mock.calls[0][0].where;
    // Engineers only see projects they're members of — critical for
    // client/internal isolation.
    expect(where.members).toEqual({ some: { userId: 'eng-1' } });
  });

  it('search uses case-insensitive `contains` on name (not exact match)', async () => {
    const checkPermission = (await import('./rbac.service')).checkPermission as any;
    checkPermission.mockResolvedValueOnce(true);

    await listProjects({ userId: 'admin-1', role: UserRole.SUPER_ADMIN, search: 'roz' });

    const where = (prismaMock.project.findMany as any).mock.calls[0][0].where;
    expect(where.name).toEqual({ contains: 'roz', mode: 'insensitive' });
  });

  it('builds taskCounts using ONLY two groupBy queries (not N+1)', async () => {
    // QA-perf gate: a previous version of this function fired
    // `task.findMany` once per project. The fix consolidates into 2
    // groupBy calls regardless of project count. Pin that here so a
    // future refactor doesn't silently regress to N+1.
    const checkPermission = (await import('./rbac.service')).checkPermission as any;
    checkPermission.mockResolvedValueOnce(true);
    (prismaMock.project.findMany as any).mockResolvedValueOnce([
      { id: 'p1', name: 'A' },
      { id: 'p2', name: 'B' },
      { id: 'p3', name: 'C' },
    ]);

    await listProjects({ userId: 'admin-1', role: UserRole.SUPER_ADMIN });

    // Exactly TWO groupBy calls — one for status, one for blocked.
    expect((prismaMock.task.groupBy as any).mock.calls.length).toBe(2);
  });
});

describe('getProject', () => {
  it('returns the project when found', async () => {
    prismaMock.project.findUnique.mockResolvedValue({
      id: 'p1', name: 'Test',
    } as any);

    const result = await getProject('p1');
    expect(result).toMatchObject({ id: 'p1', name: 'Test' });
  });

  it('throws NotFoundError when the project does not exist', async () => {
    prismaMock.project.findUnique.mockResolvedValue(null);
    await expect(getProject('gone')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('createProject — duplicate-name guard', () => {
  beforeEach(() => {
    prismaMock.project.findFirst.mockResolvedValue(null);
    prismaMock.project.findUnique.mockImplementation((async ({ where }: any) => {
      // ensureUniqueSlug's check — return null so the slug is taken as-is.
      // BUT getProject() at the end also calls findUnique — return a fake
      // record for that case.
      if (where.slug) return null;
      if (where.id) return { id: where.id, name: 'X', members: [] } as any;
      return null;
    }) as any);
    prismaMock.user.findUnique.mockResolvedValue({ role: 'ENGINEER' } as any);
    prismaMock.project.create.mockResolvedValue({ id: 'new', name: 'X' } as any);
    (prismaMock.projectMember.createMany as any).mockResolvedValue({ count: 0 });
  });

  it('refuses the create when a project with the same name (case-insensitive) exists', async () => {
    prismaMock.project.findFirst.mockResolvedValueOnce({ id: 'existing' } as any);

    await expect(
      createProject({ name: 'BountiPOS' }, 'creator-1'),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(prismaMock.project.create).not.toHaveBeenCalled();
  });

  it('runs the dup-check against the TRIMMED name (whitespace-trimmed equality)', async () => {
    // Sanity: the dup-check shouldn't be tripped by trailing spaces in
    // the input — trimming the input before comparing means "  Foo"
    // and "Foo" both probe the DB for "Foo".
    await createProject({ name: '   BountiPOS   ' }, 'creator-1');

    const firstCallWhere = (prismaMock.project.findFirst as any).mock.calls[0][0].where;
    expect(firstCallWhere.name.equals).toBe('BountiPOS');
    expect(firstCallWhere.name.mode).toBe('insensitive');
  });

  it('persists the TRIMMED name (BUG: pre-fix, surrounding whitespace was preserved)', async () => {
    // Pre-fix bug repro. The dup-check used the trimmed name but the
    // CREATE used data.name verbatim. So a user submitting "  Foo  "
    // got the dup-check vs "Foo" (correct), but the row was created
    // with the spaces preserved. A subsequent create of "Foo" would
    // then NOT match the stored "  Foo  " row (case-insensitive
    // equals doesn't ignore whitespace) and a duplicate would slip in.
    await createProject({ name: '   BountiPOS   ' }, 'creator-1');

    const createArgs = (prismaMock.project.create as any).mock.calls[0][0];
    expect(createArgs.data.name).toBe('BountiPOS');
  });
});

describe('createProject — creator membership + activity log', () => {
  beforeEach(() => {
    prismaMock.project.findFirst.mockResolvedValue(null);
    prismaMock.project.findUnique.mockImplementation((async ({ where }: any) => {
      if (where.slug) return null;
      if (where.id) return { id: where.id, name: 'X', members: [] } as any;
      return null;
    }) as any);
    prismaMock.user.findUnique.mockResolvedValue({ role: 'PRODUCT_MANAGER' } as any);
    prismaMock.project.create.mockResolvedValue({ id: 'new', name: 'X' } as any);
    (prismaMock.projectMember.createMany as any).mockResolvedValue({ count: 0 });
  });

  it('auto-adds the creator as a project member with their global role', async () => {
    await createProject({ name: 'Furix AI' }, 'creator-1');

    const createManyArgs = (prismaMock.projectMember.createMany as any).mock.calls[0][0];
    const creatorEntry = createManyArgs.data.find((m: any) => m.userId === 'creator-1');
    expect(creatorEntry).toBeDefined();
    expect(creatorEntry.role).toBe('PRODUCT_MANAGER');
  });

  it('merges explicit memberIds with the auto-added creator (no duplicate creator entry)', async () => {
    await createProject(
      { name: 'Furix AI', memberIds: [{ userId: 'eng-2', role: 'ENGINEER' }] },
      'creator-1',
    );

    const createManyArgs = (prismaMock.projectMember.createMany as any).mock.calls[0][0];
    const userIds = createManyArgs.data.map((m: any) => m.userId).sort();
    // Map dedupes by userId, so creator-1 appears once even if also in memberIds.
    expect(userIds).toEqual(['creator-1', 'eng-2']);
  });

  it('explicit memberIds.role for the creator OVERRIDES the auto-added global role', async () => {
    // The Map.set order means later writes win — explicit memberIds
    // overwrite the creator's auto-added role. This is the right
    // policy: an admin creating on behalf of someone else can pin
    // them to a project-specific role distinct from their global one.
    await createProject(
      {
        name: 'Furix AI',
        memberIds: [{ userId: 'creator-1', role: 'ADMIN' }],
      },
      'creator-1',
    );

    const createManyArgs = (prismaMock.projectMember.createMany as any).mock.calls[0][0];
    const creatorEntry = createManyArgs.data.find((m: any) => m.userId === 'creator-1');
    expect(creatorEntry.role).toBe('ADMIN');
  });

  it('writes a created_project activity row', async () => {
    await createProject({ name: 'Furix AI' }, 'creator-1');

    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'created_project',
        userId: 'creator-1',
        targetType: 'project',
      }),
    );
  });

  it('normalizes startDate / targetDate strings to Date instances', async () => {
    await createProject(
      { name: 'Furix AI', startDate: '2026-06-01', targetDate: '2026-12-31' },
      'creator-1',
    );

    const createArgs = (prismaMock.project.create as any).mock.calls[0][0];
    expect(createArgs.data.startDate).toBeInstanceOf(Date);
    expect(createArgs.data.targetDate).toBeInstanceOf(Date);
  });
});

describe('updateProject — phase + health change audit logs', () => {
  beforeEach(() => {
    const project = {
      id: 'p1',
      name: 'Furix',
      phase: 'ARCHITECTURE',
      healthStatus: 'GREEN',
      updatedAt: new Date('2026-05-21T10:00:00.000Z'),
    };
    prismaMock.project.findUnique.mockImplementation((async ({ where }: any) => {
      if (where.id === 'p1') {
        return {
          ...project,
          members: [],
          _count: { tasks: 0 },
        } as any;
      }
      return null;
    }) as any);
    prismaMock.project.update.mockResolvedValue(project as any);
    // PR #137 added findUniqueOrThrow inside the tx (post-write
    // re-fetch). Stub it so the chain doesn't crash on undefined.
    (prismaMock.project.findUniqueOrThrow as any).mockResolvedValue(project);
    (prismaMock.$transaction as any).mockImplementation(async (fn: any) => fn(prismaMock));
  });

  it('writes a changed_phase activity row when phase actually changes', async () => {
    await updateProject('p1', { phase: 'DEVELOPMENT' }, 'u1');

    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'changed_phase',
        details: { from: 'ARCHITECTURE', to: 'DEVELOPMENT' },
      }),
      expect.anything(),
    );
  });

  it('does NOT write changed_phase when the phase is unchanged (no-op patch)', async () => {
    await updateProject('p1', { phase: 'ARCHITECTURE' }, 'u1');

    const phaseCall = logActivitySpy.mock.calls.find(
      (c) => (c[0] as any).action === 'changed_phase',
    );
    expect(phaseCall).toBeUndefined();
  });

  it('writes a set_health activity row when healthStatus actually changes', async () => {
    await updateProject('p1', { healthStatus: 'YELLOW' }, 'u1');

    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'set_health',
        details: { from: 'GREEN', to: 'YELLOW' },
      }),
      expect.anything(),
    );
  });

  it('rewrites project members when memberIds is provided', async () => {
    await updateProject(
      'p1',
      { memberIds: [{ userId: 'u2', role: 'ENGINEER' }] },
      'u1',
    );

    // Member rewrite = deleteMany existing + createMany new.
    expect(prismaMock.projectMember.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
    expect(prismaMock.projectMember.createMany).toHaveBeenCalled();
  });

  it('does NOT touch members when memberIds is OMITTED (vs sent as empty array)', async () => {
    // Distinction matters: omitting memberIds is "I don't want to
    // change membership"; sending [] is "remove all members". The
    // service must respect the difference. Pre-fix attention to
    // this gap.
    await updateProject('p1', { name: 'New name only' }, 'u1');

    expect(prismaMock.projectMember.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.projectMember.createMany).not.toHaveBeenCalled();
  });

  it('REMOVES ALL members when memberIds is an empty array', async () => {
    // The complementary case to the test above.
    await updateProject('p1', { memberIds: [] }, 'u1');

    expect(prismaMock.projectMember.deleteMany).toHaveBeenCalledWith({ where: { projectId: 'p1' } });
    // createMany should NOT be called when there's nothing to create.
    expect(prismaMock.projectMember.createMany).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the project does not exist', async () => {
    prismaMock.project.findUnique.mockResolvedValueOnce(null);

    await expect(updateProject('gone', { name: 'X' }, 'u1')).rejects.toBeInstanceOf(NotFoundError);
  });
});
