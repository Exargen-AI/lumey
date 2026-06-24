/**
 * 2026-05-15 TASK-LIFECYCLE-AUDIT.
 *
 * The audit surfaced three notification gaps:
 *
 *   1. Task deletion was silent for the affected humans.
 *      `notifyTaskDeleted` (new) — assignee + reviewer + creator,
 *      deduped, minus the deleter.
 *   2. Priority changes on assigned tasks were silent.
 *      `notifyTaskPriorityChanged` (new) — assignee gets pinged
 *      unless they're the editor.
 *   3. Due-date changes on assigned tasks were silent.
 *      `notifyTaskDueDateChanged` (new) — same shape; passes a
 *      null `newDueDate` when the date was cleared.
 *
 * These tests pin the recipient-set + self-skip behavior of each
 * helper. Wire-in tests (i.e., "when updateTask runs, does it
 * actually call these?") live in task.service.test.ts. Here we
 * just verify the helpers themselves do what they promise.
 */

import './../test/prismaMock';

import { describe, it, expect, beforeEach } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import {
  notifyTaskAssigned,
  notifyClientsOfStoryUpdate,
  notifyTaskDeleted,
  notifyTaskPriorityChanged,
  notifyTaskDueDateChanged,
  notifyAddedToProject,
  notifyRemovedFromProject,
  notifyProjectRoleChanged,
  notifyProjectPMsOfOrphanedTasks,
  notifySprintStarted,
  notifySprintCompleted,
  notifyTaskCarriedOver,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  notifyProjectDeleted,
  notifyMilestoneCompleted,
  notifyMilestoneDeleted,
  createNotification,
  createBulkNotifications,
} from './notification.service';

beforeEach(() => {
  prismaMock.notification.create.mockResolvedValue({} as any);
  prismaMock.notification.createMany.mockResolvedValue({ count: 0 } as any);
});

// ─── notifyTaskAssigned (role-aware link) ───────────────────────────────
// A CLIENT assignee must land in their portal task view, not /eng/my-tasks
// (a route they can't open). Pankaj 2026-06: "assign a ticket to the client
// and notify them when we need their decision."

describe('notifyTaskAssigned', () => {
  it('links a CLIENT assignee to their portal task view + uses the "needs your input" copy', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'CLIENT' } as any);

    await notifyTaskAssigned('task-1', 'client-1', 'Decide on hosting', 'Furix AI', 'pm-1', 'proj-9');

    expect(prismaMock.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'client-1',
          type: 'task_assigned',
          title: 'A task needs your input',
          link: '/client/projects/proj-9/tasks/task-1',
        }),
      }),
    );
  });

  it('links a non-client assignee to the internal task list', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ role: 'ENGINEER' } as any);

    await notifyTaskAssigned('task-1', 'eng-1', 'Wire SSO', 'Furix AI', 'pm-1', 'proj-9');

    expect(prismaMock.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'eng-1',
          title: 'New task assigned to you',
          link: '/eng/my-tasks',
        }),
      }),
    );
  });

  it('does not notify when the assigner assigns to themselves', async () => {
    await notifyTaskAssigned('task-1', 'same-user', 'X', 'Furix AI', 'same-user', 'proj-9');
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });
});

// ─── notifyClientsOfStoryUpdate ─────────────────────────────────────────
// A story update exists so the CLIENT sees progress. Recipients = the
// project's CLIENT members who can actually open the deep link: everyone
// on a client-visible task, or fullAccess clients regardless.

describe('notifyClientsOfStoryUpdate', () => {
  it('pings every client member on a client-visible task (minus the author) with a portal deep link', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ clientVisible: true } as any);
    prismaMock.projectMember.findMany.mockResolvedValue([
      { userId: 'client-1', fullAccess: false },
      { userId: 'client-2', fullAccess: false },
    ] as any);

    await notifyClientsOfStoryUpdate({
      taskId: 'task-1',
      taskTitle: 'Parser service',
      projectId: 'proj-9',
      authorId: 'eng-1',
      progress: 80,
      nextStep: 'Finish integration testing',
    });

    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    expect(call.data.map((d: any) => d.userId).sort()).toEqual(['client-1', 'client-2']);
    expect(call.data[0]).toMatchObject({
      type: 'story_update',
      title: 'Progress update: Parser service',
      body: 'Now 80% — next: Finish integration testing',
      link: '/client/projects/proj-9/tasks/task-1',
    });
  });

  it('on a non-client-visible task, only fullAccess clients are notified', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ clientVisible: false } as any);
    prismaMock.projectMember.findMany.mockResolvedValue([
      { userId: 'client-full', fullAccess: true },
      { userId: 'client-restricted', fullAccess: false },
    ] as any);

    await notifyClientsOfStoryUpdate({
      taskId: 'task-1',
      taskTitle: 'Internal task',
      projectId: 'proj-9',
      authorId: 'eng-1',
      progress: 40,
    });

    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    expect(call.data.map((d: any) => d.userId)).toEqual(['client-full']);
    // No nextStep → the "complete" copy.
    expect(call.data[0].body).toBe('Now 40% complete');
  });

  it('no-ops when there are no eligible client recipients', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ clientVisible: false } as any);
    prismaMock.projectMember.findMany.mockResolvedValue([
      { userId: 'client-restricted', fullAccess: false },
    ] as any);

    await notifyClientsOfStoryUpdate({
      taskId: 'task-1',
      taskTitle: 'X',
      projectId: 'proj-9',
      authorId: 'eng-1',
      progress: 10,
    });

    expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
  });
});

// ─── notifyTaskDeleted ──────────────────────────────────────────────────

describe('notifyTaskDeleted — recipient set', () => {
  it('notifies assignee + reviewer + creator (3 distinct recipients)', async () => {
    await notifyTaskDeleted({
      taskId: 't1',
      projectId: 'proj-1',
      taskTitle: 'Wire SSO',
      projectName: 'Indigo',
      deletedBy: 'admin-1',
      assigneeId: 'eng-1',
      reviewerId: 'pm-1',
      creatorId: 'creator-1',
    });

    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    const userIds = call.data.map((d: any) => d.userId).sort();
    expect(userIds).toEqual(['creator-1', 'eng-1', 'pm-1']);
  });

  it('DEDUPS when the same user is assignee + reviewer + creator (small-team case)', async () => {
    await notifyTaskDeleted({
      taskId: 't1',
      projectId: 'proj-1',
      taskTitle: 'Solo task',
      projectName: 'Indigo',
      deletedBy: 'admin-1',
      assigneeId: 'solo',
      reviewerId: 'solo',
      creatorId: 'solo',
    });

    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    expect(call.data).toHaveLength(1);
    expect(call.data[0].userId).toBe('solo');
  });

  it('EXCLUDES the deleter from the recipient set (they obviously know)', async () => {
    await notifyTaskDeleted({
      taskId: 't1',
      projectId: 'proj-1',
      taskTitle: 'PM-owned task',
      projectName: 'Indigo',
      deletedBy: 'pm-1', // PM is also the creator + reviewer
      assigneeId: 'eng-1',
      reviewerId: 'pm-1',
      creatorId: 'pm-1',
    });

    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    const userIds = call.data.map((d: any) => d.userId);
    expect(userIds).toEqual(['eng-1']);
    expect(userIds).not.toContain('pm-1');
  });

  it('SKIPS createMany entirely when the recipient set is empty (deleter is the only stakeholder)', async () => {
    await notifyTaskDeleted({
      taskId: 't1',
      projectId: 'proj-1',
      taskTitle: 'Self-deleted task',
      projectName: 'Indigo',
      deletedBy: 'eng-1',
      assigneeId: 'eng-1',
      reviewerId: null,
      creatorId: 'eng-1',
    });

    // No recipients → no DB write. Avoids `IN ()` semantics + the
    // log noise from a no-op `createMany`.
    expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
  });

  it('handles a task with no assignee + no reviewer (only creator) gracefully', async () => {
    await notifyTaskDeleted({
      taskId: 't1',
      projectId: 'proj-1',
      taskTitle: 'Backlog rough draft',
      projectName: 'Indigo',
      deletedBy: 'admin-1',
      assigneeId: null,
      reviewerId: null,
      creatorId: 'creator-1',
    });

    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    expect(call.data).toHaveLength(1);
    expect(call.data[0].userId).toBe('creator-1');
  });

  it('writes the type=task_deleted with a link to the project board (not a 404 task link)', async () => {
    await notifyTaskDeleted({
      taskId: 't1',
      projectId: 'proj-1',
      taskTitle: 'Refactor of doom',
      projectName: 'Indigo',
      deletedBy: 'admin-1',
      assigneeId: 'eng-1',
      reviewerId: null,
      creatorId: 'admin-1', // creator is the deleter → only assignee remains
    });

    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    expect(call.data[0]).toMatchObject({
      type: 'task_deleted',
      link: '/projects/proj-1',
    });
    // The task is gone — deep-linking to it would 404, so the
    // notification points at the project board instead.
    expect(call.data[0].link).not.toContain('/tasks/');
  });
});

// ─── notifyTaskPriorityChanged ──────────────────────────────────────────

describe('notifyTaskPriorityChanged — assignee self-skip', () => {
  it('writes a notification when assignee ≠ editor', async () => {
    await notifyTaskPriorityChanged({
      taskId: 't1',
      projectId: 'proj-1',
      taskTitle: 'Wire SSO',
      projectName: 'Indigo',
      assigneeId: 'eng-1',
      editorId: 'pm-1',
      fromPriority: 'P3',
      toPriority: 'P0',
    });

    expect(prismaMock.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'eng-1',
        type: 'task_priority_changed',
        title: 'Priority changed: P3 → P0',
      }),
    });
  });

  it('SKIPS the notification when the editor IS the assignee (self-edit)', async () => {
    await notifyTaskPriorityChanged({
      taskId: 't1',
      projectId: 'proj-1',
      taskTitle: 'Wire SSO',
      projectName: 'Indigo',
      assigneeId: 'eng-1',
      editorId: 'eng-1',
      fromPriority: 'P3',
      toPriority: 'P0',
    });

    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });
});

// ─── notifyTaskDueDateChanged ───────────────────────────────────────────

describe('notifyTaskDueDateChanged — body text + self-skip', () => {
  it('writes "is now due YYYY-MM-DD" when a date is set', async () => {
    await notifyTaskDueDateChanged({
      taskId: 't1',
      projectId: 'proj-1',
      taskTitle: 'Wire SSO',
      projectName: 'Indigo',
      assigneeId: 'eng-1',
      editorId: 'pm-1',
      newDueDate: '2026-06-01',
    });

    const call = prismaMock.notification.create.mock.calls[0]?.[0] as any;
    expect(call.data.body).toContain('is now due 2026-06-01');
  });

  it('writes "no longer has a due date" when the date is cleared (null)', async () => {
    await notifyTaskDueDateChanged({
      taskId: 't1',
      projectId: 'proj-1',
      taskTitle: 'Wire SSO',
      projectName: 'Indigo',
      assigneeId: 'eng-1',
      editorId: 'pm-1',
      newDueDate: null,
    });

    const call = prismaMock.notification.create.mock.calls[0]?.[0] as any;
    expect(call.data.body).toContain('no longer has a due date');
  });

  it('SKIPS the notification when the editor IS the assignee', async () => {
    await notifyTaskDueDateChanged({
      taskId: 't1',
      projectId: 'proj-1',
      taskTitle: 'Wire SSO',
      projectName: 'Indigo',
      assigneeId: 'eng-1',
      editorId: 'eng-1',
      newDueDate: '2026-06-01',
    });

    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });
});

// ─── notifyAddedToProject / notifyRemovedFromProject /
//     notifyProjectRoleChanged (project-membership-audit, this PR) ──────

describe('notifyAddedToProject — added-by + role surface', () => {
  it('writes a notification with the adder\'s name + the new role + a link to the project', async () => {
    await notifyAddedToProject({
      userId: 'new-user',
      projectId: 'proj-1',
      projectName: 'Indigo',
      addedByName: 'Maya',
      memberRole: 'ENGINEER',
    });

    expect(prismaMock.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'new-user',
        type: 'project_member_added',
        title: 'Maya added you to Indigo',
        body: 'Your role on this project: ENGINEER',
        link: '/projects/proj-1',
      }),
    });
  });
});

describe('notifyRemovedFromProject — link is /notifications NOT /projects', () => {
  it('writes a notification that links to /notifications, not the project (which would 403)', async () => {
    // Deliberate UX choice: the removed user can't open the project
    // anymore, so deep-linking would just bounce them to a 403.
    // Link to their notification list so they see the message
    // first and can ask in Slack if it was a mistake.
    await notifyRemovedFromProject({
      userId: 'leaving-user',
      projectId: 'proj-1',
      projectName: 'Indigo',
      removedByName: 'Maya',
    });

    expect(prismaMock.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'leaving-user',
        type: 'project_member_removed',
        title: 'You were removed from Indigo',
        body: 'Maya removed you from this project',
        link: '/notifications',
      }),
    });
    const call = prismaMock.notification.create.mock.calls[0]?.[0] as any;
    expect(call.data.link).not.toContain('/projects/');
  });
});

describe('notifyProjectRoleChanged — body shows old → new role', () => {
  it('shows "fromRole → toRole" in the body so the recipient sees what changed at a glance', async () => {
    await notifyProjectRoleChanged({
      userId: 'eng-1',
      projectId: 'proj-1',
      projectName: 'Indigo',
      changedByName: 'Maya',
      fromRole: 'ENGINEER',
      toRole: 'PRODUCT_MANAGER',
    });

    const call = prismaMock.notification.create.mock.calls[0]?.[0] as any;
    expect(call.data).toMatchObject({
      userId: 'eng-1',
      type: 'project_role_changed',
      title: 'Your role on Indigo changed',
      link: '/projects/proj-1',
    });
    expect(call.data.body).toBe('Maya changed your project role: ENGINEER → PRODUCT_MANAGER');
  });
});

// ─── notifyProjectPMsOfOrphanedTasks (this PR commit 2) ─────────────────

describe('notifyProjectPMsOfOrphanedTasks — recipient set + counts', () => {
  it('skips entirely when both counts are zero (avoid no-op DB writes)', async () => {
    await notifyProjectPMsOfOrphanedTasks({
      projectId: 'proj-1',
      projectName: 'Indigo',
      leavingUserName: 'Vikram',
      unassignedCount: 0,
      unreviewerCount: 0,
    });

    expect(prismaMock.projectMember.findMany).not.toHaveBeenCalled();
    expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
  });

  it('skips silently when the project has no PM/ADMIN members (no audience)', async () => {
    prismaMock.projectMember.findMany.mockResolvedValue([] as any);

    await notifyProjectPMsOfOrphanedTasks({
      projectId: 'proj-1',
      projectName: 'Indigo',
      leavingUserName: 'Vikram',
      unassignedCount: 3,
      unreviewerCount: 0,
    });

    expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
  });

  it('notifies every PM/ADMIN with a body that surfaces BOTH orphan counts when both are non-zero', async () => {
    prismaMock.projectMember.findMany.mockResolvedValue([
      { userId: 'pm-1' },
      { userId: 'pm-2' },
    ] as any);

    await notifyProjectPMsOfOrphanedTasks({
      projectId: 'proj-1',
      projectName: 'Indigo',
      leavingUserName: 'Vikram',
      unassignedCount: 3,
      unreviewerCount: 2,
    });

    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    const recipients = call.data.map((d: any) => d.userId).sort();
    expect(recipients).toEqual(['pm-1', 'pm-2']);
    // Body contains both flavors.
    const body = call.data[0].body;
    expect(body).toContain('Vikram left Indigo');
    expect(body).toContain('3 tasks need a new assignee');
    expect(body).toContain('2 tasks need a new reviewer');
    // Link points at the project board so PMs can re-assign right away.
    expect(call.data[0].link).toBe('/projects/proj-1');
  });

  it('uses singular grammar when count is 1', async () => {
    prismaMock.projectMember.findMany.mockResolvedValue([{ userId: 'pm-1' }] as any);

    await notifyProjectPMsOfOrphanedTasks({
      projectId: 'proj-1',
      projectName: 'Indigo',
      leavingUserName: 'Vikram',
      unassignedCount: 1,
      unreviewerCount: 0,
    });

    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    expect(call.data[0].body).toContain('1 task needs a new assignee');
  });

  it('only includes the count that is non-zero (clean body when only one flavor of orphan exists)', async () => {
    prismaMock.projectMember.findMany.mockResolvedValue([{ userId: 'pm-1' }] as any);

    await notifyProjectPMsOfOrphanedTasks({
      projectId: 'proj-1',
      projectName: 'Indigo',
      leavingUserName: 'Vikram',
      unassignedCount: 0,
      unreviewerCount: 4,
    });

    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    const body = call.data[0].body;
    expect(body).toContain('4 tasks need a new reviewer');
    expect(body).not.toContain('new assignee');
  });
});

// ─── notifySprintStarted / notifySprintCompleted / notifyTaskCarriedOver
//     (sprint-lifecycle-audit, this PR) ────────────────────────────────

describe('notifySprintStarted — project-member fan-out', () => {
  it('notifies every project member EXCEPT the starter', async () => {
    prismaMock.projectMember.findMany.mockResolvedValue([
      { userId: 'pm-1' },
      { userId: 'eng-1' },
      { userId: 'eng-2' },
      { userId: 'maya' }, // the starter — should be excluded
    ] as any);

    await notifySprintStarted({
      sprintId: 's1',
      projectId: 'proj-1',
      sprintName: 'Sprint 4',
      projectName: 'Indigo',
      startedBy: 'maya',
      startedByName: 'Maya',
    });

    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    const recipients = call.data.map((d: any) => d.userId).sort();
    expect(recipients).toEqual(['eng-1', 'eng-2', 'pm-1']);
    expect(recipients).not.toContain('maya');
  });

  it('SKIPS the createMany when the only project member is the starter (empty recipient set)', async () => {
    prismaMock.projectMember.findMany.mockResolvedValue([{ userId: 'maya' }] as any);

    await notifySprintStarted({
      sprintId: 's1',
      projectId: 'proj-1',
      sprintName: 'Sprint 4',
      projectName: 'Indigo',
      startedBy: 'maya',
      startedByName: 'Maya',
    });

    expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
  });

  it('writes the notification with type=sprint_started, sprint name in title, project board link', async () => {
    prismaMock.projectMember.findMany.mockResolvedValue([{ userId: 'eng-1' }] as any);

    await notifySprintStarted({
      sprintId: 's1',
      projectId: 'proj-1',
      sprintName: 'Sprint 4',
      projectName: 'Indigo',
      startedBy: 'maya',
      startedByName: 'Maya',
    });

    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    expect(call.data[0]).toMatchObject({
      type: 'sprint_started',
      title: 'Sprint 4 is now active',
      link: '/projects/proj-1',
    });
    expect(call.data[0].body).toContain('Maya started Sprint 4');
  });
});

describe('notifySprintCompleted — body shows headline stats inline', () => {
  it('inlines "X of Y points landed" + carry-over count when carriedOver > 0', async () => {
    prismaMock.projectMember.findMany.mockResolvedValue([{ userId: 'eng-1' }] as any);

    await notifySprintCompleted({
      sprintId: 's1',
      projectId: 'proj-1',
      sprintName: 'Sprint 4',
      projectName: 'Indigo',
      completedBy: 'maya',
      completedByName: 'Maya',
      completedPoints: 23,
      totalPoints: 30,
      carriedOver: 4,
    });

    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    const body = call.data[0].body;
    expect(body).toContain('23 of 30 points landed');
    expect(body).toContain('4 carried over');
    expect(body).toContain('(Indigo)');
  });

  it('OMITS the carry-over segment on a clean close-out (carriedOver === 0)', async () => {
    prismaMock.projectMember.findMany.mockResolvedValue([{ userId: 'eng-1' }] as any);

    await notifySprintCompleted({
      sprintId: 's1',
      projectId: 'proj-1',
      sprintName: 'Sprint 4',
      projectName: 'Indigo',
      completedBy: 'maya',
      completedByName: 'Maya',
      completedPoints: 30,
      totalPoints: 30,
      carriedOver: 0,
    });

    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    const body = call.data[0].body;
    expect(body).toContain('30 of 30 points landed');
    expect(body).not.toContain('carried over');
  });

  it('EXCLUDES the completer from the recipient set', async () => {
    prismaMock.projectMember.findMany.mockResolvedValue([
      { userId: 'eng-1' },
      { userId: 'maya' },
    ] as any);

    await notifySprintCompleted({
      sprintId: 's1',
      projectId: 'proj-1',
      sprintName: 'Sprint 4',
      projectName: 'Indigo',
      completedBy: 'maya',
      completedByName: 'Maya',
      completedPoints: 23,
      totalPoints: 30,
      carriedOver: 4,
    });

    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    expect(call.data.map((d: any) => d.userId)).toEqual(['eng-1']);
  });
});

describe('notifyTaskCarriedOver — task moved to next sprint or backlog', () => {
  it('writes a notification with the FROM and TO sprint names in the body', async () => {
    await notifyTaskCarriedOver({
      taskId: 't1',
      taskTitle: 'SSO wiring',
      projectId: 'proj-1',
      projectName: 'Indigo',
      assigneeId: 'eng-1',
      completedBy: 'maya',
      fromSprintName: 'Sprint 4',
      toSprintName: 'Sprint 5',
    });

    const call = prismaMock.notification.create.mock.calls[0]?.[0] as any;
    expect(call.data).toMatchObject({
      userId: 'eng-1',
      type: 'task_carried_over',
      title: 'Your task carried over',
      link: '/projects/proj-1/tasks/t1',
    });
    expect(call.data.body).toContain('"SSO wiring"');
    expect(call.data.body).toContain('moved from Sprint 4 to Sprint 5');
  });

  it('says "moved to the backlog" when toSprintName is null', async () => {
    await notifyTaskCarriedOver({
      taskId: 't1',
      taskTitle: 'SSO wiring',
      projectId: 'proj-1',
      projectName: 'Indigo',
      assigneeId: 'eng-1',
      completedBy: 'maya',
      fromSprintName: 'Sprint 4',
      toSprintName: null,
    });

    const call = prismaMock.notification.create.mock.calls[0]?.[0] as any;
    expect(call.data.body).toContain('moved from Sprint 4 to the backlog');
  });

  it('SKIPS when the assignee IS the completer (self-skip)', async () => {
    // Maya is the PM closing the sprint AND the assignee on this
    // carried-over task. She knows — don't self-ping.
    await notifyTaskCarriedOver({
      taskId: 't1',
      taskTitle: 'SSO wiring',
      projectId: 'proj-1',
      projectName: 'Indigo',
      assigneeId: 'maya',
      completedBy: 'maya',
      fromSprintName: 'Sprint 4',
      toSprintName: 'Sprint 5',
    });

    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });
});
describe('markAsRead — userId-scoped updateMany + count surfacing', () => {
  it('returns { updated: 1 } when the notification exists AND belongs to the caller', async () => {
    prismaMock.notification.updateMany.mockResolvedValue({ count: 1 } as any);

    const result = await markAsRead('n1', 'user-1');

    expect(result).toEqual({ updated: 1 });
    // Must scope by userId in the where clause — without this any
    // user could mark anyone else's notifications as read.
    expect(prismaMock.notification.updateMany).toHaveBeenCalledWith({
      where: { id: 'n1', userId: 'user-1' },
      data: { read: true },
    });
  });

  it('returns { updated: 0 } when the notification id does not exist (or belongs to another user) — handler turns this into 404', async () => {
    // Pivotal regression — pre-fix the service had no return shape
    // and the handler returned `{ success: true }` regardless,
    // misleading the FE into showing "marked read" for a stale id.
    prismaMock.notification.updateMany.mockResolvedValue({ count: 0 } as any);

    const result = await markAsRead('n-stale', 'user-1');

    expect(result).toEqual({ updated: 0 });
  });
});

describe('markAllAsRead — count surfaced for FE badge reconciliation', () => {
  it('returns the number of rows flipped so the FE can decrement the badge without re-fetching', async () => {
    prismaMock.notification.updateMany.mockResolvedValue({ count: 7 } as any);

    const result = await markAllAsRead('user-1');

    expect(result).toEqual({ updated: 7 });
    // Scoped to unread + this user (no admin-accidentally-flips-
    // everyone scenario).
    expect(prismaMock.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', read: false },
      data: { read: true },
    });
  });

  it('returns { updated: 0 } when the user had no unread notifications (idempotent)', async () => {
    prismaMock.notification.updateMany.mockResolvedValue({ count: 0 } as any);

    const result = await markAllAsRead('user-1');

    expect(result).toEqual({ updated: 0 });
  });
});

describe('deleteNotification — new endpoint (2026-05-15 audit gap closed)', () => {
  it('deletes the notification and returns { deleted: 1 } when it belongs to the caller', async () => {
    prismaMock.notification.deleteMany.mockResolvedValue({ count: 1 } as any);

    const result = await deleteNotification('n1', 'user-1');

    expect(result).toEqual({ deleted: 1 });
    // Scoped via deleteMany on a userId-bounded where clause — same
    // defensive pattern as markAsRead.
    expect(prismaMock.notification.deleteMany).toHaveBeenCalledWith({
      where: { id: 'n1', userId: 'user-1' },
    });
  });

  it('returns { deleted: 0 } when the notification does not exist or is not the caller\'s — handler turns this into 404', async () => {
    prismaMock.notification.deleteMany.mockResolvedValue({ count: 0 } as any);

    const result = await deleteNotification('n-stale', 'user-1');

    expect(result).toEqual({ deleted: 0 });
  });

  it('CANNOT delete another user\'s notification (deleteMany with userId scope is a no-op for the wrong user)', async () => {
    // Simulating: caller passes a real notification id that
    // belongs to user-OTHER, hoping to delete it. The deleteMany
    // where-clause includes userId, so the DB matches 0 rows.
    prismaMock.notification.deleteMany.mockResolvedValue({ count: 0 } as any);

    const result = await deleteNotification('n-belongs-to-other', 'attacker-user');

    expect(result).toEqual({ deleted: 0 });
    // The query MUST include userId to prevent IDOR.
    const call = prismaMock.notification.deleteMany.mock.calls[0]?.[0] as any;
    expect(call.where.userId).toBe('attacker-user');
  });
});

// ─── notifyProjectDeleted (2026-05-15 project-delete audit) ─────────────

describe('notifyProjectDeleted — fan-out to members + deleter excluded', () => {
  it('notifies every member EXCEPT the deleter, with a non-deep-link to the dashboard', async () => {
    await notifyProjectDeleted({
      projectName: 'Acme Corp',
      deletedBy: 'admin-1',
      deletedByName: 'Pankaj',
      memberIds: ['member-1', 'member-2', 'admin-1'], // admin-1 is the deleter
    });

    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    const recipients = call.data.map((d: any) => d.userId).sort();
    expect(recipients).toEqual(['member-1', 'member-2']);
    expect(recipients).not.toContain('admin-1');

    // Link should NOT be the deleted project — it would 404. Goes
    // to the dashboard instead.
    expect(call.data[0].link).toBe('/');
    expect(call.data[0].link).not.toContain('/projects/');
  });

  it('SKIPS createMany entirely when the only member was the deleter', async () => {
    await notifyProjectDeleted({
      projectName: 'Acme Corp',
      deletedBy: 'admin-1',
      deletedByName: 'Pankaj',
      memberIds: ['admin-1'],
    });

    expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
  });

  it('inlines the project name in the title + the deleter in the body', async () => {
    await notifyProjectDeleted({
      projectName: 'Acme Corp',
      deletedBy: 'admin-1',
      deletedByName: 'Pankaj',
      memberIds: ['member-1'],
    });

    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    expect(call.data[0]).toMatchObject({
      type: 'project_deleted',
      title: 'Acme Corp was deleted',
    });
    expect(call.data[0].body).toContain('Pankaj deleted Acme Corp');
  });
});

// ─── notifyMilestoneCompleted + notifyMilestoneDeleted
//     (2026-05-15 milestone-lifecycle audit) ─────────────────────────────

describe('notifyMilestoneCompleted — project-member fan-out', () => {
  it('notifies every project member EXCEPT the completer', async () => {
    prismaMock.projectMember.findMany.mockResolvedValue([
      { userId: 'eng-1' },
      { userId: 'eng-2' },
      { userId: 'maya' }, // completer — excluded
    ] as any);

    await notifyMilestoneCompleted({
      milestoneId: 'm1',
      projectId: 'proj-1',
      milestoneTitle: 'Beta Launch',
      projectName: 'Indigo',
      completedBy: 'maya',
      completedByName: 'Maya',
    });

    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    const recipients = call.data.map((d: any) => d.userId).sort();
    expect(recipients).toEqual(['eng-1', 'eng-2']);
    expect(recipients).not.toContain('maya');
  });

  it('SKIPS createMany when only the completer is a project member', async () => {
    prismaMock.projectMember.findMany.mockResolvedValue([{ userId: 'maya' }] as any);

    await notifyMilestoneCompleted({
      milestoneId: 'm1',
      projectId: 'proj-1',
      milestoneTitle: 'Beta Launch',
      projectName: 'Indigo',
      completedBy: 'maya',
      completedByName: 'Maya',
    });

    expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
  });

  it('inlines milestone title in the notification title + project name in body', async () => {
    prismaMock.projectMember.findMany.mockResolvedValue([{ userId: 'eng-1' }] as any);

    await notifyMilestoneCompleted({
      milestoneId: 'm1',
      projectId: 'proj-1',
      milestoneTitle: 'Beta Launch',
      projectName: 'Indigo',
      completedBy: 'maya',
      completedByName: 'Maya',
    });

    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    expect(call.data[0].title).toContain('Beta Launch');
    expect(call.data[0].body).toContain('Indigo');
    expect(call.data[0].body).toContain('Maya');
  });
});

describe('notifyMilestoneDeleted — affected-task-count surfacing', () => {
  beforeEach(() => {
    prismaMock.projectMember.findMany.mockResolvedValue([{ userId: 'eng-1' }] as any);
  });

  it('inlines the affected-task count in the body when non-zero (so members understand tasks survive)', async () => {
    await notifyMilestoneDeleted({
      projectId: 'proj-1',
      milestoneTitle: 'Beta Launch',
      projectName: 'Indigo',
      deletedBy: 'maya',
      deletedByName: 'Maya',
      affectedTaskCount: 3,
    });

    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    expect(call.data[0].body).toContain('3 tasks are now unmilestoned');
  });

  it('uses singular grammar when affectedTaskCount is 1', async () => {
    await notifyMilestoneDeleted({
      projectId: 'proj-1',
      milestoneTitle: 'Beta Launch',
      projectName: 'Indigo',
      deletedBy: 'maya',
      deletedByName: 'Maya',
      affectedTaskCount: 1,
    });

    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    expect(call.data[0].body).toContain('1 task is now unmilestoned');
  });

  it('OMITS the task-count clause when zero (clean body for milestones with no tasks)', async () => {
    await notifyMilestoneDeleted({
      projectId: 'proj-1',
      milestoneTitle: 'Beta Launch',
      projectName: 'Indigo',
      deletedBy: 'maya',
      deletedByName: 'Maya',
      affectedTaskCount: 0,
    });

    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    expect(call.data[0].body).not.toContain('unmilestoned');
  });
});

// ─── CC feature PR 2026-05-20 helpers ────────────────────────────────────

import {
  notifyTaskSubscribersOfComment,
  notifyTaskSubscribersOfEdit,
  notifyTaskNudge,
  notifyTaskCompletionEncouragement,
} from './notification.service';

describe('notifyTaskSubscribersOfComment — subscriber fan-out + author exclusion', () => {
  it('writes one notification per subscriber except the comment author', async () => {
    await notifyTaskSubscribersOfComment({
      taskId: 't-1',
      taskTitle: 'Wire SSO',
      projectId: 'p-1',
      projectName: 'Indigo',
      authorId: 'maya',
      authorName: 'Maya',
      commentSnippet: 'I think we should use OAuth2.',
      subscriberIds: ['eng-1', 'eng-2', 'maya'], // maya = author, should be excluded
    });

    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    const recipients = call.data.map((d: any) => d.userId).sort();
    expect(recipients).toEqual(['eng-1', 'eng-2']);
    expect(recipients).not.toContain('maya');
  });

  it('SKIPS createMany when the only subscribers are the author themselves', async () => {
    await notifyTaskSubscribersOfComment({
      taskId: 't-1',
      taskTitle: 'Wire SSO',
      projectId: 'p-1',
      projectName: 'Indigo',
      authorId: 'maya',
      authorName: 'Maya',
      commentSnippet: 'note',
      subscriberIds: ['maya'],
    });

    expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
  });

  it('inlines the comment snippet + task title in the notification body', async () => {
    await notifyTaskSubscribersOfComment({
      taskId: 't-1',
      taskTitle: 'Wire SSO',
      projectId: 'p-1',
      projectName: 'Indigo',
      authorId: 'maya',
      authorName: 'Maya',
      commentSnippet: 'I think we should use OAuth2.',
      subscriberIds: ['eng-1'],
    });

    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    expect(call.data[0].title).toContain('Wire SSO');
    expect(call.data[0].body).toContain('OAuth2');
    expect(call.data[0].link).toBe('/projects/p-1/tasks/t-1');
  });
});

describe('notifyTaskSubscribersOfEdit — change-list fan-out', () => {
  it('lists changed fields in the body so recipients can decide whether to open', async () => {
    await notifyTaskSubscribersOfEdit({
      taskId: 't-1',
      taskTitle: 'Wire SSO',
      projectId: 'p-1',
      projectName: 'Indigo',
      editorId: 'maya',
      editorName: 'Maya',
      changedFields: ['priority', 'due date'],
      subscriberIds: ['eng-1'],
    });

    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    expect(call.data[0].body).toContain('priority, due date');
  });

  it('SKIPS when no fields changed (defensive — caller should already have filtered)', async () => {
    await notifyTaskSubscribersOfEdit({
      taskId: 't-1',
      taskTitle: 'Wire SSO',
      projectId: 'p-1',
      projectName: 'Indigo',
      editorId: 'maya',
      editorName: 'Maya',
      changedFields: [],
      subscriberIds: ['eng-1'],
    });

    expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
  });

  it('excludes the editor from the recipient set', async () => {
    await notifyTaskSubscribersOfEdit({
      taskId: 't-1',
      taskTitle: 'Wire SSO',
      projectId: 'p-1',
      projectName: 'Indigo',
      editorId: 'maya',
      editorName: 'Maya',
      changedFields: ['title'],
      subscriberIds: ['eng-1', 'maya'],
    });

    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    const recipients = call.data.map((d: any) => d.userId);
    expect(recipients).toEqual(['eng-1']);
  });
});

describe('notifyTaskNudge — single recipient with optional message inline', () => {
  it('writes a notification to the assignee with the nudger name + message', async () => {
    await notifyTaskNudge({
      taskId: 't-1',
      taskTitle: 'Wire SSO',
      projectId: 'p-1',
      projectName: 'Indigo',
      nudgedUserId: 'eng-1',
      nudgerName: 'Maya',
      message: 'client is asking for an ETA',
    });

    expect(prismaMock.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'eng-1',
        type: 'task_nudge',
      }),
    });
    const call = prismaMock.notification.create.mock.calls[0]?.[0] as any;
    expect(call.data.title).toContain('Maya nudged you');
    expect(call.data.body).toContain('client is asking for an ETA');
  });

  it('handles a null message (no quoted tail)', async () => {
    await notifyTaskNudge({
      taskId: 't-1',
      taskTitle: 'Wire SSO',
      projectId: 'p-1',
      projectName: 'Indigo',
      nudgedUserId: 'eng-1',
      nudgerName: 'Maya',
      message: null,
    });

    const call = prismaMock.notification.create.mock.calls[0]?.[0] as any;
    expect(call.data.body).not.toContain('"');  // no quoted message
    expect(call.data.body).toContain('Indigo');
  });
});

describe('notifyTaskCompletionEncouragement — streak-aware tone', () => {
  it('uses plain "Nice work" when count < 3', async () => {
    await notifyTaskCompletionEncouragement({
      taskId: 't-1',
      taskTitle: 'Wire SSO',
      projectId: 'p-1',
      projectName: 'Indigo',
      completerId: 'eng-1',
      tasksCompletedToday: 1,
    });

    const call = prismaMock.notification.create.mock.calls[0]?.[0] as any;
    expect(call.data.title).toContain('Nice work');
    expect(call.data.title).not.toContain('on fire');
  });

  it('switches to celebratory "on fire" title when count ≥ 3', async () => {
    await notifyTaskCompletionEncouragement({
      taskId: 't-1',
      taskTitle: 'Wire SSO',
      projectId: 'p-1',
      projectName: 'Indigo',
      completerId: 'eng-1',
      tasksCompletedToday: 5,
    });

    const call = prismaMock.notification.create.mock.calls[0]?.[0] as any;
    expect(call.data.title).toContain('5 tasks done today');
    expect(call.data.title).toContain('on fire');
  });

  it('boundary: exactly 3 is the streak threshold', async () => {
    await notifyTaskCompletionEncouragement({
      taskId: 't-1',
      taskTitle: 'Wire SSO',
      projectId: 'p-1',
      projectName: 'Indigo',
      completerId: 'eng-1',
      tasksCompletedToday: 3,
    });

    const call = prismaMock.notification.create.mock.calls[0]?.[0] as any;
    expect(call.data.title).toContain('on fire');
  });
});

// ─── createNotification mute behavior (notification preferences) ─────
//
// The mute check at the bottom of the funnel is what makes per-user
// preferences work without every fan-out helper having to learn about
// them. Pin the four shapes:
//
//   1. Unmuted user → INSERT happens, returns the row.
//   2. Muted user → INSERT skipped, returns null.
//   3. Muted user + `bypassMute: true` → INSERT happens.
//   4. createBulkNotifications filters the inputs per-recipient before
//      the createMany.

describe('createNotification — mute respect', () => {
  beforeEach(() => {
    // Default: nobody has muted anything. Each test that needs a
    // mute stubs explicitly.
    (prismaMock.notificationPreference.findMany as any).mockResolvedValue([]);
  });

  it('inserts when the user has not muted the type', async () => {
    prismaMock.notification.create.mockResolvedValue({ id: 'n-1' } as any);
    const result = await createNotification({
      userId: 'u-1',
      type: 'task_nudge',
      title: 'You got nudged',
    });
    expect(result).toMatchObject({ id: 'n-1' });
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(1);
  });

  it('returns null without inserting when the user has muted the type', async () => {
    (prismaMock.notificationPreference.findMany as any).mockResolvedValue([
      { type: 'task_nudge' },
    ]);
    const result = await createNotification({
      userId: 'u-1',
      type: 'task_nudge',
      title: 'You got nudged',
    });
    expect(result).toBeNull();
    expect(prismaMock.notification.create).not.toHaveBeenCalled();
  });

  it('inserts even when muted if bypassMute is true (admin path)', async () => {
    (prismaMock.notificationPreference.findMany as any).mockResolvedValue([
      { type: 'onboarding_reminder' },
    ]);
    prismaMock.notification.create.mockResolvedValue({ id: 'n-2' } as any);
    const result = await createNotification({
      userId: 'u-1',
      type: 'onboarding_reminder',
      title: 'Action required',
      bypassMute: true,
    });
    expect(result).toMatchObject({ id: 'n-2' });
    expect(prismaMock.notification.create).toHaveBeenCalledTimes(1);
    // bypassMute should be stripped from the row payload — it's not a
    // Notification column. If it leaked, the create call would fail
    // at runtime against the real schema.
    const args = prismaMock.notification.create.mock.calls[0]?.[0] as any;
    expect(args.data).not.toHaveProperty('bypassMute');
  });
});

describe('createBulkNotifications — mute respect', () => {
  beforeEach(() => {
    (prismaMock.notificationPreference.findMany as any).mockResolvedValue([]);
    prismaMock.notification.createMany.mockResolvedValue({ count: 0 } as any);
  });

  it('inserts every input when nobody has muted', async () => {
    await createBulkNotifications([
      { userId: 'u-1', type: 'task_nudge', title: 'a' },
      { userId: 'u-2', type: 'task_nudge', title: 'b' },
    ]);
    expect(prismaMock.notification.createMany).toHaveBeenCalledTimes(1);
    const args = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    expect(args.data).toHaveLength(2);
  });

  it('filters out recipients who have muted the type', async () => {
    // u-1 muted task_nudge, u-2 hasn't.
    (prismaMock.notificationPreference.findMany as any).mockResolvedValue([
      { userId: 'u-1', type: 'task_nudge' },
    ]);
    await createBulkNotifications([
      { userId: 'u-1', type: 'task_nudge', title: 'a' },
      { userId: 'u-2', type: 'task_nudge', title: 'b' },
    ]);
    const args = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    expect(args.data).toHaveLength(1);
    expect(args.data[0].userId).toBe('u-2');
  });

  it('short-circuits with no DB write when EVERYONE muted the type', async () => {
    (prismaMock.notificationPreference.findMany as any).mockResolvedValue([
      { userId: 'u-1', type: 'task_nudge' },
      { userId: 'u-2', type: 'task_nudge' },
    ]);
    await createBulkNotifications([
      { userId: 'u-1', type: 'task_nudge', title: 'a' },
      { userId: 'u-2', type: 'task_nudge', title: 'b' },
    ]);
    expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
  });
});
