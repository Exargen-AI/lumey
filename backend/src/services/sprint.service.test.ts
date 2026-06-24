/**
 * 2026-05-15 SPRINT-LIFECYCLE-AUDIT.
 *
 * One real data-integrity bug + two functional gaps:
 *
 *   1. **REAL BUG — `startSprint` allowed reactivating COMPLETED /
 *      CANCELLED sprints.** Pre-fix the function only checked "no
 *      other sprint is active in this project" — it never looked
 *      at the source sprint's own status. A PM clicking "Start" on
 *      a COMPLETED sprint flipped its status back to ACTIVE,
 *      corrupting historical burnup, velocity, and retro stats.
 *      Fixed: only `PLANNING → ACTIVE` is legal; `ACTIVE → ACTIVE`
 *      is idempotent; COMPLETED / CANCELLED throw with a message
 *      telling the user how to proceed.
 *
 *   2. **Gap — `startSprint` fired no audit log + no notification.**
 *      `completeSprint` wrote `completed_sprint` + retro stats but
 *      `startSprint` was silent. Engineers had to refresh to see
 *      which sprint was active. Fixed: pass userId through the
 *      handler → service → write `started_sprint` activity row +
 *      fan out a `sprint_started` notification to every project
 *      member except the starter.
 *
 *   3. **Gap — `completeSprint` fired no notification.** The
 *      activity row was written but project members got no signal,
 *      and assignees of carried-over tasks didn't know their task
 *      moved. Fixed: `sprint_completed` fan-out + per-task
 *      `task_carried_over` ping to each carried task's assignee
 *      (self-skip on completer).
 *
 * Tests below pin the new behavior and regression-lock the
 * race-safe Serializable activation + the pre-existing "no two
 * active sprints" invariant.
 */

import './../test/prismaMock';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import { ConflictError, NotFoundError } from '../utils/errors';

const { logActivitySpy } = vi.hoisted(() => ({
  logActivitySpy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./activity.service', () => ({
  __esModule: true,
  logActivity: logActivitySpy,
}));

const {
  notifySprintStartedSpy,
  notifySprintCompletedSpy,
  notifyTaskCarriedOverSpy,
} = vi.hoisted(() => ({
  notifySprintStartedSpy: vi.fn().mockResolvedValue(undefined),
  notifySprintCompletedSpy: vi.fn().mockResolvedValue(undefined),
  notifyTaskCarriedOverSpy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./notification.service', () => ({
  __esModule: true,
  notifySprintStarted: notifySprintStartedSpy,
  notifySprintCompleted: notifySprintCompletedSpy,
  notifyTaskCarriedOver: notifyTaskCarriedOverSpy,
}));

// rbac.service: `getProjectSprints` gates its per-sprint task counts on
// canViewProjectInternal; `assignTaskToSprint` uses checkPermission.
const { canViewInternalSpy } = vi.hoisted(() => ({
  canViewInternalSpy: vi.fn().mockResolvedValue(false),
}));
vi.mock('./rbac.service', () => ({
  __esModule: true,
  checkPermission: vi.fn().mockResolvedValue(false),
  canViewProjectInternal: canViewInternalSpy,
}));

import { startSprint, completeSprint, updateSprint, getProjectSprints } from './sprint.service';

beforeEach(() => {
  logActivitySpy.mockReset();
  logActivitySpy.mockResolvedValue(undefined);
  notifySprintStartedSpy.mockReset();
  notifySprintStartedSpy.mockResolvedValue(undefined);
  notifySprintCompletedSpy.mockReset();
  notifySprintCompletedSpy.mockResolvedValue(undefined);
  notifyTaskCarriedOverSpy.mockReset();
  notifyTaskCarriedOverSpy.mockResolvedValue(undefined);
  // pass-through transaction so the inside-tx mocks run against the
  // same prismaMock client.
  (prismaMock.$transaction as any).mockImplementation(
    async (fn: any, _opts?: any) => fn(prismaMock),
  );
});

// ─── getProjectSprints — per-project visibility gate ────────────────────
// The client portal's all-sprints list reads this. A regular client must
// not have internal (clientVisible=false) tasks inflating sprint progress;
// staff + full-access CLIENT members see the full set. Same gate as
// listTasks / milestones / current-sprint.

describe('getProjectSprints — visibility gate', () => {
  beforeEach(() => {
    canViewInternalSpy.mockReset();
    canViewInternalSpy.mockResolvedValue(false);
  });

  it('counts only clientVisible tasks for a viewer without internal access', async () => {
    canViewInternalSpy.mockResolvedValue(false);
    prismaMock.sprint.findMany.mockResolvedValue([] as any);

    await getProjectSprints('proj-1', { id: 'client-1', role: 'CLIENT' } as any);

    expect(canViewInternalSpy).toHaveBeenCalledWith({ id: 'client-1', role: 'CLIENT' }, 'proj-1');
    const args = prismaMock.sprint.findMany.mock.calls[0]?.[0] as any;
    expect(args.include.tasks.where).toEqual({ clientVisible: true });
  });

  it('counts the full task set for a viewer WITH internal access (staff / full-access client)', async () => {
    canViewInternalSpy.mockResolvedValue(true);
    prismaMock.sprint.findMany.mockResolvedValue([] as any);

    await getProjectSprints('proj-1', { id: 'admin-1', role: 'ADMIN' } as any);

    const args = prismaMock.sprint.findMany.mock.calls[0]?.[0] as any;
    expect(args.include.tasks.where).toBeUndefined();
  });

  it('mirrors the gated task total into _count so a client cannot read internal totals off the rollup', async () => {
    canViewInternalSpy.mockResolvedValue(false);
    prismaMock.sprint.findMany.mockResolvedValue([
      {
        id: 's1', projectId: 'proj-1', number: 1, name: 'S1', goal: null,
        status: 'ACTIVE', startDate: new Date('2026-01-01'), endDate: new Date('2026-01-14'),
        // Prisma already applied the clientVisible filter, so this is the
        // gated set (2 visible tasks). _count must reflect THIS, not the full
        // sprint size.
        tasks: [
          { status: 'DONE', storyPoints: 3, createdAt: new Date('2026-01-02') },
          { status: 'TODO', storyPoints: 2, createdAt: new Date('2026-01-03') },
        ],
      },
    ] as any);

    const result = await getProjectSprints('proj-1', { id: 'client-1', role: 'CLIENT' } as any);

    expect(result[0]!._count).toEqual({ tasks: 2 });
    expect(result[0]!.totalTasks).toBe(2);
    expect(result[0]!.doneTasks).toBe(1);
    expect(result[0]!.totalPoints).toBe(5);
    expect(result[0]!.donePoints).toBe(3);
  });
});

// ─── startSprint — source-status validation (Bug 1) ─────────────────────

describe('startSprint — source-sprint status gate (the bug)', () => {
  it('PROCEEDS for a PLANNING sprint (legal transition)', async () => {
    prismaMock.sprint.findUnique.mockResolvedValue({
      id: 's1', status: 'PLANNING', name: 'Sprint 4', projectId: 'proj-1',
    } as any);
    prismaMock.sprint.findFirst.mockResolvedValue(null as any); // no other active
    prismaMock.sprint.update.mockResolvedValue({ id: 's1', status: 'ACTIVE' } as any);

    const result = await startSprint('s1', 'proj-1', 'user-1');

    expect(prismaMock.sprint.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { status: 'ACTIVE' },
    });
    expect(result).toMatchObject({ id: 's1', status: 'ACTIVE' });
  });

  it('THROWS ConflictError when the source sprint is COMPLETED (the regression — historical corruption fix)', async () => {
    // The pivotal bug repro. Pre-fix: this call SUCCEEDED and the
    // sprint's status flipped from COMPLETED back to ACTIVE,
    // corrupting velocity + burnup + retro stats.
    prismaMock.sprint.findUnique.mockResolvedValue({
      id: 's-done', status: 'COMPLETED', name: 'Sprint 3', projectId: 'proj-1',
    } as any);

    await expect(startSprint('s-done', 'proj-1', 'user-1')).rejects.toBeInstanceOf(ConflictError);
    expect(prismaMock.sprint.update).not.toHaveBeenCalled();
    expect(logActivitySpy).not.toHaveBeenCalled();
    expect(notifySprintStartedSpy).not.toHaveBeenCalled();
  });

  it('THROWS ConflictError when the source sprint is CANCELLED', async () => {
    prismaMock.sprint.findUnique.mockResolvedValue({
      id: 's-cancelled', status: 'CANCELLED', name: 'Sprint 2', projectId: 'proj-1',
    } as any);

    await expect(startSprint('s-cancelled', 'proj-1', 'user-1')).rejects.toBeInstanceOf(ConflictError);
    expect(prismaMock.sprint.update).not.toHaveBeenCalled();
  });

  it('IS IDEMPOTENT for ACTIVE sprints (no error, no re-notify, no second audit row)', async () => {
    // Two clients double-clicking "Start" within the same window
    // shouldn't get an error. The second click sees ACTIVE and
    // short-circuits — returning the sprint without writing
    // anything OR re-pinging the team.
    prismaMock.sprint.findUnique.mockResolvedValue({
      id: 's-active', status: 'ACTIVE', name: 'Sprint 4', projectId: 'proj-1',
    } as any);

    await startSprint('s-active', 'proj-1', 'user-1');

    expect(prismaMock.sprint.update).not.toHaveBeenCalled();
    expect(logActivitySpy).not.toHaveBeenCalled();
    expect(notifySprintStartedSpy).not.toHaveBeenCalled();
  });

  it('THROWS NotFoundError when the sprintId does not exist', async () => {
    prismaMock.sprint.findUnique.mockResolvedValue(null as any);

    await expect(startSprint('s-gone', 'proj-1', 'user-1')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('THROWS ConflictError when the sprint exists but belongs to a DIFFERENT project (forged URL guard)', async () => {
    // Defense-in-depth: the route's projectScopedResourceAccess
    // middleware already verifies the sprint-project link, but if a
    // route is ever wired up that bypasses it, the service refuses.
    prismaMock.sprint.findUnique.mockResolvedValue({
      id: 's1', status: 'PLANNING', name: 'Sprint 4', projectId: 'proj-OTHER',
    } as any);

    await expect(startSprint('s1', 'proj-1', 'user-1')).rejects.toBeInstanceOf(ConflictError);
  });
});

// ─── startSprint — race-safe "no two active sprints" regression-pin ─────

describe('startSprint — pre-existing "another sprint already active" guard (regression-pin)', () => {
  it('THROWS ConflictError when another sprint in the same project is already ACTIVE', async () => {
    // QA finding #13 from the original code. Two concurrent
    // startSprint calls in the same project must not both succeed.
    // The Serializable transaction ensures the second call sees
    // the first's write.
    prismaMock.sprint.findUnique.mockResolvedValue({
      id: 's-new', status: 'PLANNING', name: 'Sprint 5', projectId: 'proj-1',
    } as any);
    prismaMock.sprint.findFirst.mockResolvedValue({ id: 's-old-active' } as any);

    await expect(startSprint('s-new', 'proj-1', 'user-1')).rejects.toBeInstanceOf(ConflictError);
    expect(prismaMock.sprint.update).not.toHaveBeenCalled();
  });
});

// ─── startSprint — audit log + notification wiring (Gap 2) ──────────────

describe('startSprint — audit log + notification (Gap 2)', () => {
  beforeEach(() => {
    prismaMock.sprint.findUnique.mockResolvedValue({
      id: 's1', status: 'PLANNING', name: 'Sprint 4', projectId: 'proj-1',
    } as any);
    prismaMock.sprint.findFirst.mockResolvedValue(null as any);
    prismaMock.sprint.update.mockResolvedValue({ id: 's1', status: 'ACTIVE' } as any);
    prismaMock.project.findUnique.mockResolvedValue({ name: 'Indigo' } as any);
    prismaMock.user.findUnique.mockResolvedValue({ name: 'Maya' } as any);
  });

  it('WRITES the started_sprint activity row with the actor + sprint name', async () => {
    await startSprint('s1', 'proj-1', 'user-1');

    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        projectId: 'proj-1',
        action: 'started_sprint',
        targetType: 'sprint',
        targetId: 's1',
        details: { name: 'Sprint 4' },
      }),
      expect.anything(), // tx client
    );
  });

  it('FIRES notifySprintStarted with starter + sprint metadata after the tx commits', async () => {
    await startSprint('s1', 'proj-1', 'user-1');

    expect(notifySprintStartedSpy).toHaveBeenCalledWith({
      sprintId: 's1',
      projectId: 'proj-1',
      sprintName: 'Sprint 4',
      projectName: 'Indigo',
      startedBy: 'user-1',
      startedByName: 'Maya',
    });
  });

  it('does NOT BLOCK on notification failure (fire-and-forget)', async () => {
    notifySprintStartedSpy.mockRejectedValue(new Error('notify down'));

    // The sprint already activated inside the tx; a notification
    // failure is logged but doesn't roll back the activation.
    await expect(startSprint('s1', 'proj-1', 'user-1')).resolves.toMatchObject({ id: 's1', status: 'ACTIVE' });
  });

  it('SKIPS the audit log + notification when userId is not provided (legacy caller compatibility)', async () => {
    await startSprint('s1', 'proj-1');

    expect(logActivitySpy).not.toHaveBeenCalled();
    expect(notifySprintStartedSpy).not.toHaveBeenCalled();
  });
});

// ─── completeSprint — notification wiring (Gap 3) ───────────────────────

describe('completeSprint — sprint-completed + task-carried-over notifications (Gap 3)', () => {
  const buildActiveSprint = (overrides: Record<string, unknown> = {}) => ({
    id: 's1',
    projectId: 'proj-1',
    name: 'Sprint 4',
    status: 'ACTIVE',
    // `tasks: { where: { status: NOT DONE } }` from the service —
    // shape matters for carryOver resolution.
    tasks: [
      { id: 't-carry-1', storyPoints: 5 },
      { id: 't-carry-2', storyPoints: 3 },
    ],
    ...overrides,
  });

  beforeEach(() => {
    prismaMock.sprint.findUnique.mockResolvedValue(buildActiveSprint() as any);
    // The service issues task.findMany TWICE in sequence:
    //   1st = allTasksForStats (status + storyPoints, for retro stats)
    //   2nd = carryOverTaskDetails (id + title + assigneeId, for notify)
    prismaMock.task.findMany
      .mockResolvedValueOnce([                            // 1: allTasksForStats
        { status: 'DONE', storyPoints: 5 },
        { status: 'DONE', storyPoints: 3 },
        { status: 'IN_PROGRESS', storyPoints: 5 },
        { status: 'TODO', storyPoints: 3 },
      ] as any)
      .mockResolvedValueOnce([                            // 2: carryOverTaskDetails
        { id: 't-carry-1', title: 'SSO wiring', assigneeId: 'eng-1' },
        { id: 't-carry-2', title: 'Audit log gap', assigneeId: 'eng-2' },
      ] as any);
    prismaMock.sprint.update.mockResolvedValue({ id: 's1', status: 'COMPLETED' } as any);
    prismaMock.task.updateMany.mockResolvedValue({ count: 2 } as any);
    prismaMock.project.findUnique.mockResolvedValue({ name: 'Indigo' } as any);
    prismaMock.user.findUnique.mockResolvedValue({ name: 'Maya' } as any);
  });

  it('NOTIFIES sprint completion with the headline stats inline', async () => {
    await completeSprint('s1', { carryOver: 'all' }, 'user-1');

    expect(notifySprintCompletedSpy).toHaveBeenCalledWith({
      sprintId: 's1',
      projectId: 'proj-1',
      sprintName: 'Sprint 4',
      projectName: 'Indigo',
      completedBy: 'user-1',
      completedByName: 'Maya',
      completedPoints: 8,
      totalPoints: 16,
      carriedOver: 2,
    });
  });

  it('FIRES one notifyTaskCarriedOver per carried-over task with non-null assignee', async () => {
    await completeSprint('s1', { carryOver: 'all' }, 'user-1');

    expect(notifyTaskCarriedOverSpy).toHaveBeenCalledTimes(2);
    expect(notifyTaskCarriedOverSpy).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 't-carry-1',
      taskTitle: 'SSO wiring',
      assigneeId: 'eng-1',
      fromSprintName: 'Sprint 4',
      toSprintName: null, // no carryOverToSprintId → backlog
    }));
    expect(notifyTaskCarriedOverSpy).toHaveBeenCalledWith(expect.objectContaining({
      taskId: 't-carry-2',
      taskTitle: 'Audit log gap',
      assigneeId: 'eng-2',
    }));
  });

  it('PASSES the target sprint NAME (not id) into notifyTaskCarriedOver when carrying into another sprint', async () => {
    // First findUnique = source sprint; second = target sprint for
    // the validation block; third = target sprint for the
    // notification-name lookup. The mock returns the source first,
    // then we need the target name on the carry-over notify path.
    prismaMock.sprint.findUnique
      .mockResolvedValueOnce(buildActiveSprint() as any)                // source
      .mockResolvedValueOnce({ id: 's5', projectId: 'proj-1', status: 'PLANNING' } as any) // target validation
      .mockResolvedValueOnce({ name: 'Sprint 5' } as any);              // target name lookup

    await completeSprint(
      's1',
      { carryOver: 'all', carryOverToSprintId: 's5' },
      'user-1',
    );

    expect(notifyTaskCarriedOverSpy).toHaveBeenCalledWith(expect.objectContaining({
      toSprintName: 'Sprint 5',
    }));
  });

  it('does NOT fire notifyTaskCarriedOver for tasks with no assignee (no one to notify)', async () => {
    // Reset & re-set in the canonical order:
    // 1st findMany = allTasksForStats; 2nd = carryOverTaskDetails.
    prismaMock.task.findMany.mockReset();
    prismaMock.task.findMany
      .mockResolvedValueOnce([{ status: 'TODO', storyPoints: 3 }] as any)
      .mockResolvedValueOnce([
        { id: 't-carry-1', title: 'Unassigned bug', assigneeId: null },
      ] as any);

    await completeSprint('s1', { carryOver: 'all' }, 'user-1');

    expect(notifyTaskCarriedOverSpy).not.toHaveBeenCalled();
  });

  it('SKIPS both notifications when userId is not provided (legacy/background caller)', async () => {
    await completeSprint('s1', { carryOver: 'all' });

    expect(notifySprintCompletedSpy).not.toHaveBeenCalled();
    expect(notifyTaskCarriedOverSpy).not.toHaveBeenCalled();
  });

  it('does NOT BLOCK the completion on notification failure (fire-and-forget)', async () => {
    notifySprintCompletedSpy.mockRejectedValue(new Error('notify down'));
    notifyTaskCarriedOverSpy.mockRejectedValue(new Error('notify down'));

    // Sprint already committed inside the tx; notify failures are
    // logged and the close-out returns success.
    await expect(
      completeSprint('s1', { carryOver: 'all' }, 'user-1'),
    ).resolves.toMatchObject({ status: 'COMPLETED' });
  });
});

// ─── 2026-05-21 optimistic-locking expansion (PR #128 pattern → Sprint) ─

describe('updateSprint — optimistic locking', () => {
  const SERVER_UPDATED_AT = new Date('2026-05-21T10:00:00.000Z');

  it('writes through unchanged when expectedUpdatedAt is omitted', async () => {
    prismaMock.sprint.update.mockResolvedValue({ id: 's1' } as any);
    await updateSprint('s1', { name: 'New name' });
    expect(prismaMock.sprint.update).toHaveBeenCalled();
    expect(prismaMock.sprint.updateMany).not.toHaveBeenCalled();
  });

  it('uses updateMany with a compound where when expectedUpdatedAt matches', async () => {
    prismaMock.sprint.findUnique.mockResolvedValueOnce({ updatedAt: SERVER_UPDATED_AT } as any);
    prismaMock.sprint.updateMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.sprint.findUnique.mockResolvedValueOnce({ id: 's1', updatedAt: new Date() } as any);

    await updateSprint('s1', { name: 'New' }, SERVER_UPDATED_AT.toISOString());

    const args = (prismaMock.sprint.updateMany as any).mock.calls[0]?.[0];
    expect(args.where).toEqual({ id: 's1', updatedAt: SERVER_UPDATED_AT });
  });

  it('throws ConflictError when expectedUpdatedAt is stale at the early check', async () => {
    prismaMock.sprint.findUnique.mockResolvedValue({ updatedAt: SERVER_UPDATED_AT } as any);

    await expect(
      updateSprint('s1', { name: 'New' }, new Date('2026-05-21T09:00:00.000Z').toISOString()),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(prismaMock.sprint.updateMany).not.toHaveBeenCalled();
  });

  it('throws ConflictError when the WRITE-TIME race wins (updateMany count=0)', async () => {
    prismaMock.sprint.findUnique.mockResolvedValueOnce({ updatedAt: SERVER_UPDATED_AT } as any);
    prismaMock.sprint.updateMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.sprint.findUnique.mockResolvedValueOnce({ updatedAt: new Date() } as any);

    await expect(
      updateSprint('s1', { name: 'New' }, SERVER_UPDATED_AT.toISOString()),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
