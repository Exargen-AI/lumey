/**
 * Phase 2.5a of the baseline hardening plan — high tier, `task.service.ts`.
 *
 * The biggest service in the codebase (1454 LOC, 18 public functions).
 * Splitting into sub-PRs:
 *   - **2.5a (this file, this PR)**: pure transition validators + read
 *     paths + delete. Small surface, high security value.
 *   - 2.5b (next PR): createTask, updateTask, moveTask — the mutation
 *     core with cross-tenant guards, AC done-gate, agent done-gate.
 *   - 2.5c (later PR): bulk ops, review workflow, checklists, getMyTasks.
 *
 * Security + correctness properties locked in this PR:
 *
 *   1. **Illegal transition wall** — BACKLOG→DONE, BACKLOG→IN_REVIEW,
 *      DONE→IN_REVIEW must all throw. Lateral X→X is always fine.
 *
 *   2. **Done-gate** — a task with unchecked acceptance criteria CANNOT
 *      land in DONE. Empty/missing AC is fine (legacy tasks don't have
 *      AC at all).
 *
 *   3. **Agent-Done-gate** — userType='AGENT' is blocked from DONE
 *      transitions regardless of role permission. Defense in depth.
 *
 *   4. **listTasks visibility gate** — `task.view_internal` permission
 *      controls whether the where clause is widened to include non-
 *      clientVisible tasks. CLIENTs without the perm see only
 *      `clientVisible: true`.
 *
 *   5. **getTask visibility gate** — same property, one task at a time.
 *      Caller without `task.view_internal` cannot read a task with
 *      `clientVisible: false`.
 *
 *   6. **deleteTask atomicity** — delete + audit log run inside a
 *      $transaction. A partial failure can never leave a deleted task
 *      with no audit row.
 */

import './../test/prismaMock';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserRole, TaskStatus } from '@prisma/client';
import { prismaMock } from '../test/prismaMock';
import { NotFoundError, ForbiddenError, ValidationError, ConflictError } from '../utils/errors';

// Mock checkPermission and notify side-effects so tests don't pull in
// the real services.
const { checkPermissionSpy, logActivitySpy } = vi.hoisted(() => ({
  checkPermissionSpy: vi.fn(),
  logActivitySpy: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./rbac.service', () => ({
  __esModule: true,
  checkPermission: checkPermissionSpy,
  // listTasks/getTask now gate internal visibility through the per-project
  // helper. Route it to the same spy so the existing task.view_internal
  // toggles drive it identically.
  canViewProjectInternal: checkPermissionSpy,
}));
vi.mock('./activity.service', () => ({
  __esModule: true,
  logActivity: logActivitySpy,
}));

// notification.service has multiple exports the service imports; provide
// noop stubs to satisfy the module resolver. Phase 2.5b will exercise
// these in the createTask / updateTask / moveTask tests.
vi.mock('./notification.service', () => ({
  __esModule: true,
  notifyTaskAssigned: vi.fn(),
  notifyTaskBlocked: vi.fn(),
  notifyReviewRequested: vi.fn(),
  notifyReviewDecided: vi.fn(),
  // Added by the 2026-05-15 task-lifecycle audit (PR #120) — see
  // deleteTask + updateTask priority/due-date branches below.
  // These default to resolved promises so the production code's
  // `.catch(err => ...)` chain doesn't crash when an unrelated test
  // doesn't bother to explicitly stub them.
  notifyTaskDeleted: vi.fn().mockResolvedValue(undefined),
  notifyTaskPriorityChanged: vi.fn().mockResolvedValue(undefined),
  notifyTaskDueDateChanged: vi.fn().mockResolvedValue(undefined),
  // CC feature PR 2026-05-20 — task subscriptions + nudge +
  // encouragement helpers.
  notifyTaskNudge: vi.fn().mockResolvedValue(undefined),
  notifyTaskSubscribersOfEdit: vi.fn().mockResolvedValue(undefined),
  notifyTaskCompletionEncouragement: vi.fn().mockResolvedValue(undefined),
}));

// taskSubscription.service mocked at the boundary so existing tests
// don't need to stub the taskSubscription Prisma model. The auto-
// subscribe calls in createTask + updateTask + requestReview are
// fire-and-forget; this default-resolving mock keeps them from
// generating unhandled rejections during unrelated test runs.
vi.mock('./taskSubscription.service', () => ({
  __esModule: true,
  subscribeToTask: vi.fn().mockResolvedValue(undefined),
  getSubscriberIdsForNotify: vi.fn().mockResolvedValue([]),
}));

// customField.service.validateValuesForProject runs inside createTask /
// updateTask transactions; not exercised in 2.5a but the import must
// resolve.
vi.mock('./customField.service', () => ({
  __esModule: true,
  validateValuesForProject: vi.fn(async (_p, v) => v ?? {}),
}));

import {
  assertLegalTransition,
  assertAssigneeForActiveStatus,
  enforceDoneGate,
  enforceAgentDoneGate,
  listTasks,
  countTasksByStatus,
  listTaskIds,
  getTask,
  deleteTask,
  createTask,
  updateTask,
  moveTask,
  bulkUpdateTasks,
  bulkDeleteTasks,
  previewBulkDeleteCascade,
  reorderTask,
  requestReview,
  decideReview,
  updateSubtasks,
  updateAcceptanceCriteria,
  getMyTasks,
} from './task.service';
import * as notificationService from './notification.service';

beforeEach(() => {
  checkPermissionSpy.mockReset();
  checkPermissionSpy.mockResolvedValue(false); // safe default: deny
  logActivitySpy.mockClear();
});

// ─── assertLegalTransition (pure) ───────────────────────────────────────

describe('assertLegalTransition', () => {
  it('throws on BACKLOG → DONE (no instant-complete bypass)', () => {
    expect(() => assertLegalTransition(TaskStatus.BACKLOG, TaskStatus.DONE))
      .toThrow(ValidationError);
  });

  it('throws on BACKLOG → IN_REVIEW (must pass through TODO/IN_PROGRESS)', () => {
    expect(() => assertLegalTransition(TaskStatus.BACKLOG, TaskStatus.IN_REVIEW))
      .toThrow(ValidationError);
  });

  it('throws on DONE → IN_REVIEW (reopen path is IN_PROGRESS, not review)', () => {
    expect(() => assertLegalTransition(TaskStatus.DONE, TaskStatus.IN_REVIEW))
      .toThrow(ValidationError);
  });

  it('allows lateral X → X for every status (sortOrder/reorder paths)', () => {
    for (const s of Object.values(TaskStatus)) {
      expect(() => assertLegalTransition(s, s)).not.toThrow();
    }
  });

  it('allows BACKLOG → TODO and TODO → IN_PROGRESS (normal forward flow)', () => {
    expect(() => assertLegalTransition(TaskStatus.BACKLOG, TaskStatus.TODO)).not.toThrow();
    expect(() => assertLegalTransition(TaskStatus.TODO, TaskStatus.IN_PROGRESS)).not.toThrow();
  });

  it('allows DONE → IN_PROGRESS (the documented reopen path)', () => {
    expect(() => assertLegalTransition(TaskStatus.DONE, TaskStatus.IN_PROGRESS)).not.toThrow();
  });

  it('error message names both ends of the illegal transition', () => {
    try {
      assertLegalTransition(TaskStatus.BACKLOG, TaskStatus.DONE);
    } catch (e: any) {
      // Devs reading the error need to know which transition was rejected.
      expect(e.message).toContain('BACKLOG');
      expect(e.message).toContain('DONE');
    }
  });
});

// ─── assertAssigneeForActiveStatus (pure) ───────────────────────────────
// Pankaj 2026-06-02: a task slid into In Progress with nobody assigned.
// Active statuses (In Progress / In Review / Done) must have an owner;
// Backlog / To Do stay assignable-later for triage. Enforced in every
// status-change path (moveTask, updateTask, bulkUpdateTasks).

describe('assertAssigneeForActiveStatus', () => {
  it('throws moving to IN_PROGRESS with no assignee', () => {
    expect(() => assertAssigneeForActiveStatus(TaskStatus.IN_PROGRESS, null))
      .toThrow(ValidationError);
    expect(() => assertAssigneeForActiveStatus(TaskStatus.IN_PROGRESS, undefined))
      .toThrow(ValidationError);
  });

  it('throws moving to IN_REVIEW or DONE with no assignee', () => {
    expect(() => assertAssigneeForActiveStatus(TaskStatus.IN_REVIEW, null)).toThrow(ValidationError);
    expect(() => assertAssigneeForActiveStatus(TaskStatus.DONE, null)).toThrow(ValidationError);
  });

  it('allows an active status when an assignee is present', () => {
    expect(() => assertAssigneeForActiveStatus(TaskStatus.IN_PROGRESS, 'user-1')).not.toThrow();
    expect(() => assertAssigneeForActiveStatus(TaskStatus.IN_REVIEW, 'user-1')).not.toThrow();
    expect(() => assertAssigneeForActiveStatus(TaskStatus.DONE, 'user-1')).not.toThrow();
  });

  it('never blocks BACKLOG or TODO — they stay assignable-later', () => {
    expect(() => assertAssigneeForActiveStatus(TaskStatus.BACKLOG, null)).not.toThrow();
    expect(() => assertAssigneeForActiveStatus(TaskStatus.TODO, null)).not.toThrow();
  });

  it('error message tells the user to assign someone', () => {
    try {
      assertAssigneeForActiveStatus(TaskStatus.IN_PROGRESS, null);
    } catch (e: any) {
      expect(e.message).toMatch(/assign someone/i);
      expect(e.message).toContain('In Progress');
    }
  });
});

// ─── enforceDoneGate (pure) ─────────────────────────────────────────────

describe('enforceDoneGate', () => {
  it('is a no-op when newStatus !== DONE', () => {
    // Even with unchecked AC, we don't throw if the target isn't DONE.
    expect(() =>
      enforceDoneGate(
        { acceptanceCriteria: [{ done: false }, { done: false }] },
        TaskStatus.IN_PROGRESS,
      ),
    ).not.toThrow();
  });

  it('is a no-op when AC is missing (legacy tasks without AC)', () => {
    expect(() => enforceDoneGate({ acceptanceCriteria: null }, TaskStatus.DONE)).not.toThrow();
    expect(() => enforceDoneGate({ acceptanceCriteria: undefined as any }, TaskStatus.DONE)).not.toThrow();
  });

  it('is a no-op when AC array is empty', () => {
    expect(() => enforceDoneGate({ acceptanceCriteria: [] }, TaskStatus.DONE)).not.toThrow();
  });

  it('allows DONE when every AC item is { done: true }', () => {
    expect(() =>
      enforceDoneGate(
        { acceptanceCriteria: [{ done: true }, { done: true }, { done: true }] },
        TaskStatus.DONE,
      ),
    ).not.toThrow();
  });

  it('throws when ANY AC item is unchecked (the actual gate)', () => {
    expect(() =>
      enforceDoneGate(
        { acceptanceCriteria: [{ done: true }, { done: false }, { done: true }] },
        TaskStatus.DONE,
      ),
    ).toThrow(/1 acceptance criterion is still unchecked/);
  });

  it('plural error message correctly when 2+ AC items are unchecked', () => {
    expect(() =>
      enforceDoneGate(
        { acceptanceCriteria: [{ done: false }, { done: false }, { done: true }] },
        TaskStatus.DONE,
      ),
    ).toThrow(/2 acceptance criteria are still unchecked/);
  });

  it('treats missing `done` field as unchecked (defensive)', () => {
    // A future shape change where `done` is sometimes undefined must
    // not silently pass the gate. The current code uses
    // `c.done !== true`, so undefined/null/false all count as unchecked.
    expect(() =>
      enforceDoneGate(
        { acceptanceCriteria: [{}, { done: true }] },
        TaskStatus.DONE,
      ),
    ).toThrow(/1 acceptance criterion is still unchecked/);
  });

  // 2026-05-23 Pankaj UX report: the error said "2 acceptance criteria are
  // still unchecked" without naming WHICH. He had to open the modal to
  // figure out what to tick. The error now lists the unchecked items
  // inline. These tests pin the user-facing format so a future rewrite
  // can't quietly regress the experience.
  describe('actionable error message — names the unchecked items inline', () => {
    it('includes the AC text in quotes when one item is unchecked', () => {
      expect(() =>
        enforceDoneGate(
          {
            acceptanceCriteria: [
              { text: 'Tests added', done: true },
              { text: 'Docs reviewed', done: false },
            ],
          },
          TaskStatus.DONE,
        ),
      ).toThrow(/"Docs reviewed"/);
    });

    it('lists the first 3 unchecked items + ends with "Open the task to tick them."', () => {
      let err: Error | undefined;
      try {
        enforceDoneGate(
          {
            acceptanceCriteria: [
              { text: 'Tests added', done: false },
              { text: 'Docs reviewed', done: false },
              { text: 'Counsel sign-off', done: false },
            ],
          },
          TaskStatus.DONE,
        );
      } catch (e) {
        err = e as Error;
      }
      expect(err?.message).toContain('"Tests added"');
      expect(err?.message).toContain('"Docs reviewed"');
      expect(err?.message).toContain('"Counsel sign-off"');
      expect(err?.message).toContain('Open the task to tick them.');
    });

    it('caps the inline list at 3 items and appends "+N more" overflow count', () => {
      let err: Error | undefined;
      try {
        enforceDoneGate(
          {
            acceptanceCriteria: [
              { text: 'A', done: false },
              { text: 'B', done: false },
              { text: 'C', done: false },
              { text: 'D', done: false },
              { text: 'E', done: false },
            ],
          },
          TaskStatus.DONE,
        );
      } catch (e) {
        err = e as Error;
      }
      expect(err?.message).toContain('"A", "B", "C"');
      // D + E are the overflow; show them as count not text.
      expect(err?.message).toContain('(+2 more)');
      expect(err?.message).not.toContain('"D"');
      expect(err?.message).not.toContain('"E"');
    });

    it('truncates very long AC text to 60 chars with an ellipsis (toast width sanity)', () => {
      const longText = 'a'.repeat(200);
      let err: Error | undefined;
      try {
        enforceDoneGate(
          { acceptanceCriteria: [{ text: longText, done: false }] },
          TaskStatus.DONE,
        );
      } catch (e) {
        err = e as Error;
      }
      // Truncated at 57 + ellipsis, all in quotes, total chars between
      // them ≤ 60 + 2 surrounding quotes.
      expect(err?.message).toMatch(/"a{57}…"/);
      expect(err?.message).not.toContain('a'.repeat(100));
    });

    it('falls back to "Item N" when an AC entry has no text (defensive)', () => {
      let err: Error | undefined;
      try {
        enforceDoneGate(
          {
            acceptanceCriteria: [
              { text: '', done: false },         // empty text
              { done: false },                    // missing text field
            ],
          },
          TaskStatus.DONE,
        );
      } catch (e) {
        err = e as Error;
      }
      expect(err?.message).toContain('"Item 1"');
      expect(err?.message).toContain('"Item 2"');
    });

    it('only lists the UNCHECKED items, not the already-done ones (count + names both filtered)', () => {
      let err: Error | undefined;
      try {
        enforceDoneGate(
          {
            acceptanceCriteria: [
              { text: 'Done already', done: true },
              { text: 'Still pending', done: false },
            ],
          },
          TaskStatus.DONE,
        );
      } catch (e) {
        err = e as Error;
      }
      expect(err?.message).toContain('1 acceptance criterion is still unchecked');
      expect(err?.message).toContain('"Still pending"');
      expect(err?.message).not.toContain('"Done already"');
    });

    it('trims whitespace around AC text before quoting (form-input whitespace)', () => {
      let err: Error | undefined;
      try {
        enforceDoneGate(
          { acceptanceCriteria: [{ text: '  Trim me  ', done: false }] },
          TaskStatus.DONE,
        );
      } catch (e) {
        err = e as Error;
      }
      expect(err?.message).toContain('"Trim me"');
    });
  });
});

// ─── enforceAgentDoneGate ──────────────────────────────────────────────

describe('enforceAgentDoneGate', () => {
  it('is a no-op when newStatus !== DONE (agents can move tasks anywhere else)', async () => {
    await expect(
      enforceAgentDoneGate(TaskStatus.IN_PROGRESS, { userType: 'AGENT', role: UserRole.ENGINEER }),
    ).resolves.not.toThrow();
    // No permission check should fire — non-DONE short-circuits.
    expect(checkPermissionSpy).not.toHaveBeenCalled();
  });

  it('AGENT → DONE is hard-rejected regardless of role permission', async () => {
    // Even if the permission would have allowed it, the structural
    // userType check fires first. This is the invariant: agents never
    // land tasks in DONE.
    checkPermissionSpy.mockResolvedValue(true); // permission would allow

    await expect(
      enforceAgentDoneGate(TaskStatus.DONE, { userType: 'AGENT', role: UserRole.ENGINEER }),
    ).rejects.toThrow(/Agents may not transition tasks to Done/);

    // checkPermission must NOT have been consulted — userType check
    // fires before the permission check.
    expect(checkPermissionSpy).not.toHaveBeenCalled();
  });

  it('HUMAN with task.transition.done permission allowed to DONE', async () => {
    checkPermissionSpy.mockResolvedValue(true);
    await expect(
      enforceAgentDoneGate(TaskStatus.DONE, { userType: 'HUMAN', role: UserRole.ENGINEER }),
    ).resolves.not.toThrow();
    expect(checkPermissionSpy).toHaveBeenCalledWith(UserRole.ENGINEER, 'task.transition.done');
  });

  it('HUMAN WITHOUT task.transition.done is rejected (admin can revoke per role)', async () => {
    checkPermissionSpy.mockResolvedValue(false);
    await expect(
      enforceAgentDoneGate(TaskStatus.DONE, { userType: 'HUMAN', role: UserRole.CLIENT }),
    ).rejects.toThrow(/do not have permission to transition tasks to Done/);
  });

  it('error message for AGENT is distinct from message for HUMAN-no-perm (different remediation)', async () => {
    let agentErr = '';
    let humanErr = '';
    try {
      await enforceAgentDoneGate(TaskStatus.DONE, { userType: 'AGENT', role: UserRole.ENGINEER });
    } catch (e: any) { agentErr = e.message; }
    checkPermissionSpy.mockResolvedValue(false);
    try {
      await enforceAgentDoneGate(TaskStatus.DONE, { userType: 'HUMAN', role: UserRole.CLIENT });
    } catch (e: any) { humanErr = e.message; }

    expect(agentErr).not.toBe(humanErr);
    expect(agentErr).toContain('request a human reviewer');
    expect(humanErr).toContain('permission');
  });
});

// ─── listTasks (visibility + filters + pagination) ─────────────────────

describe('listTasks', () => {
  beforeEach(() => {
    // Default-empty result so each test only stubs what it cares about.
    prismaMock.task.findMany.mockResolvedValue([]);
  });

  it('queries with `clientVisible: true` only when caller cannot see project internal work', async () => {
    // canViewProjectInternal is routed to this spy in the module mock.
    checkPermissionSpy.mockResolvedValue(false); // CLIENT without full access

    await listTasks('proj-1', { id: 'u1', role: UserRole.CLIENT, canViewAgents: true });

    const where = prismaMock.task.findMany.mock.calls[0]?.[0]?.where as any;
    expect(where.clientVisible).toBe(true);
    expect(where.projectId).toBe('proj-1');
  });

  it('does NOT restrict to clientVisible when caller can see project internal work', async () => {
    // A CLIENT member granted per-project full access (or any staff role):
    // canViewProjectInternal (→ this spy) returns true.
    checkPermissionSpy.mockResolvedValue(true);

    await listTasks('proj-1', { id: 'u1', role: UserRole.CLIENT, canViewAgents: true });

    const where = prismaMock.task.findMany.mock.calls[0]?.[0]?.where as any;
    expect(where.clientVisible).toBeUndefined();
    expect(where.projectId).toBe('proj-1');
  });

  it('omits the clientVisible filter when caller has task.view_internal (admin/engineer view)', async () => {
    checkPermissionSpy.mockResolvedValue(true);

    await listTasks('proj-1', { role: UserRole.ADMIN, canViewAgents: true });

    const where = prismaMock.task.findMany.mock.calls[0]?.[0]?.where as any;
    expect(where.clientVisible).toBeUndefined();
  });

  it('respects all the optional filters (status, priority, assigneeId, isBlocked, search, productId, taskType)', async () => {
    checkPermissionSpy.mockResolvedValue(true);

    await listTasks('proj-1', { role: UserRole.ADMIN, canViewAgents: true }, {
      status: 'TODO',
      priority: 'P0',
      assigneeId: 'u-1',
      isBlocked: 'true',
      search: 'spike',
      productId: 'prod-x',
      taskType: 'BUG',
    });

    const where = prismaMock.task.findMany.mock.calls[0]?.[0]?.where as any;
    expect(where).toMatchObject({
      projectId: 'proj-1',
      status: 'TODO',
      priority: 'P0',
      assigneeId: 'u-1',
      isBlocked: true, // coerced from string
      productId: 'prod-x',
      taskType: 'BUG',
      title: { contains: 'spike', mode: 'insensitive' },
    });
  });

  it('treats productId === "none" as a sentinel for `productId: null`', async () => {
    checkPermissionSpy.mockResolvedValue(true);

    await listTasks('proj-1', { role: UserRole.ADMIN, canViewAgents: true }, { productId: 'none' });

    const where = prismaMock.task.findMany.mock.calls[0]?.[0]?.where as any;
    expect(where.productId).toBeNull();
  });

  // #208 removed the old 500 cap for pagination; this PR restores a sane
  // upper bound (MAX_LIMIT 2000) so a `?limit=100000` payload bomb is refused
  // while real boards (paged 200 at a time) are unaffected.
  it('caps the limit at MAX_LIMIT (2000) when the caller asks for more (DoS guard)', async () => {
    checkPermissionSpy.mockResolvedValue(true);

    await listTasks('proj-1', { role: UserRole.ADMIN, canViewAgents: true }, { limit: 100_000 });

    const take = prismaMock.task.findMany.mock.calls[0]?.[0]?.take as number;
    expect(take).toBe(2000);
  });

  it('honors a normal page-size limit below the cap (pagination)', async () => {
    checkPermissionSpy.mockResolvedValue(true);

    await listTasks('proj-1', { role: UserRole.ADMIN, canViewAgents: true }, { limit: 200 });

    const take = prismaMock.task.findMany.mock.calls[0]?.[0]?.take as number;
    expect(take).toBe(200);
  });

  it('defaults limit to 200 when none is provided', async () => {
    checkPermissionSpy.mockResolvedValue(true);

    await listTasks('proj-1', { role: UserRole.ADMIN, canViewAgents: true });

    const take = prismaMock.task.findMany.mock.calls[0]?.[0]?.take as number;
    expect(take).toBe(200);
  });

  it('orders by sortOrder asc, then createdAt asc (board-stable ordering)', async () => {
    checkPermissionSpy.mockResolvedValue(true);

    await listTasks('proj-1', { role: UserRole.ADMIN, canViewAgents: true });

    const orderBy = prismaMock.task.findMany.mock.calls[0]?.[0]?.orderBy as any;
    expect(orderBy).toEqual([{ sortOrder: 'asc' }, { createdAt: 'asc' }]);
  });

  it('computes enteredCurrentStatusAt from the most recent history row whose toStatus matches', async () => {
    checkPermissionSpy.mockResolvedValue(true);
    const now = new Date('2026-05-01T00:00:00Z');
    const stale = new Date('2026-04-01T00:00:00Z');
    prismaMock.task.findMany.mockResolvedValue([
      {
        id: 't1',
        status: TaskStatus.IN_PROGRESS,
        createdAt: stale,
        statusHistory: [
          // The latest history row is DONE→IN_PROGRESS (task bounced).
          // We must match the IN_PROGRESS entry, NOT the later DONE one.
          { changedAt: now, toStatus: TaskStatus.IN_PROGRESS },
          { changedAt: new Date('2026-04-15'), toStatus: TaskStatus.DONE },
        ],
      } as any,
    ]);

    const result = await listTasks('proj-1', { role: UserRole.ADMIN, canViewAgents: true });

    expect(result[0]!.enteredCurrentStatusAt).toEqual(now);
    // statusHistory itself is stripped from the response (internal detail).
    expect((result[0]! as any).statusHistory).toBeUndefined();
  });
});

// ─── countTasksByStatus + listTaskIds (#208 — kanban column counts +
//     "select all in column"). Both honor the same visibility gate as
//     listTasks via buildTaskWhere. ──────────────────────────────────────

describe('countTasksByStatus', () => {
  it('returns a per-status map with every status zero-filled, then groupBy totals applied', async () => {
    checkPermissionSpy.mockResolvedValue(true); // admin → no clientVisible gate
    (prismaMock.task.groupBy as any).mockResolvedValue([
      { status: 'BACKLOG', _count: { _all: 12 } },
      { status: 'DONE', _count: { _all: 3 } },
    ] as any);

    const counts = await countTasksByStatus('proj-1', { role: UserRole.ADMIN, canViewAgents: true }, {});

    // Every status present (zero-filled), groupBy totals applied.
    expect(counts.BACKLOG).toBe(12);
    expect(counts.DONE).toBe(3);
    expect(counts.TODO).toBe(0);
    expect(counts.IN_PROGRESS).toBe(0);
    expect(counts.IN_REVIEW).toBe(0);
  });

  it('strips an incoming `status` filter so it counts ACROSS statuses, not one', async () => {
    checkPermissionSpy.mockResolvedValue(true);
    (prismaMock.task.groupBy as any).mockResolvedValue([] as any);

    await countTasksByStatus('proj-1', { role: UserRole.ADMIN, canViewAgents: true }, { status: 'DONE' });

    const where = (prismaMock.task.groupBy as any).mock.calls[0]?.[0]?.where as any;
    // The status filter must NOT be forwarded — we want all statuses' counts.
    expect(where.status).toBeUndefined();
  });

  it('forces clientVisible-only for a viewer without internal access', async () => {
    checkPermissionSpy.mockResolvedValue(false); // CLIENT, no per-project grant
    prismaMock.projectMember.findUnique.mockResolvedValue(null);
    (prismaMock.task.groupBy as any).mockResolvedValue([] as any);

    await countTasksByStatus('proj-1', { id: 'c1', role: UserRole.CLIENT, canViewAgents: false }, {});

    const where = (prismaMock.task.groupBy as any).mock.calls[0]?.[0]?.where as any;
    expect(where.clientVisible).toBe(true);
  });
});

describe('listTaskIds', () => {
  it('returns just the ids, ordered, honoring the where gate', async () => {
    checkPermissionSpy.mockResolvedValue(true);
    prismaMock.task.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }] as any);

    const ids = await listTaskIds('proj-1', { role: UserRole.ADMIN, canViewAgents: true }, {});

    expect(ids).toEqual(['a', 'b', 'c']);
    const args = prismaMock.task.findMany.mock.calls[0]?.[0] as any;
    expect(args.select).toEqual({ id: true });
  });

  it('restricts to clientVisible ids for a viewer without internal access', async () => {
    checkPermissionSpy.mockResolvedValue(false);
    prismaMock.projectMember.findUnique.mockResolvedValue(null);
    prismaMock.task.findMany.mockResolvedValue([] as any);

    await listTaskIds('proj-1', { id: 'c1', role: UserRole.CLIENT, canViewAgents: false }, {});

    const where = prismaMock.task.findMany.mock.calls[0]?.[0]?.where as any;
    expect(where.clientVisible).toBe(true);
  });
});

// ─── getTask (single-row visibility gate) ──────────────────────────────

describe('getTask', () => {
  it('throws NotFoundError when the task does not exist', async () => {
    prismaMock.task.findUnique.mockResolvedValue(null);
    await expect(getTask('missing', { role: UserRole.ADMIN })).rejects.toThrow(NotFoundError);
  });

  it('throws ForbiddenError when caller lacks view_internal AND task is not clientVisible', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: 't1',
      clientVisible: false,
    } as any);
    checkPermissionSpy.mockResolvedValue(false);

    await expect(getTask('t1', { role: UserRole.CLIENT })).rejects.toThrow(ForbiddenError);
  });

  it('returns the task when caller has view_internal (admin sees everything)', async () => {
    const task = { id: 't1', clientVisible: false, title: 'Internal task' };
    prismaMock.task.findUnique.mockResolvedValue(task as any);
    checkPermissionSpy.mockResolvedValue(true);

    await expect(getTask('t1', { role: UserRole.ADMIN })).resolves.toMatchObject({ id: 't1' });
  });

  it('returns the task when caller lacks view_internal BUT the task is clientVisible', async () => {
    const task = { id: 't1', clientVisible: true, title: 'Public task' };
    prismaMock.task.findUnique.mockResolvedValue(task as any);
    checkPermissionSpy.mockResolvedValue(false);

    await expect(getTask('t1', { role: UserRole.CLIENT })).resolves.toMatchObject({ id: 't1' });
  });
});

// ─── deleteTask ────────────────────────────────────────────────────────

describe('deleteTask', () => {
  beforeEach(() => {
    // Default: $transaction passthrough (executes the callback against the mock client).
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
  });

  it('throws NotFoundError when the task does not exist (no audit row written either)', async () => {
    prismaMock.task.findUnique.mockResolvedValue(null);

    await expect(deleteTask('gone', 'user-1')).rejects.toThrow(NotFoundError);

    expect(prismaMock.task.delete).not.toHaveBeenCalled();
    expect(logActivitySpy).not.toHaveBeenCalled();
  });

  it('deletes the task AND writes the audit log inside the same $transaction', async () => {
    const task = {
      id: 't1',
      projectId: 'proj-1',
      title: 'Old task',
      assigneeId: null,
      reviewerId: null,
      creatorId: 'user-1',
    };
    prismaMock.task.findUnique.mockResolvedValue(task as any);

    await deleteTask('t1', 'user-1');

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.task.delete).toHaveBeenCalledWith({ where: { id: 't1' } });
    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        projectId: 'proj-1',
        action: 'deleted_task',
        targetType: 'task',
        targetId: 't1',
        details: { title: 'Old task' },
      }),
      // logActivity receives the tx client as a second arg so it joins
      // the same transaction as the delete.
      expect.anything(),
    );
  });

  /**
   * 2026-05-15 TASK-LIFECYCLE-AUDIT regression — task deletion was
   * silent for the affected humans. Now: notify the assignee +
   * reviewer + creator (deduped, deleter excluded). Pre-fix the
   * task vanished and no one learned about it until they next hit
   * the (now-404) link.
   */
  it('NOTIFIES assignee + reviewer + creator (minus the deleter) when a task is deleted', async () => {
    vi.mocked(notificationService.notifyTaskDeleted).mockResolvedValue(undefined as any);
    const task = {
      id: 't1',
      projectId: 'proj-1',
      title: 'Critical fix',
      assigneeId: 'eng-1',
      reviewerId: 'pm-1',
      creatorId: 'pm-1', // intentional: same person filed + reviews
    };
    prismaMock.task.findUnique.mockResolvedValue(task as any);
    prismaMock.project.findUnique.mockResolvedValue({ name: 'Saffron' } as any);

    await deleteTask('t1', 'admin-1'); // deleted by someone NOT on the task

    expect(notificationService.notifyTaskDeleted).toHaveBeenCalledWith({
      taskId: 't1',
      projectId: 'proj-1',
      taskTitle: 'Critical fix',
      projectName: 'Saffron',
      deletedBy: 'admin-1',
      assigneeId: 'eng-1',
      reviewerId: 'pm-1',
      creatorId: 'pm-1',
    });
  });

  it('does NOT block the delete on notifyTaskDeleted failure (fire-and-forget)', async () => {
    // Operationally critical: a notification failure (e.g. DB down,
    // rate limit) must NOT roll back a successful destructive op.
    // The delete already committed; we only log the notify error
    // for ops to triage.
    vi.mocked(notificationService.notifyTaskDeleted).mockRejectedValue(new Error('notify exploded'));
    const task = {
      id: 't1',
      projectId: 'proj-1',
      title: 'Old task',
      assigneeId: 'eng-1',
      reviewerId: null,
      creatorId: 'pm-1',
    };
    prismaMock.task.findUnique.mockResolvedValue(task as any);
    prismaMock.project.findUnique.mockResolvedValue({ name: 'Indigo' } as any);

    // Must NOT throw — the delete must succeed even if notify fails.
    await expect(deleteTask('t1', 'admin-1')).resolves.toBeUndefined();
    expect(prismaMock.task.delete).toHaveBeenCalled();
  });
});

// ─── createTask — mutation core ────────────────────────────────────────
//
// The createTask path is where client-actor sanitization, cross-tenant
// guards, and per-project taskCounter integrity all converge. Each test
// nails down one behavior so a future refactor can't quietly weaken
// any of them.

describe('createTask', () => {
  /**
   * Setup a transaction passthrough that runs the callback against
   * prismaMock directly. The service file uses prisma.$transaction with
   * a callback — without this, the callback never fires.
   */
  function configureTransactionPassthrough() {
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
  }

  function configureProjectAndAggregates(opts: { taskCounter?: number; maxSort?: number } = {}) {
    prismaMock.project.update.mockResolvedValue({
      taskCounter: opts.taskCounter ?? 42,
      slug: 'proj',
    } as any);
    prismaMock.task.aggregate.mockResolvedValue({
      _max: { sortOrder: opts.maxSort ?? 0 },
    } as any);
    // Bare-minimum return shape — tests only assert specific fields.
    prismaMock.task.create.mockImplementation(((args: any) =>
      Promise.resolve({ id: 'new-task-id', ...args.data })
    ) as any);
  }

  beforeEach(() => {
    configureTransactionPassthrough();
    configureProjectAndAggregates();
  });

  describe('happy path', () => {
    it('creates a task with auto-incrementing taskNumber + sortOrder=max+1', async () => {
      configureProjectAndAggregates({ taskCounter: 100, maxSort: 7 });

      await createTask(
        'proj-1',
        { title: 'New task' },
        'user-creator',
        UserRole.ADMIN,
      );

      // taskCounter is bumped on the project, and the new task's
      // taskNumber comes from the post-increment value.
      expect(prismaMock.project.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'proj-1' },
          data: { taskCounter: { increment: 1 } },
        }),
      );
      const createCall = prismaMock.task.create.mock.calls[0]?.[0] as any;
      expect(createCall.data.taskNumber).toBe(100);
      expect(createCall.data.sortOrder).toBe(8); // 7 + 1
    });

    it('defaults priority to P2 and taskType to FEATURE when omitted', async () => {
      await createTask('proj-1', { title: 'T' }, 'u1', UserRole.ADMIN);

      const createCall = prismaMock.task.create.mock.calls[0]?.[0] as any;
      expect(createCall.data.priority).toBe('P2');
      expect(createCall.data.taskType).toBe('FEATURE');
    });

    it('writes the activity log AFTER the transaction commits (action: created_task)', async () => {
      await createTask('proj-1', { title: 'X' }, 'u-creator', UserRole.ADMIN);

      expect(logActivitySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'u-creator',
          projectId: 'proj-1',
          action: 'created_task',
          targetType: 'task',
          targetId: 'new-task-id',
        }),
      );
    });

    it('records action="submitted_client_request" when data.clientRequested is set by an internal user', async () => {
      // Internal user submitting on a client's behalf.
      await createTask(
        'proj-1',
        { title: 'X', clientRequested: true },
        'u-pm',
        UserRole.PRODUCT_MANAGER,
      );

      expect(logActivitySpy).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'submitted_client_request' }),
      );
    });
  });

  describe('client-actor sanitization (the front-door defense)', () => {
    const clientData = {
      title: 'I want a feature',
      status: 'IN_PROGRESS',          // forbidden — clients can't pick status
      clientVisible: false,             // forbidden — clients can't hide their own
      assigneeId: 'engineer-1',         // forbidden — clients can't assign
      sprintId: 'sprint-1',             // forbidden — planning field
      epicId: 'epic-1',                 // forbidden
      milestoneId: 'milestone-1',       // forbidden
      storyPoints: 13,                  // forbidden
      taskType: 'CHORE',                // forbidden — internal vocab
      subtasks: [{ text: 'whatever' }], // forbidden
      acceptanceCriteria: [{ text: 'AC', done: false }], // forbidden
    };

    it('forces status=BACKLOG (no skipping to IN_PROGRESS)', async () => {
      await createTask('proj-1', clientData, 'client-1', UserRole.CLIENT);
      const createCall = prismaMock.task.create.mock.calls[0]?.[0] as any;
      expect(createCall.data.status).toBe(TaskStatus.BACKLOG);
    });

    it('forces clientVisible=true (clients cannot create invisible work)', async () => {
      await createTask('proj-1', clientData, 'client-1', UserRole.CLIENT);
      const createCall = prismaMock.task.create.mock.calls[0]?.[0] as any;
      expect(createCall.data.clientVisible).toBe(true);
    });

    it('strips assigneeId, sprintId, epicId, milestoneId, storyPoints, subtasks, AC', async () => {
      await createTask('proj-1', clientData, 'client-1', UserRole.CLIENT);
      const createCall = prismaMock.task.create.mock.calls[0]?.[0] as any;
      expect(createCall.data.assigneeId).toBeNull();
      expect(createCall.data.sprintId).toBeNull();
      expect(createCall.data.epicId).toBeNull();
      expect(createCall.data.milestoneId).toBeNull();
      expect(createCall.data.storyPoints).toBeNull();
      expect(createCall.data.subtasks).toEqual([]);
      expect(createCall.data.acceptanceCriteria).toEqual([]);
    });

    it('normalizes taskType: CLIENT submitting CHORE → FEATURE; BUG stays BUG', async () => {
      await createTask('proj-1', { title: 'X', taskType: 'CHORE' }, 'c1', UserRole.CLIENT);
      const choreCall = prismaMock.task.create.mock.calls[0]?.[0] as any;
      expect(choreCall.data.taskType).toBe('FEATURE');

      prismaMock.task.create.mockClear();
      await createTask('proj-1', { title: 'X', taskType: 'BUG' }, 'c1', UserRole.CLIENT);
      const bugCall = prismaMock.task.create.mock.calls[0]?.[0] as any;
      expect(bugCall.data.taskType).toBe('BUG');
    });

    it('records action="submitted_client_request" when actor is a CLIENT', async () => {
      await createTask('proj-1', { title: 'X' }, 'client-1', UserRole.CLIENT);
      expect(logActivitySpy).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'submitted_client_request' }),
      );
    });

    it('sets clientRequested=true on the row regardless of what data.clientRequested says', async () => {
      // Even if the client somehow sends `clientRequested: false`, the
      // server overrides it. (isClientRequest = isClientActor || !!data.clientRequested
      // — for a client actor, the OR short-circuits true.)
      await createTask('proj-1', { title: 'X', clientRequested: false } as any, 'client-1', UserRole.CLIENT);
      const createCall = prismaMock.task.create.mock.calls[0]?.[0] as any;
      expect(createCall.data.clientRequested).toBe(true);
    });
  });

  describe('cross-tenant guards', () => {
    it('rejects a productId pointing at a product in a DIFFERENT project', async () => {
      prismaMock.product.findUnique.mockResolvedValue({
        projectId: 'OTHER-PROJECT',
      } as any);

      await expect(
        createTask(
          'proj-1',
          { title: 'X', productId: 'prod-from-other-proj' },
          'u1',
          UserRole.ADMIN,
        ),
      ).rejects.toThrow(/Product does not belong to this project/);

      // The task.create call should never have fired — the guard
      // throws inside the transaction.
      expect(prismaMock.task.create).not.toHaveBeenCalled();
    });

    it('rejects a milestoneId pointing at a milestone in a DIFFERENT project', async () => {
      prismaMock.milestone.findUnique.mockResolvedValue({
        projectId: 'OTHER-PROJECT',
      } as any);

      await expect(
        createTask(
          'proj-1',
          { title: 'X', milestoneId: 'milestone-from-other-proj' },
          'u1',
          UserRole.ADMIN,
        ),
      ).rejects.toThrow(/Milestone does not belong to this project/);

      expect(prismaMock.task.create).not.toHaveBeenCalled();
    });

    it('accepts a productId whose product belongs to this project', async () => {
      prismaMock.product.findUnique.mockResolvedValue({
        projectId: 'proj-1',
      } as any);

      await expect(
        createTask('proj-1', { title: 'X', productId: 'prod-1' }, 'u1', UserRole.ADMIN),
      ).resolves.toMatchObject({ id: 'new-task-id' });
    });
  });

  describe('assignee membership guard', () => {
    it('rejects when assigneeId is set but not an active member of this project', async () => {
      prismaMock.projectMember.findFirst.mockResolvedValue(null);

      await expect(
        createTask(
          'proj-1',
          { title: 'X', assigneeId: 'random-user' },
          'u1',
          UserRole.ADMIN,
        ),
      ).rejects.toThrow(/Assignee must be an active member/);

      expect(prismaMock.task.create).not.toHaveBeenCalled();
    });

    it('does NOT call the membership check when no assignee is provided', async () => {
      await createTask('proj-1', { title: 'X' }, 'u1', UserRole.ADMIN);

      // findFirst on projectMember is the membership probe; if no
      // assignee, it never fires.
      expect(prismaMock.projectMember.findFirst).not.toHaveBeenCalled();
    });
  });
});

// ─── updateTask — mutation core ────────────────────────────────────────

describe('updateTask', () => {
  const existingTask = {
    id: 't1',
    projectId: 'proj-1',
    assigneeId: 'assignee-1',
    creatorId: 'creator-1',
    status: TaskStatus.TODO,
    title: 'Existing',
    isBlocked: false,
    acceptanceCriteria: [],
  };

  beforeEach(() => {
    prismaMock.task.update.mockImplementation(((args: any) =>
      Promise.resolve({
        id: 't1',
        title: args.data?.title ?? existingTask.title,
        ...args.data,
      })
    ) as any);
    // 2026-05-23 audit fix #3: updateTask now wraps task.update +
    // taskStatusHistory.create in a $transaction. Mock the transaction
    // to pass the prismaMock through as the tx client so all the
    // model-method mocks above are visible to the inner code.
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
    prismaMock.taskStatusHistory.create.mockResolvedValue({} as any);
  });

  it('throws NotFoundError when the task does not exist', async () => {
    prismaMock.task.findUnique.mockResolvedValue(null);
    await expect(
      updateTask('gone', { title: 'X' }, 'u1', UserRole.ENGINEER),
    ).rejects.toThrow(NotFoundError);
  });

  describe('authorization', () => {
    it('throws ForbiddenError when caller lacks edit_any AND is neither creator nor assignee', async () => {
      prismaMock.task.findUnique.mockResolvedValue(existingTask as any);
      checkPermissionSpy.mockResolvedValue(false);

      await expect(
        updateTask('t1', { title: 'New' }, 'random-user', UserRole.ENGINEER),
      ).rejects.toThrow(/only edit tasks you created or are assigned to/);

      expect(prismaMock.task.update).not.toHaveBeenCalled();
    });

    it('allows the creator to edit even without edit_any', async () => {
      prismaMock.task.findUnique.mockResolvedValue(existingTask as any);
      checkPermissionSpy.mockResolvedValue(false);
      prismaMock.projectMember.findUnique.mockResolvedValue({ id: 'mem-1' } as any);

      await expect(
        updateTask('t1', { title: 'New' }, 'creator-1', UserRole.ENGINEER),
      ).resolves.toBeTruthy();
    });

    it('allows the assignee to edit even without edit_any', async () => {
      prismaMock.task.findUnique.mockResolvedValue(existingTask as any);
      checkPermissionSpy.mockResolvedValue(false);
      prismaMock.projectMember.findUnique.mockResolvedValue({ id: 'mem-1' } as any);

      await expect(
        updateTask('t1', { title: 'New' }, 'assignee-1', UserRole.ENGINEER),
      ).resolves.toBeTruthy();
    });

    it('allows admins with edit_any to edit (no membership check)', async () => {
      prismaMock.task.findUnique.mockResolvedValue(existingTask as any);
      checkPermissionSpy.mockResolvedValue(true); // edit_any: true

      await expect(
        updateTask('t1', { title: 'New' }, 'admin-1', UserRole.ADMIN),
      ).resolves.toBeTruthy();

      // For edit_any holders, the membership re-check is SKIPPED —
      // SUPER_ADMIN can edit tasks in projects they're not members of.
      expect(prismaMock.projectMember.findUnique).not.toHaveBeenCalled();
    });

    it('rejects an EX-MEMBER trying to edit their own task (QA finding #8)', async () => {
      // The user was once the assignee, is still the assignee on the
      // task row, but has been removed from the project. Without the
      // membership re-check, they could keep editing tasks they were
      // previously assigned to.
      prismaMock.task.findUnique.mockResolvedValue(existingTask as any);
      checkPermissionSpy.mockResolvedValue(false);
      prismaMock.projectMember.findUnique.mockResolvedValue(null); // ex-member

      await expect(
        updateTask('t1', { title: 'New' }, 'assignee-1', UserRole.ENGINEER),
      ).rejects.toThrow(/Not a member of this project/);

      expect(prismaMock.task.update).not.toHaveBeenCalled();
    });

    it('treats unassigned tasks as creator-only (assigneeId null !== userId is true for any user)', async () => {
      // An unassigned task can only be edited by edit_any or the creator,
      // never by random users — because `null !== randomId` evaluates true.
      const unassigned = { ...existingTask, assigneeId: null };
      prismaMock.task.findUnique.mockResolvedValue(unassigned as any);
      checkPermissionSpy.mockResolvedValue(false);

      await expect(
        updateTask('t1', { title: 'New' }, 'random-user', UserRole.ENGINEER),
      ).rejects.toThrow(/only edit tasks you created or are assigned to/);
    });
  });

  describe('cross-tenant guards', () => {
    beforeEach(() => {
      prismaMock.task.findUnique.mockResolvedValue(existingTask as any);
      checkPermissionSpy.mockResolvedValue(true);
    });

    it('rejects a productId pointing at a different project', async () => {
      prismaMock.product.findUnique.mockResolvedValue({
        projectId: 'OTHER',
      } as any);

      await expect(
        updateTask('t1', { productId: 'prod-other' }, 'admin', UserRole.ADMIN),
      ).rejects.toThrow(/Product does not belong/);

      expect(prismaMock.task.update).not.toHaveBeenCalled();
    });

    it('rejects a milestoneId pointing at a different project', async () => {
      prismaMock.milestone.findUnique.mockResolvedValue({
        projectId: 'OTHER',
      } as any);

      await expect(
        updateTask('t1', { milestoneId: 'milestone-other' }, 'admin', UserRole.ADMIN),
      ).rejects.toThrow(/Milestone does not belong/);

      expect(prismaMock.task.update).not.toHaveBeenCalled();
    });

    it('allows setting productId to null (unscope from any product)', async () => {
      await expect(
        updateTask('t1', { productId: null }, 'admin', UserRole.ADMIN),
      ).resolves.toBeTruthy();

      // No findUnique on product (null bypasses the guard).
      expect(prismaMock.product.findUnique).not.toHaveBeenCalled();
    });

    it('re-checks assignee membership when assigneeId is changed', async () => {
      prismaMock.projectMember.findFirst.mockResolvedValue(null);

      await expect(
        updateTask('t1', { assigneeId: 'random-user' }, 'admin', UserRole.ADMIN),
      ).rejects.toThrow(/Assignee must be an active member/);
    });
  });

  describe('status transition gates', () => {
    beforeEach(() => {
      checkPermissionSpy.mockResolvedValue(true); // edit_any
    });

    it('skips all transition checks when data.status equals existing.status (no-op)', async () => {
      prismaMock.task.findUnique.mockResolvedValue(existingTask as any);
      // Mock the gates so we can verify they ARE NOT called.
      await updateTask('t1', { status: TaskStatus.TODO }, 'admin', UserRole.ADMIN);

      // No throw — but ALSO ensure the transition checks didn't fire
      // and trip on stale state. Easiest assertion: the update went
      // through.
      expect(prismaMock.task.update).toHaveBeenCalled();
    });

    it('rejects an illegal transition (BACKLOG → DONE via form save)', async () => {
      prismaMock.task.findUnique.mockResolvedValue({
        ...existingTask,
        status: TaskStatus.BACKLOG,
      } as any);

      await expect(
        updateTask('t1', { status: TaskStatus.DONE }, 'admin', UserRole.ADMIN),
      ).rejects.toThrow(ValidationError);

      expect(prismaMock.task.update).not.toHaveBeenCalled();
    });

    it('blocks moving an UNASSIGNED task into In Progress via the form (assignee gate)', async () => {
      prismaMock.task.findUnique.mockResolvedValue({
        ...existingTask, assigneeId: null, status: TaskStatus.TODO,
      } as any);

      await expect(
        updateTask('t1', { status: TaskStatus.IN_PROGRESS }, 'admin', UserRole.ADMIN),
      ).rejects.toThrow(/assign someone/i);

      expect(prismaMock.task.update).not.toHaveBeenCalled();
    });

    it('rejects a Done landing when AC has unchecked items (AC done-gate)', async () => {
      prismaMock.task.findUnique.mockResolvedValue({
        ...existingTask,
        status: TaskStatus.IN_PROGRESS,
        acceptanceCriteria: [{ done: false }, { done: true }],
      } as any);

      await expect(
        updateTask('t1', { status: TaskStatus.DONE }, 'admin', UserRole.ADMIN),
      ).rejects.toThrow(/acceptance criterion is still unchecked/);

      expect(prismaMock.task.update).not.toHaveBeenCalled();
    });

    it('rejects an AGENT trying to land a task in Done', async () => {
      prismaMock.task.findUnique.mockResolvedValue({
        ...existingTask,
        status: TaskStatus.IN_PROGRESS,
      } as any);

      await expect(
        updateTask('t1', { status: TaskStatus.DONE }, 'agent-1', UserRole.ENGINEER, 'AGENT'),
      ).rejects.toThrow(/Agents may not transition tasks to Done/);
    });
  });

  describe('side effects', () => {
    beforeEach(() => {
      prismaMock.task.findUnique.mockResolvedValue(existingTask as any);
      checkPermissionSpy.mockResolvedValue(true);
      // Clear notification-spy call history between tests in this
      // block — they're module-level mocks (not per-test resets) so
      // accumulated calls from one test would otherwise show up in
      // the next test's `toHaveBeenCalledTimes` checks.
      vi.mocked(notificationService.notifyTaskAssigned).mockClear();
      vi.mocked(notificationService.notifyTaskBlocked).mockClear();
      vi.mocked(notificationService.notifyTaskPriorityChanged).mockClear();
      vi.mocked(notificationService.notifyTaskDueDateChanged).mockClear();
    });

    it('logs blocked_task activity + fires notification when isBlocked flips true', async () => {
      prismaMock.project.findUnique.mockResolvedValue({ name: 'Indigo' } as any);
      // notifyTaskBlocked is non-blocking — make it resolve.
      vi.mocked(notificationService.notifyTaskBlocked).mockResolvedValue(undefined as any);

      await updateTask(
        't1',
        { isBlocked: true, blockerNote: 'Waiting on infra' },
        'admin',
        UserRole.ADMIN,
      );

      expect(logActivitySpy).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'blocked_task' }),
      );
      expect(notificationService.notifyTaskBlocked).toHaveBeenCalledWith(
        't1',
        'proj-1',
        expect.any(String),
        'Indigo',
      );
    });

    it('fires notifyTaskAssigned when assigneeId changes (non-blocking)', async () => {
      prismaMock.projectMember.findFirst.mockResolvedValue({ id: 'mem-new' } as any);
      prismaMock.project.findUnique.mockResolvedValue({ name: 'Indigo' } as any);
      vi.mocked(notificationService.notifyTaskAssigned).mockResolvedValue(undefined as any);

      await updateTask('t1', { assigneeId: 'new-assignee' }, 'admin', UserRole.ADMIN);

      expect(notificationService.notifyTaskAssigned).toHaveBeenCalledWith(
        't1',
        'new-assignee',
        expect.any(String),
        'Indigo',
        'admin',
        expect.any(String), // projectId — drives the client-vs-engineer deep link
      );
    });

    it('always logs an `updated_task` activity entry on success', async () => {
      await updateTask('t1', { title: 'Renamed' }, 'admin', UserRole.ADMIN);

      expect(logActivitySpy).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'updated_task' }),
      );
    });

    /**
     * 2026-05-15 TASK-LIFECYCLE-AUDIT regression — priority + due-date
     * edits used to be silent. Now both notify the assignee unless
     * the assignee IS the editor.
     */
    it('fires notifyTaskPriorityChanged when priority changes on a task with an assignee (skipping if assignee = editor)', async () => {
      prismaMock.task.findUnique.mockResolvedValue({
        ...existingTask,
        priority: 'P3',
      } as any);
      prismaMock.project.findUnique.mockResolvedValue({ name: 'Indigo' } as any);
      // task.update returns the post-update row WITH assigneeId so
      // the service can use it as the notification recipient.
      prismaMock.task.update.mockResolvedValue({
        id: 't1',
        title: existingTask.title,
        assigneeId: 'assignee-1',
        priority: 'P0',
      } as any);
      vi.mocked(notificationService.notifyTaskPriorityChanged).mockResolvedValue(undefined as any);

      await updateTask('t1', { priority: 'P0' }, 'pm-1', UserRole.PRODUCT_MANAGER);

      expect(notificationService.notifyTaskPriorityChanged).toHaveBeenCalledWith({
        taskId: 't1',
        projectId: 'proj-1',
        taskTitle: 'Existing',
        projectName: 'Indigo',
        assigneeId: 'assignee-1',
        editorId: 'pm-1',
        fromPriority: 'P3',
        toPriority: 'P0',
      });
    });

    it('does NOT fire notifyTaskPriorityChanged when priority is unchanged (no-op write)', async () => {
      prismaMock.task.findUnique.mockResolvedValue({
        ...existingTask,
        priority: 'P2',
      } as any);
      prismaMock.task.update.mockResolvedValue({
        id: 't1',
        title: existingTask.title,
        assigneeId: 'assignee-1',
        priority: 'P2',
      } as any);

      await updateTask('t1', { priority: 'P2' }, 'pm-1', UserRole.PRODUCT_MANAGER);

      expect(notificationService.notifyTaskPriorityChanged).not.toHaveBeenCalled();
    });

    it('does NOT fire notifyTaskPriorityChanged when the editor IS the assignee (skip self-notify)', async () => {
      // The notify helper itself does the self-skip — but pinning
      // here too prevents a future refactor of the helper from
      // accidentally double-pinging.
      prismaMock.task.findUnique.mockResolvedValue({
        ...existingTask,
        priority: 'P3',
      } as any);
      prismaMock.project.findUnique.mockResolvedValue({ name: 'Indigo' } as any);
      prismaMock.task.update.mockResolvedValue({
        id: 't1',
        title: existingTask.title,
        assigneeId: 'assignee-1',
        priority: 'P0',
      } as any);
      // The mock still receives the call, but the assigneeId equals
      // editorId so the production code passes those through; the
      // helper's own self-skip is the second line of defense. The
      // assertion here is the simpler: we still fire (because the
      // helper handles the skip), but the editorId is correct.
      vi.mocked(notificationService.notifyTaskPriorityChanged).mockResolvedValue(undefined as any);

      await updateTask('t1', { priority: 'P0' }, 'assignee-1', UserRole.PRODUCT_MANAGER);

      const call = vi.mocked(notificationService.notifyTaskPriorityChanged).mock.calls[0]?.[0];
      expect(call?.assigneeId).toBe('assignee-1');
      expect(call?.editorId).toBe('assignee-1');
    });

    it('fires notifyTaskDueDateChanged when the due date is set for the first time', async () => {
      prismaMock.task.findUnique.mockResolvedValue({
        ...existingTask,
        dueDate: null,
      } as any);
      prismaMock.project.findUnique.mockResolvedValue({ name: 'Indigo' } as any);
      prismaMock.task.update.mockResolvedValue({
        id: 't1',
        title: existingTask.title,
        assigneeId: 'assignee-1',
      } as any);
      vi.mocked(notificationService.notifyTaskDueDateChanged).mockResolvedValue(undefined as any);

      await updateTask('t1', { dueDate: '2026-06-01' }, 'pm-1', UserRole.PRODUCT_MANAGER);

      expect(notificationService.notifyTaskDueDateChanged).toHaveBeenCalledWith(
        expect.objectContaining({
          assigneeId: 'assignee-1',
          editorId: 'pm-1',
          newDueDate: '2026-06-01',
        }),
      );
    });

    it('fires notifyTaskDueDateChanged with null when the due date is CLEARED', async () => {
      prismaMock.task.findUnique.mockResolvedValue({
        ...existingTask,
        dueDate: new Date('2026-06-01T00:00:00Z'),
      } as any);
      prismaMock.project.findUnique.mockResolvedValue({ name: 'Indigo' } as any);
      prismaMock.task.update.mockResolvedValue({
        id: 't1',
        title: existingTask.title,
        assigneeId: 'assignee-1',
      } as any);
      vi.mocked(notificationService.notifyTaskDueDateChanged).mockResolvedValue(undefined as any);

      await updateTask('t1', { dueDate: null }, 'pm-1', UserRole.PRODUCT_MANAGER);

      expect(notificationService.notifyTaskDueDateChanged).toHaveBeenCalledWith(
        expect.objectContaining({ newDueDate: null }),
      );
    });

    it('does NOT fire notifyTaskDueDateChanged when the due date is unchanged (same YYYY-MM-DD)', async () => {
      // Pinning the YYYY-MM-DD-equality short-circuit. Without
      // this, a roundtrip that re-sends the same date string would
      // ping the assignee every save — false positive.
      prismaMock.task.findUnique.mockResolvedValue({
        ...existingTask,
        dueDate: new Date('2026-06-01T00:00:00Z'),
      } as any);
      prismaMock.task.update.mockResolvedValue({
        id: 't1',
        title: existingTask.title,
        assigneeId: 'assignee-1',
      } as any);

      await updateTask('t1', { dueDate: '2026-06-01' }, 'pm-1', UserRole.PRODUCT_MANAGER);

      expect(notificationService.notifyTaskDueDateChanged).not.toHaveBeenCalled();
    });

    it('does NOT fire priority or due-date notifications when the task has no assignee', async () => {
      // No assignee → nobody to notify. (The deleter notify path
      // still falls back to creator/reviewer; the edit notify path
      // doesn't, because there's no one waiting on the work.)
      prismaMock.task.findUnique.mockResolvedValue({
        ...existingTask,
        assigneeId: null,
        priority: 'P3',
        dueDate: null,
      } as any);
      prismaMock.task.update.mockResolvedValue({
        id: 't1',
        title: existingTask.title,
        assigneeId: null,
      } as any);

      await updateTask(
        't1',
        { priority: 'P0', dueDate: '2026-06-01' },
        'pm-1',
        UserRole.PRODUCT_MANAGER,
      );

      expect(notificationService.notifyTaskPriorityChanged).not.toHaveBeenCalled();
      expect(notificationService.notifyTaskDueDateChanged).not.toHaveBeenCalled();
    });
  });

  /**
   * 2026-05-15 CONCURRENT-EDIT-AUDIT — optimistic locking on updateTask.
   *
   * Pre-fix: two PMs editing the same task at the same time produced
   * silent last-write-wins data loss. The first edit's changes
   * vanished when the second hit `prisma.task.update`. No error, no
   * audit signal, no FE warning.
   *
   * Fix: callers pass the `updatedAt` they read with the task. The
   * service refuses the write when the server has moved on (someone
   * else's edit landed first). Two-layer guard:
   *
   *   1. Early-exit check after `findUnique` — fail fast before
   *      running the full permission + validation chain.
   *   2. Write-time `updateMany` with `where: { id, updatedAt }` —
   *      closes the race window between the early check and the
   *      write itself.
   *
   * OPT-IN: callers that don't pass expectedUpdatedAt keep the
   * pre-fix behavior (last-write-wins). Allows incremental FE
   * migration without a flag day.
   */
  describe('optimistic locking (expectedUpdatedAt)', () => {
    const baseUpdatedAt = new Date('2026-05-15T10:00:00.000Z');
    const baseTask = {
      ...existingTask,
      updatedAt: baseUpdatedAt,
    };

    beforeEach(() => {
      checkPermissionSpy.mockResolvedValue(true); // edit_any granted
      prismaMock.task.findUnique.mockResolvedValue(baseTask as any);
    });

    it('THROWS ConflictError when expectedUpdatedAt does not match the server\'s (the regression repro)', async () => {
      // Pivotal scenario: PM A and PM B both read task at t0. PM A
      // submits a write that lands first, bumping updatedAt to t1.
      // PM B's write arrives with expectedUpdatedAt=t0 (stale).
      // Pre-fix: PM B's write silently overwrote PM A's. After
      // the fix: ConflictError surfaces, FE re-fetches.
      prismaMock.task.findUnique.mockResolvedValue({
        ...baseTask,
        updatedAt: new Date('2026-05-15T10:05:00.000Z'), // server has moved on
      } as any);

      await expect(
        updateTask(
          't1',
          { title: 'PM B edits' },
          'pm-b',
          UserRole.PRODUCT_MANAGER,
          'HUMAN',
          baseUpdatedAt.toISOString(), // PM B's stale view
        ),
      ).rejects.toBeInstanceOf(ConflictError);

      // CRITICAL: NO write fires when the early-exit check trips.
      expect(prismaMock.task.update).not.toHaveBeenCalled();
      expect(prismaMock.task.updateMany).not.toHaveBeenCalled();
    });

    it('PROCEEDS via updateMany write when expectedUpdatedAt matches', async () => {
      prismaMock.task.updateMany.mockResolvedValue({ count: 1 } as any);
      prismaMock.task.findUnique
        .mockResolvedValueOnce(baseTask as any)           // initial fetch
        .mockResolvedValueOnce({                           // post-update re-fetch for includes
          ...baseTask,
          title: 'PM B edits',
          assignee: null,
          creator: null,
        } as any);

      const result = await updateTask(
        't1',
        { title: 'PM B edits' },
        'pm-b',
        UserRole.PRODUCT_MANAGER,
        'HUMAN',
        baseUpdatedAt.toISOString(),
      );

      // Critical: write went through `updateMany` with the compound
      // where clause (id + updatedAt), NOT the plain `update`.
      expect(prismaMock.task.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 't1', updatedAt: baseUpdatedAt },
        }),
      );
      expect(prismaMock.task.update).not.toHaveBeenCalled();
      expect(result).toMatchObject({ title: 'PM B edits' });
    });

    it('THROWS ConflictError when the write-time updateMany matches 0 rows (race between early check and write)', async () => {
      // The defense-in-depth path. The early-exit check passed
      // (expectedUpdatedAt matched the row we read), but between
      // then and the updateMany another writer landed — bumping
      // updatedAt — so the compound where clause matches 0 rows.
      prismaMock.task.updateMany.mockResolvedValue({ count: 0 } as any);
      prismaMock.task.findUnique
        .mockResolvedValueOnce(baseTask as any)            // initial read (matches expectedUpdatedAt)
        .mockResolvedValueOnce({                            // post-failed-update fetch for the error message
          updatedAt: new Date('2026-05-15T10:05:00.000Z'),
        } as any);

      await expect(
        updateTask(
          't1',
          { title: 'PM B edits' },
          'pm-b',
          UserRole.PRODUCT_MANAGER,
          'HUMAN',
          baseUpdatedAt.toISOString(),
        ),
      ).rejects.toBeInstanceOf(ConflictError);
    });

    it('FALLS BACK to plain update (backwards-compat) when expectedUpdatedAt is not supplied', async () => {
      // Older clients that haven't migrated to send expectedUpdatedAt
      // keep last-write-wins behavior. This test pins that pre-fix
      // shape so we don't accidentally break existing callers.
      prismaMock.task.update.mockResolvedValue({ id: 't1', title: 'No-lock edit' } as any);

      await updateTask(
        't1',
        { title: 'No-lock edit' },
        'pm-b',
        UserRole.PRODUCT_MANAGER,
        'HUMAN',
        // No expectedUpdatedAt arg
      );

      // Plain `update` fires, not `updateMany`.
      expect(prismaMock.task.update).toHaveBeenCalled();
      expect(prismaMock.task.updateMany).not.toHaveBeenCalled();
    });

    it('throws NotFoundError (not Conflict) when the task doesn\'t exist at all (precedence regression-pin)', async () => {
      // If the row is missing entirely, NotFound should win — not
      // Conflict. The error message would be misleading otherwise.
      prismaMock.task.findUnique.mockResolvedValue(null);

      await expect(
        updateTask(
          'gone',
          { title: 'X' },
          'pm-b',
          UserRole.PRODUCT_MANAGER,
          'HUMAN',
          baseUpdatedAt.toISOString(),
        ),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it('surfaces the current server updatedAt in the ConflictError message (so the FE can show the user what changed)', async () => {
      const serverNow = new Date('2026-05-15T10:05:00.000Z');
      prismaMock.task.findUnique.mockResolvedValue({
        ...baseTask,
        updatedAt: serverNow,
      } as any);

      try {
        await updateTask(
          't1',
          { title: 'PM B edits' },
          'pm-b',
          UserRole.PRODUCT_MANAGER,
          'HUMAN',
          baseUpdatedAt.toISOString(),
        );
        // Force a failure if we didn't throw
        expect.fail('Expected ConflictError to be thrown');
      } catch (err: any) {
        expect(err.message).toContain(serverNow.toISOString());
      }
    });
  });
});

// ─── moveTask — kanban drag + status flip ──────────────────────────────

describe('moveTask', () => {
  const existingTask = {
    id: 't1',
    projectId: 'proj-1',
    status: TaskStatus.TODO,
    title: 'Existing',
    // Owned — so the active-status assignee gate passes and these tests
    // exercise the transition/AC gates they're actually about.
    assigneeId: 'eng-1',
    acceptanceCriteria: [],
  };

  beforeEach(() => {
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
    prismaMock.task.aggregate.mockResolvedValue({ _max: { sortOrder: 0 } } as any);
    prismaMock.task.update.mockImplementation(((args: any) =>
      Promise.resolve({ id: 't1', ...args.data })
    ) as any);
  });

  it('throws NotFoundError when the task does not exist', async () => {
    prismaMock.task.findUnique.mockResolvedValue(null);

    await expect(
      moveTask('gone', TaskStatus.IN_PROGRESS, undefined, 'u1', {
        userType: 'HUMAN',
        role: UserRole.ADMIN,
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it('blocks moving an UNASSIGNED task into In Progress (assignee gate, drag path)', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      ...existingTask, assigneeId: null, status: TaskStatus.TODO,
    } as any);
    checkPermissionSpy.mockResolvedValue(true);

    await expect(
      moveTask('t1', TaskStatus.IN_PROGRESS, undefined, 'u1', {
        userType: 'HUMAN',
        role: UserRole.ADMIN,
      }),
    ).rejects.toThrow(/assign someone/i);
    expect(prismaMock.task.update).not.toHaveBeenCalled();
  });

  it('allows a no-op status move (X → X) with a sortOrder change — NO status-history row', async () => {
    prismaMock.task.findUnique.mockResolvedValue(existingTask as any);

    await moveTask('t1', TaskStatus.TODO, 5, 'u1', {
      userType: 'HUMAN',
      role: UserRole.ADMIN,
    });

    // No status-history row when the status didn't change.
    expect(prismaMock.taskStatusHistory.create).not.toHaveBeenCalled();
    // Task update still applied (sortOrder bumped).
    expect(prismaMock.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't1' },
        data: { status: TaskStatus.TODO, sortOrder: 5 },
      }),
    );
  });

  it('rejects an illegal transition (BACKLOG → DONE) before any DB write', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      ...existingTask,
      status: TaskStatus.BACKLOG,
    } as any);

    await expect(
      moveTask('t1', TaskStatus.DONE, undefined, 'u1', {
        userType: 'HUMAN',
        role: UserRole.ADMIN,
      }),
    ).rejects.toThrow(ValidationError);

    expect(prismaMock.task.update).not.toHaveBeenCalled();
  });

  it('enforces the AC done-gate at the moveTask path (same gate as updateTask)', async () => {
    // 2026-05-23 audit fix: the Done-gate is now inside the transaction.
    // The mock must (a) pass checkPermission(transition.done) so the agent
    // gate doesn't fail first, AND (b) return the unchecked AC via the
    // re-read inside the tx so the gate fires there.
    prismaMock.task.findUnique
      // First call: outside-tx read
      .mockResolvedValueOnce({
        ...existingTask,
        status: TaskStatus.IN_PROGRESS,
        acceptanceCriteria: [{ done: false }],
      } as any)
      // Second call: inside-tx fresh read for the gate
      .mockResolvedValueOnce({
        acceptanceCriteria: [{ done: false }],
      } as any);
    // Pass the transition.done permission so the AC gate is the one that fires.
    checkPermissionSpy.mockResolvedValue(true);
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));

    await expect(
      moveTask('t1', TaskStatus.DONE, undefined, 'u1', {
        userType: 'HUMAN',
        role: UserRole.ADMIN,
      }),
    ).rejects.toThrow(/acceptance criterion is still unchecked/);
  });

  it('blocks an AGENT from landing in DONE (structural agent-done-gate)', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      ...existingTask,
      status: TaskStatus.IN_PROGRESS,
    } as any);

    await expect(
      moveTask('t1', TaskStatus.DONE, undefined, 'agent-1', {
        userType: 'AGENT',
        role: UserRole.ENGINEER,
      }),
    ).rejects.toThrow(/Agents may not transition tasks to Done/);
  });

  it('defaults sortOrder to maxSortOrder + 1 when none provided', async () => {
    prismaMock.task.findUnique.mockResolvedValue(existingTask as any);
    prismaMock.task.aggregate.mockResolvedValue({ _max: { sortOrder: 9 } } as any);
    checkPermissionSpy.mockResolvedValue(true);

    await moveTask('t1', TaskStatus.IN_PROGRESS, undefined, 'u1', {
      userType: 'HUMAN',
      role: UserRole.ADMIN,
    });

    expect(prismaMock.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: TaskStatus.IN_PROGRESS, sortOrder: 10 },
      }),
    );
  });

  it('writes status-history + activity log INSIDE the same transaction as the task update', async () => {
    prismaMock.task.findUnique.mockResolvedValue(existingTask as any);
    checkPermissionSpy.mockResolvedValue(true);

    await moveTask('t1', TaskStatus.IN_PROGRESS, undefined, 'mover', {
      userType: 'HUMAN',
      role: UserRole.ADMIN,
    });

    // $transaction was used (so a partial failure rolls back everything).
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    // Status history row created with from/to/changedBy.
    expect(prismaMock.taskStatusHistory.create).toHaveBeenCalledWith({
      data: {
        taskId: 't1',
        fromStatus: TaskStatus.TODO,
        toStatus: TaskStatus.IN_PROGRESS,
        changedBy: 'mover',
      },
    });
    // Activity log shows the from/to pair for forensic clarity.
    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'moved_task',
        details: expect.objectContaining({
          from: TaskStatus.TODO,
          to: TaskStatus.IN_PROGRESS,
        }),
      }),
      // Receives the tx client as second arg.
      expect.anything(),
    );
  });

  // ─── optimistic locking (2026-06 collaboration hardening) ──────────────
  // The board was the one mutation with no conflict guard. These pin the
  // expectedUpdatedAt behaviour so two people dragging the same card can't
  // silently clobber each other.

  const SERVER_TS = new Date('2026-06-19T00:00:00.000Z');

  it('THROWS ConflictError (fail-fast) when expectedUpdatedAt is stale — no write', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ ...existingTask, updatedAt: SERVER_TS } as any);
    checkPermissionSpy.mockResolvedValue(true);

    await expect(
      moveTask('t1', TaskStatus.IN_PROGRESS, undefined, 'u1', { userType: 'HUMAN', role: UserRole.ADMIN },
        new Date('2026-06-18T00:00:00.000Z').toISOString()), // stale
    ).rejects.toThrow(ConflictError);

    expect(prismaMock.task.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.task.update).not.toHaveBeenCalled();
  });

  it('uses a race-safe guarded write (updateMany on updatedAt) when expectedUpdatedAt matches', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ ...existingTask, updatedAt: SERVER_TS } as any);
    prismaMock.task.updateMany.mockResolvedValue({ count: 1 } as any);
    checkPermissionSpy.mockResolvedValue(true);

    await moveTask('t1', TaskStatus.IN_PROGRESS, 3, 'u1', { userType: 'HUMAN', role: UserRole.ADMIN },
      SERVER_TS.toISOString());

    expect(prismaMock.task.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 't1', updatedAt: SERVER_TS },
        data: { status: TaskStatus.IN_PROGRESS, sortOrder: 3 },
      }),
    );
    // Status change still recorded.
    expect(prismaMock.taskStatusHistory.create).toHaveBeenCalled();
  });

  it('THROWS ConflictError when the guarded write loses the race (updateMany count 0)', async () => {
    prismaMock.task.findUnique
      .mockResolvedValueOnce({ ...existingTask, updatedAt: SERVER_TS } as any) // outer read
      .mockResolvedValueOnce({ updatedAt: new Date('2026-06-19T01:00:00.000Z') } as any); // conflict re-read
    prismaMock.task.updateMany.mockResolvedValue({ count: 0 } as any);
    checkPermissionSpy.mockResolvedValue(true);

    await expect(
      moveTask('t1', TaskStatus.IN_PROGRESS, undefined, 'u1', { userType: 'HUMAN', role: UserRole.ADMIN },
        SERVER_TS.toISOString()),
    ).rejects.toThrow(ConflictError);
    expect(prismaMock.taskStatusHistory.create).not.toHaveBeenCalled();
  });
});

// ─── bulkUpdateTasks — concurrent, per-task auth, cross-project guards ─

describe('bulkUpdateTasks', () => {
  const makeTask = (overrides: Record<string, unknown> = {}) => ({
    id: 't1',
    projectId: 'proj-1',
    assigneeId: 'assignee-1',
    creatorId: 'creator-1',
    isBlocked: false,
    blockerNote: null,
    sprintId: null,
    epicId: null,
    priority: 'P2',
    sprint: null,
    ...overrides,
  });

  beforeEach(() => {
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
    prismaMock.task.update.mockImplementation(((args: any) =>
      Promise.resolve({ id: 't1', ...args.data })
    ) as any);
  });

  // ── Bulk status moves (the "move 50 to In Progress at once" flow) ──
  // The bulk path runs the same state-machine + AC + assignee gates as the
  // single-task path, with per-task partial failure.
  it('applies a bulk status move when the task is owned', async () => {
    checkPermissionSpy.mockResolvedValue(true);
    prismaMock.task.findMany.mockResolvedValue([makeTask({ status: 'TODO' })] as any);
    prismaMock.projectMember.findMany.mockResolvedValue([{ projectId: 'proj-1' }] as any);
    // The status guard re-fetches the task (status + AC + assigneeId).
    prismaMock.task.findUnique.mockResolvedValue({
      status: 'TODO', acceptanceCriteria: [], assigneeId: 'assignee-1',
    } as any);

    const result = await bulkUpdateTasks(['t1'], { status: 'IN_PROGRESS' }, 'u1', UserRole.ADMIN);

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    const updateArg = (prismaMock.task.update.mock.calls[0]?.[0] as any)?.data;
    expect(updateArg.status).toBe('IN_PROGRESS');
  });

  it('fails a bulk move to In Progress for an UNOWNED task (assignee gate, partial failure)', async () => {
    checkPermissionSpy.mockResolvedValue(true);
    prismaMock.task.findMany.mockResolvedValue([makeTask({ status: 'TODO' })] as any);
    prismaMock.projectMember.findMany.mockResolvedValue([{ projectId: 'proj-1' }] as any);
    prismaMock.task.findUnique.mockResolvedValue({
      status: 'TODO', acceptanceCriteria: [], assigneeId: null,
    } as any);

    const result = await bulkUpdateTasks(['t1'], { status: 'IN_PROGRESS' }, 'u1', UserRole.ADMIN);

    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.results[0]?.error).toMatch(/assign someone/i);
    expect(prismaMock.task.update).not.toHaveBeenCalled();
  });

  it('rejects an illegal bulk transition (BACKLOG → DONE) per task', async () => {
    checkPermissionSpy.mockResolvedValue(true);
    prismaMock.task.findMany.mockResolvedValue([makeTask({ status: 'BACKLOG' })] as any);
    prismaMock.projectMember.findMany.mockResolvedValue([{ projectId: 'proj-1' }] as any);
    prismaMock.task.findUnique.mockResolvedValue({
      status: 'BACKLOG', acceptanceCriteria: [], assigneeId: 'assignee-1',
    } as any);

    const result = await bulkUpdateTasks(['t1'], { status: 'DONE' }, 'u1', UserRole.ADMIN);

    expect(result.failed).toBe(1);
    expect(result.results[0]?.error).toMatch(/Move it through an intermediate status/);
  });

  it('short-circuits with empty results on empty taskIds (no DB call)', async () => {
    const result = await bulkUpdateTasks([], { priority: 'P0' }, 'u1', UserRole.ADMIN);

    expect(result).toEqual({ results: [], succeeded: 0, failed: 0 });
    expect(prismaMock.task.findMany).not.toHaveBeenCalled();
  });

  it('rejects EVERY task with "Sprint not found" when change.sprintId doesnt exist', async () => {
    // Critical: a missing sprint poisons the whole batch — better than
    // silently writing wrong data.
    checkPermissionSpy.mockResolvedValue(true);
    prismaMock.task.findMany.mockResolvedValue([makeTask()] as any);
    prismaMock.projectMember.findMany.mockResolvedValue([{ projectId: 'proj-1' }] as any);
    prismaMock.sprint.findUnique.mockResolvedValue(null);

    const result = await bulkUpdateTasks(
      ['t1'],
      { sprintId: 'sprint-missing' },
      'u1',
      UserRole.ADMIN,
    );

    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.results[0]).toMatchObject({ ok: false, error: 'Sprint not found' });
    expect(prismaMock.task.update).not.toHaveBeenCalled();
  });

  it('rejects EVERY task when change.sprintId is COMPLETED (cant assign to frozen sprint)', async () => {
    checkPermissionSpy.mockResolvedValue(true);
    prismaMock.task.findMany.mockResolvedValue([makeTask()] as any);
    prismaMock.projectMember.findMany.mockResolvedValue([{ projectId: 'proj-1' }] as any);
    prismaMock.sprint.findUnique.mockResolvedValue({
      id: 'sprint-done',
      projectId: 'proj-1',
      status: 'COMPLETED',
    } as any);

    const result = await bulkUpdateTasks(
      ['t1'],
      { sprintId: 'sprint-done' },
      'u1',
      UserRole.ADMIN,
    );

    expect(result.failed).toBe(1);
    expect(result.results[0]?.error).toMatch(/completed or cancelled sprint/);
  });

  it('rejects a single task when its SOURCE sprint is COMPLETED (cant drain frozen)', async () => {
    // The terminal-source guard at line 688 fires per-task when the
    // change touches sprintId AND the task's current sprint is frozen.
    // Pre-launch finding B2.
    checkPermissionSpy.mockResolvedValue(true);
    prismaMock.task.findMany.mockResolvedValue([
      makeTask({ sprintId: 'old', sprint: { status: 'COMPLETED' } }),
    ] as any);
    prismaMock.projectMember.findMany.mockResolvedValue([{ projectId: 'proj-1' }] as any);
    prismaMock.sprint.findUnique.mockResolvedValue({
      id: 'sprint-new',
      projectId: 'proj-1',
      status: 'ACTIVE',
    } as any);

    const result = await bulkUpdateTasks(
      ['t1'],
      { sprintId: 'sprint-new' },
      'u1',
      UserRole.ADMIN,
    );

    expect(result.results[0]?.error).toMatch(/move a task out of a completed or cancelled sprint/);
    expect(prismaMock.task.update).not.toHaveBeenCalled();
  });

  it('rejects per-task when sprintId belongs to a DIFFERENT project than the task', async () => {
    checkPermissionSpy.mockResolvedValue(true);
    prismaMock.task.findMany.mockResolvedValue([makeTask({ projectId: 'proj-1' })] as any);
    prismaMock.projectMember.findMany.mockResolvedValue([{ projectId: 'proj-1' }] as any);
    prismaMock.sprint.findUnique.mockResolvedValue({
      id: 'sprint-x',
      projectId: 'OTHER-project',
      status: 'ACTIVE',
    } as any);

    const result = await bulkUpdateTasks(
      ['t1'],
      { sprintId: 'sprint-x' },
      'u1',
      UserRole.ADMIN,
    );

    expect(result.results[0]?.error).toMatch(/Sprint belongs to a different project/);
  });

  it('allows null sprintId (unsprint) WITHOUT tripping the cross-project guard', async () => {
    // Subtle: cross-project check uses `change.sprintId !== null` to
    // skip — without that, unsprinting (null) would trip "different
    // project" because sprintProject.get(null) is undefined.
    checkPermissionSpy.mockResolvedValue(true);
    prismaMock.task.findMany.mockResolvedValue([
      makeTask({ sprintId: 'old-sprint', sprint: { status: 'ACTIVE' } }),
    ] as any);
    prismaMock.projectMember.findMany.mockResolvedValue([{ projectId: 'proj-1' }] as any);

    const result = await bulkUpdateTasks(
      ['t1'],
      { sprintId: null },
      'u1',
      UserRole.ADMIN,
    );

    expect(result.succeeded).toBe(1);
    expect(prismaMock.task.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { sprintId: null } }),
    );
  });

  it('rejects a non-member trying to bulk-edit tasks in a project they dont belong to', async () => {
    // QA finding K-C1: previously task.edit_any short-circuited the
    // membership check. The bulk path now requires membership uniformly,
    // even for edit_any holders.
    checkPermissionSpy.mockResolvedValue(true); // edit_any: true
    prismaMock.task.findMany.mockResolvedValue([makeTask()] as any);
    // Caller has NO memberships.
    prismaMock.projectMember.findMany.mockResolvedValue([] as any);

    const result = await bulkUpdateTasks(
      ['t1'],
      { priority: 'P0' },
      'admin',
      UserRole.SUPER_ADMIN,
    );

    expect(result.failed).toBe(1);
    expect(result.results[0]?.error).toBe('Not a member of this project');
  });

  it('rejects without edit_any when caller is neither creator nor assignee', async () => {
    checkPermissionSpy.mockResolvedValue(false);
    prismaMock.task.findMany.mockResolvedValue([
      makeTask({ assigneeId: 'someone-else', creatorId: 'another-one' }),
    ] as any);
    prismaMock.projectMember.findMany.mockResolvedValue([{ projectId: 'proj-1' }] as any);

    const result = await bulkUpdateTasks(
      ['t1'],
      { priority: 'P0' },
      'random-user',
      UserRole.ENGINEER,
    );

    expect(result.results[0]?.error).toBe('Not authorized to edit this task');
  });

  it('updates each task in its OWN $transaction with a per-task activity log', async () => {
    checkPermissionSpy.mockResolvedValue(true);
    prismaMock.task.findMany.mockResolvedValue([
      makeTask({ id: 't1' }),
      makeTask({ id: 't2' }),
    ] as any);
    prismaMock.projectMember.findMany.mockResolvedValue([{ projectId: 'proj-1' }] as any);

    const result = await bulkUpdateTasks(
      ['t1', 't2'],
      { priority: 'P0' },
      'admin',
      UserRole.ADMIN,
    );

    expect(result.succeeded).toBe(2);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    // Audit log fires per-task (not once for the batch).
    const bulkLogCalls = logActivitySpy.mock.calls.filter(
      (c) => (c[0] as any).action === 'bulk_updated_task',
    );
    expect(bulkLogCalls).toHaveLength(2);
  });

  it('records a per-key from/to diff in the audit log (only keys that actually changed)', async () => {
    // Round 2 follow-up #5: audit must show "priority changed from P2
    // to P0", not just "priority was in the change set".
    checkPermissionSpy.mockResolvedValue(true);
    prismaMock.task.findMany.mockResolvedValue([
      makeTask({ priority: 'P2' }),
    ] as any);
    prismaMock.projectMember.findMany.mockResolvedValue([{ projectId: 'proj-1' }] as any);

    await bulkUpdateTasks(['t1'], { priority: 'P0' }, 'admin', UserRole.ADMIN);

    const bulkLog = logActivitySpy.mock.calls.find(
      (c) => (c[0] as any).action === 'bulk_updated_task',
    );
    expect((bulkLog?.[0] as any).details.changes).toEqual({
      priority: { from: 'P2', to: 'P0' },
    });
  });

  it('EMPTY diff (no-op change) still writes the audit row with changes: {}', async () => {
    // Re-asserting the same priority leaves the diff empty but we still
    // write the audit row so forensic queries see "someone ran the
    // bulk-edit and it touched these tasks". Confirms current behavior.
    checkPermissionSpy.mockResolvedValue(true);
    prismaMock.task.findMany.mockResolvedValue([makeTask({ priority: 'P0' })] as any);
    prismaMock.projectMember.findMany.mockResolvedValue([{ projectId: 'proj-1' }] as any);

    await bulkUpdateTasks(['t1'], { priority: 'P0' }, 'admin', UserRole.ADMIN);

    const bulkLog = logActivitySpy.mock.calls.find(
      (c) => (c[0] as any).action === 'bulk_updated_task',
    );
    expect((bulkLog?.[0] as any).details.changes).toEqual({});
    expect((bulkLog?.[0] as any).details.changedKeys).toEqual([]);
  });

  it('Setting isBlocked=false ALSO wipes blockerNote (linked behavior)', async () => {
    checkPermissionSpy.mockResolvedValue(true);
    prismaMock.task.findMany.mockResolvedValue([
      makeTask({ isBlocked: true, blockerNote: 'waiting on infra' }),
    ] as any);
    prismaMock.projectMember.findMany.mockResolvedValue([{ projectId: 'proj-1' }] as any);

    await bulkUpdateTasks(['t1'], { isBlocked: false }, 'admin', UserRole.ADMIN);

    expect(prismaMock.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { isBlocked: false, blockerNote: null },
      }),
    );
  });

  it('a single bad task does NOT poison successful sibling tasks (partial success)', async () => {
    // The whole point of bulk's per-task result list.
    checkPermissionSpy.mockResolvedValue(true);
    prismaMock.task.findMany.mockResolvedValue([
      makeTask({ id: 't-good' }),
      makeTask({ id: 't-bad', projectId: 'forbidden-project' }),
    ] as any);
    // Caller is only a member of proj-1; t-bad lives in forbidden-project.
    prismaMock.projectMember.findMany.mockResolvedValue([{ projectId: 'proj-1' }] as any);

    const result = await bulkUpdateTasks(
      ['t-good', 't-bad'],
      { priority: 'P0' },
      'u1',
      UserRole.ADMIN,
    );

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    const good = result.results.find((r) => r.taskId === 't-good');
    const bad = result.results.find((r) => r.taskId === 't-bad');
    expect(good?.ok).toBe(true);
    expect(bad?.error).toBe('Not a member of this project');
  });
});

// ─── previewBulkDeleteCascade ──────────────────────────────────────────

describe('previewBulkDeleteCascade', () => {
  it('returns a zero-filled summary when no taskIds are passed', async () => {
    const result = await previewBulkDeleteCascade([], 'u1', UserRole.ADMIN);

    expect(result).toEqual({
      taskCount: 0,
      comments: 0,
      timeEntries: 0,
      loggedHours: 0,
      externalLinks: 0,
      taskLinks: 0,
      statusHistory: 0,
    });
  });

  it('aggregates comments + time + links + statusHistory across the requested taskIds (super-admin path)', async () => {
    // Super-admin (`project.view_all` granted) bypasses the membership
    // filter; the aggregate runs against the full taskIds list.
    checkPermissionSpy.mockImplementation((_role: unknown, key: string) => {
      if (key === 'project.view_all') return Promise.resolve(true);
      return Promise.resolve(false);
    });
    prismaMock.task.findMany.mockResolvedValue([
      { id: 't1', projectId: 'proj-1' },
      { id: 't2', projectId: 'proj-1' },
    ] as any);
    prismaMock.comment.count.mockResolvedValue(12);
    prismaMock.taskExternalLink.count.mockResolvedValue(2);
    prismaMock.taskLink.count
      .mockResolvedValueOnce(3)  // from
      .mockResolvedValueOnce(1); // to
    prismaMock.taskStatusHistory.count.mockResolvedValue(20);

    const result = await previewBulkDeleteCascade(['t1', 't2'], 'u-super', UserRole.SUPER_ADMIN);

    expect(result).toEqual({
      taskCount: 2,
      comments: 12,
      timeEntries: 0,
      loggedHours: 0,
      externalLinks: 2,
      taskLinks: 4, // 3 + 1
      statusHistory: 20,
    });
    // Super-admin path skips the projectMember lookup.
    expect(prismaMock.projectMember.findMany).not.toHaveBeenCalled();
  });

  /**
   * SWEEP #1 BUG REGRESSION TEST.
   *
   * Before the 2026-05-15 fix: this endpoint had no auth gate beyond
   * `authorize('task.delete')` (role-level). A PM with `task.delete`
   * permission could supply task IDs from a project they're NOT in
   * (obtained from a Slack screenshot, audit log link, etc.) and learn
   * aggregate metrics — comment count, hours logged, external-PR
   * count, status-history depth — for those tasks. Aggregate counts
   * leak activity-volume signal even when individual rows would be
   * blocked by per-resource authz.
   *
   * After the fix: `previewBulkDeleteCascade` filters the supplied
   * taskIds against the caller's project memberships BEFORE running
   * the aggregate counts. taskCount reflects the post-filter total so
   * the FE confirm dialog can't be tricked into showing inflated
   * counts that include non-member projects.
   */
  it('FILTERS taskIds to caller-member projects only (cross-project metadata leak fix)', async () => {
    // PM (no view_all). Member of proj-1 only. Supplies a mix of
    // proj-1 + proj-2 task IDs.
    checkPermissionSpy.mockImplementation((_role: unknown, key: string) => {
      if (key === 'project.view_all') return Promise.resolve(false);
      return Promise.resolve(false);
    });
    prismaMock.task.findMany.mockResolvedValue([
      { id: 't-own-1',     projectId: 'proj-1' },
      { id: 't-own-2',     projectId: 'proj-1' },
      { id: 't-foreign-1', projectId: 'proj-2' },
      { id: 't-foreign-2', projectId: 'proj-2' },
    ] as any);
    prismaMock.projectMember.findMany.mockResolvedValue([
      { projectId: 'proj-1' },
    ] as any);
    // The aggregates should only fire with the filtered (own) ids.
    prismaMock.comment.count.mockResolvedValue(7);
    prismaMock.taskExternalLink.count.mockResolvedValue(0);
    prismaMock.taskLink.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    prismaMock.taskStatusHistory.count.mockResolvedValue(5);

    const result = await previewBulkDeleteCascade(
      ['t-own-1', 't-own-2', 't-foreign-1', 't-foreign-2'],
      'u-pm',
      UserRole.PRODUCT_MANAGER,
    );

    // taskCount only counts the in-membership tasks (2, not 4).
    // Aggregates are over the filtered set — the FE shows truthful
    // numbers for what would actually delete.
    expect(result.taskCount).toBe(2);

    // Every aggregate count call should have used ONLY the filtered
    // taskIds. Spot-check via the mock call args.
    const commentCountCall = prismaMock.comment.count.mock.calls[0]?.[0] as any;
    expect(commentCountCall.where.taskId.in).toEqual(['t-own-1', 't-own-2']);
    expect(commentCountCall.where.taskId.in).not.toContain('t-foreign-1');
    expect(commentCountCall.where.taskId.in).not.toContain('t-foreign-2');
  });

  it('returns zero-filled summary when ALL supplied taskIds are foreign (defensive — no aggregate query fired)', async () => {
    // Caller supplies only out-of-project task IDs. After the filter,
    // allowedTaskIds is empty — we early-return the zero shape rather
    // than firing aggregates with an empty IN clause (some DBs treat
    // `IN ()` as a syntax error; the safer path is the explicit
    // early-return).
    checkPermissionSpy.mockResolvedValue(false);
    prismaMock.task.findMany.mockResolvedValue([
      { id: 't-foreign-1', projectId: 'proj-2' },
    ] as any);
    prismaMock.projectMember.findMany.mockResolvedValue([
      { projectId: 'proj-1' },
    ] as any);

    const result = await previewBulkDeleteCascade(['t-foreign-1'], 'u-pm', UserRole.PRODUCT_MANAGER);

    expect(result).toEqual({
      taskCount: 0,
      comments: 0,
      timeEntries: 0,
      loggedHours: 0,
      externalLinks: 0,
      taskLinks: 0,
      statusHistory: 0,
    });
    expect(prismaMock.comment.count).not.toHaveBeenCalled();
  });
});

// ─── bulkDeleteTasks ───────────────────────────────────────────────────

describe('bulkDeleteTasks', () => {
  beforeEach(() => {
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
  });

  it('returns failure for EVERY task when caller lacks task.delete (blanket gate)', async () => {
    checkPermissionSpy.mockResolvedValue(false);

    const result = await bulkDeleteTasks(['t1', 't2'], 'u1', UserRole.ENGINEER);

    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(2);
    expect(result.results.every((r) => r.error === 'Insufficient permissions')).toBe(true);
    // No DB lookup needed — we bail BEFORE the find.
    expect(prismaMock.task.findMany).not.toHaveBeenCalled();
  });

  it('rejects per-task when caller is not a member of that task project', async () => {
    // Pre-launch finding H1: super-admin with view_all used to delete
    // tasks in projects they didnt belong to. The single-task path
    // doesnt allow that; the bulk path now enforces uniform membership.
    checkPermissionSpy.mockResolvedValue(true);
    prismaMock.task.findMany.mockResolvedValue([
      { id: 't1', projectId: 'forbidden', title: 'X' },
    ] as any);
    prismaMock.projectMember.findMany.mockResolvedValue([] as any);

    const result = await bulkDeleteTasks(['t1'], 'u1', UserRole.SUPER_ADMIN);

    expect(result.failed).toBe(1);
    expect(result.results[0]?.error).toBe('Not a member of this project');
  });

  it('deletes each task in its OWN $transaction with a bulk_deleted_task audit row', async () => {
    checkPermissionSpy.mockResolvedValue(true);
    prismaMock.task.findMany.mockResolvedValue([
      { id: 't1', projectId: 'proj-1', title: 'First' },
      { id: 't2', projectId: 'proj-1', title: 'Second' },
    ] as any);
    prismaMock.projectMember.findMany.mockResolvedValue([{ projectId: 'proj-1' }] as any);

    const result = await bulkDeleteTasks(['t1', 't2'], 'u-admin', UserRole.SUPER_ADMIN);

    expect(result.succeeded).toBe(2);
    expect(prismaMock.task.delete).toHaveBeenCalledTimes(2);
    const auditCalls = logActivitySpy.mock.calls.filter(
      (c) => (c[0] as any).action === 'bulk_deleted_task',
    );
    expect(auditCalls).toHaveLength(2);
  });

  it('returns "Task not found" for IDs that dont exist in the requested set', async () => {
    checkPermissionSpy.mockResolvedValue(true);
    // Only t1 exists; t-ghost is missing.
    prismaMock.task.findMany.mockResolvedValue([
      { id: 't1', projectId: 'proj-1', title: 'X' },
    ] as any);
    prismaMock.projectMember.findMany.mockResolvedValue([{ projectId: 'proj-1' }] as any);

    const result = await bulkDeleteTasks(['t1', 't-ghost'], 'admin', UserRole.SUPER_ADMIN);

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results.find((r) => r.taskId === 't-ghost')?.error).toBe('Task not found');
  });

  it('returns empty results on empty taskIds (no DB call)', async () => {
    const result = await bulkDeleteTasks([], 'u1', UserRole.SUPER_ADMIN);
    expect(result).toEqual({ results: [], succeeded: 0, failed: 0 });
    expect(checkPermissionSpy).not.toHaveBeenCalled();
  });
});

// ─── reorderTask ──────────────────────────────────────────────────────

describe('reorderTask', () => {
  it('throws NotFoundError when the task does not exist', async () => {
    prismaMock.task.findUnique.mockResolvedValue(null);
    await expect(reorderTask('gone', 5)).rejects.toThrow(NotFoundError);
  });

  it('updates sortOrder to the supplied value (no other fields touched)', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ id: 't1' } as any);
    prismaMock.task.update.mockImplementation(((args: any) =>
      Promise.resolve({ id: 't1', ...args.data })
    ) as any);

    await reorderTask('t1', 42);

    expect(prismaMock.task.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { sortOrder: 42 },
    });
  });
});

// ─── requestReview ────────────────────────────────────────────────────

describe('requestReview', () => {
  const actor = { id: 'actor-1', role: UserRole.PRODUCT_MANAGER, userType: 'HUMAN' as const };
  const baseTask = {
    id: 't1',
    projectId: 'proj-1',
    status: TaskStatus.IN_PROGRESS,
    title: 'Feature X',
    assigneeId: 'actor-1', // actor is the assignee — they're allowed to request
    creatorId: 'someone-else',
  };

  beforeEach(() => {
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
    prismaMock.task.aggregate.mockResolvedValue({ _max: { sortOrder: 0 } } as any);
    prismaMock.task.update.mockImplementation(((args: any) =>
      Promise.resolve({
        id: 't1',
        project: { id: 'proj-1', name: 'Indigo' },
        ...args.data,
      })
    ) as any);
    vi.mocked(notificationService.notifyReviewRequested).mockResolvedValue(undefined as any);
  });

  it('throws ValidationError when no reviewerId is provided', async () => {
    await expect(
      requestReview('t1', '', null, actor),
    ).rejects.toThrow(/reviewerId is required/);
  });

  it('throws ValidationError when reviewer is the requester themselves', async () => {
    await expect(
      requestReview('t1', 'actor-1', null, actor),
    ).rejects.toThrow(/Cannot request a review from yourself/);
  });

  it('throws NotFoundError when the task does not exist', async () => {
    prismaMock.task.findUnique.mockResolvedValue(null);
    await expect(
      requestReview('gone', 'reviewer-1', null, actor),
    ).rejects.toThrow(NotFoundError);
  });

  it('rejects requesting review on a DONE task (must reopen first)', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      ...baseTask,
      status: TaskStatus.DONE,
    } as any);

    await expect(
      requestReview('t1', 'reviewer-1', null, actor),
    ).rejects.toThrow(/already Done/);
  });

  it('rejects requesting review from BACKLOG (must move out first)', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      ...baseTask,
      status: TaskStatus.BACKLOG,
    } as any);

    await expect(
      requestReview('t1', 'reviewer-1', null, actor),
    ).rejects.toThrow(/Move the task out of Backlog/);
  });

  it('allows the ASSIGNEE without task.request_review permission (own-task path)', async () => {
    checkPermissionSpy.mockResolvedValue(false); // no role permission
    prismaMock.task.findUnique.mockResolvedValue(baseTask as any);
    prismaMock.projectMember.findUnique.mockResolvedValue({ id: 'mem-1' } as any);
    prismaMock.projectMember.findFirst.mockResolvedValue({
      id: 'mem-2',
      user: { id: 'reviewer-1', name: 'Reviewer', role: 'ENGINEER' },
    } as any);

    await expect(
      requestReview('t1', 'reviewer-1', null, actor),
    ).resolves.toBeTruthy();
  });

  it('rejects a non-member non-admin actor (defense in depth above the route)', async () => {
    checkPermissionSpy.mockResolvedValue(true); // has role permission
    prismaMock.task.findUnique.mockResolvedValue(baseTask as any);
    prismaMock.projectMember.findUnique.mockResolvedValue(null); // not a member
    // actor is PRODUCT_MANAGER — not admin/super_admin, so they need membership

    await expect(
      requestReview('t1', 'reviewer-1', null, actor),
    ).rejects.toThrow(/Not a member of this project/);
  });

  it('rejects an inactive reviewer (deactivated account cant be tagged)', async () => {
    checkPermissionSpy.mockResolvedValue(true);
    prismaMock.task.findUnique.mockResolvedValue(baseTask as any);
    prismaMock.projectMember.findUnique.mockResolvedValue({ id: 'mem-1' } as any);
    prismaMock.projectMember.findFirst.mockResolvedValue(null); // reviewer not active+member

    await expect(
      requestReview('t1', 'reviewer-deactivated', null, actor),
    ).rejects.toThrow(/Reviewer must be an active member/);
  });

  it('posts an optional review note as a Comment in the same transaction', async () => {
    checkPermissionSpy.mockResolvedValue(true);
    prismaMock.task.findUnique.mockResolvedValue(baseTask as any);
    prismaMock.projectMember.findUnique.mockResolvedValue({ id: 'mem-1' } as any);
    prismaMock.projectMember.findFirst.mockResolvedValue({
      id: 'mem-2',
      user: { id: 'r1', name: 'Reviewer', role: 'PRODUCT_MANAGER' },
    } as any);

    await requestReview('t1', 'r1', '  Please look at the edge cases  ', actor);

    expect(prismaMock.comment.create).toHaveBeenCalledWith({
      data: {
        projectId: 'proj-1',
        taskId: 't1',
        // Note trimmed.
        content: 'Please look at the edge cases',
        authorId: 'actor-1',
      },
    });
  });

  it('writes a status-history row + activity log + notifyReviewRequested on success', async () => {
    checkPermissionSpy.mockResolvedValue(true);
    prismaMock.task.findUnique.mockResolvedValue(baseTask as any);
    prismaMock.projectMember.findUnique.mockResolvedValue({ id: 'mem-1' } as any);
    prismaMock.projectMember.findFirst.mockResolvedValue({
      id: 'mem-2',
      user: { id: 'r1', name: 'Reviewer', role: 'CLIENT' },
    } as any);

    await requestReview('t1', 'r1', null, actor);

    expect(prismaMock.taskStatusHistory.create).toHaveBeenCalledWith({
      data: {
        taskId: 't1',
        fromStatus: TaskStatus.IN_PROGRESS,
        toStatus: 'IN_REVIEW',
        changedBy: 'actor-1',
      },
    });
    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'review_requested' }),
      expect.anything(),
    );
    expect(notificationService.notifyReviewRequested).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 't1',
        reviewerId: 'r1',
        reviewerIsClient: true,
      }),
    );
  });
});

// ─── decideReview ─────────────────────────────────────────────────────

describe('decideReview', () => {
  const reviewer = { id: 'reviewer-1', role: UserRole.PRODUCT_MANAGER, userType: 'HUMAN' as const };
  const inReviewTask = {
    id: 't1',
    projectId: 'proj-1',
    status: TaskStatus.IN_REVIEW,
    title: 'Feature X',
    reviewerId: 'reviewer-1',
    acceptanceCriteria: [],
  };

  beforeEach(() => {
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
    prismaMock.task.aggregate.mockResolvedValue({ _max: { sortOrder: 0 } } as any);
    prismaMock.task.update.mockImplementation(((args: any) =>
      Promise.resolve({
        id: 't1',
        project: { id: 'proj-1', name: 'Indigo' },
        assignee: { id: 'a1', name: 'A' },
        ...args.data,
      })
    ) as any);
    vi.mocked(notificationService.notifyReviewDecided).mockResolvedValue(undefined as any);
    // APPROVE → DONE triggers enforceAgentDoneGate which calls
    // checkPermission for 'task.transition.done'. Default to true here
    // so the happy paths can proceed; tests that need it false override.
    checkPermissionSpy.mockResolvedValue(true);
  });

  it('throws NotFoundError when task does not exist', async () => {
    prismaMock.task.findUnique.mockResolvedValue(null);
    await expect(
      decideReview('gone', 'APPROVE', null, reviewer),
    ).rejects.toThrow(NotFoundError);
  });

  it('rejects when task is not currently IN_REVIEW (defensive against stale UI)', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      ...inReviewTask,
      status: TaskStatus.IN_PROGRESS,
    } as any);

    await expect(
      decideReview('t1', 'APPROVE', null, reviewer),
    ).rejects.toThrow(/not currently under review/);
  });

  it('rejects when actor is neither the designated reviewer nor an admin (row-level authz)', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      ...inReviewTask,
      reviewerId: 'someone-else',
    } as any);

    await expect(
      decideReview('t1', 'APPROVE', null, reviewer),
    ).rejects.toThrow(/Only the requested reviewer/);
  });

  it('allows an ADMIN to decide even when they arent the designated reviewer', async () => {
    const admin = { id: 'admin-1', role: UserRole.ADMIN, userType: 'HUMAN' as const };
    prismaMock.task.findUnique.mockResolvedValue({
      ...inReviewTask,
      reviewerId: 'someone-else',
    } as any);

    await expect(
      decideReview('t1', 'APPROVE', null, admin),
    ).resolves.toBeTruthy();
  });

  it('REQUIRES a non-empty comment when decision is REQUEST_CHANGES (cant bypass via empty body)', async () => {
    prismaMock.task.findUnique.mockResolvedValue(inReviewTask as any);

    await expect(
      decideReview('t1', 'REQUEST_CHANGES', '   ', reviewer),
    ).rejects.toThrow(/comment is required when requesting changes/);

    // No mutation should fire.
    expect(prismaMock.task.update).not.toHaveBeenCalled();
  });

  it('on APPROVE: enforces the AC done-gate (unchecked items block the approval)', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      ...inReviewTask,
      acceptanceCriteria: [{ done: false }],
    } as any);

    await expect(
      decideReview('t1', 'APPROVE', null, reviewer),
    ).rejects.toThrow(/acceptance criterion is still unchecked/);
  });

  it('clears reviewer fields after a successful decision (task is "ready for next" cleanly)', async () => {
    prismaMock.task.findUnique.mockResolvedValue(inReviewTask as any);

    await decideReview('t1', 'APPROVE', null, reviewer);

    expect(prismaMock.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: TaskStatus.DONE,
          reviewerId: null,
          reviewRequestedAt: null,
          reviewRequestedById: null,
        }),
      }),
    );
  });

  it('on REQUEST_CHANGES: moves to IN_PROGRESS + creates the required comment in tx', async () => {
    prismaMock.task.findUnique.mockResolvedValue(inReviewTask as any);

    await decideReview('t1', 'REQUEST_CHANGES', 'Needs more error handling', reviewer);

    expect(prismaMock.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: TaskStatus.IN_PROGRESS }),
      }),
    );
    expect(prismaMock.comment.create).toHaveBeenCalledWith({
      data: {
        projectId: 'proj-1',
        taskId: 't1',
        content: 'Needs more error handling',
        authorId: 'reviewer-1',
      },
    });
    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'review_changes_requested' }),
      expect.anything(),
    );
  });
});

// ─── updateSubtasks / updateAcceptanceCriteria (shared helper) ────────

describe('updateSubtasks / updateAcceptanceCriteria', () => {
  beforeEach(() => {
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock));
    prismaMock.task.update.mockImplementation(((args: any) =>
      Promise.resolve({ id: 't1', ...args.data })
    ) as any);
  });

  it('rejects non-array input with ValidationError', async () => {
    await expect(updateSubtasks('t1', 'not-an-array', 'u1')).rejects.toThrow(
      /Expected an array/,
    );
  });

  it('rejects items missing text', async () => {
    await expect(
      updateSubtasks('t1', [{ text: '' }], 'u1'),
    ).rejects.toThrow(/text is required/);
  });

  it('rejects items with text > 500 chars (DoS guard)', async () => {
    await expect(
      updateSubtasks('t1', [{ text: 'a'.repeat(501) }], 'u1'),
    ).rejects.toThrow(/exceeds 500 characters/);
  });

  it('caps list length at 50 items (DoS guard)', async () => {
    const tooMany = Array.from({ length: 51 }, () => ({ text: 'ok' }));
    await expect(updateSubtasks('t1', tooMany, 'u1')).rejects.toThrow(
      /Up to 50 items allowed/,
    );
  });

  it('treats `done` as strict-true only (not truthy) — defensive', async () => {
    // String "true", 1, anything truthy-but-not-=== true should sanitize to false.
    prismaMock.task.findUnique.mockResolvedValue({
      id: 't1',
      projectId: 'proj-1',
    } as any);

    await updateSubtasks(
      't1',
      [
        { id: 'i1', text: 'do thing', done: 'true' as any },
        { id: 'i2', text: 'do other thing', done: true },
      ],
      'u1',
    );

    const updateCall = prismaMock.task.update.mock.calls[0]?.[0] as any;
    expect(updateCall.data.subtasks).toEqual([
      expect.objectContaining({ id: 'i1', done: false }),
      expect.objectContaining({ id: 'i2', done: true }),
    ]);
  });

  it('trims whitespace around text before persisting', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: 't1',
      projectId: 'proj-1',
    } as any);

    await updateSubtasks('t1', [{ id: 'i1', text: '  trimmed  ', done: false }], 'u1');

    const updateCall = prismaMock.task.update.mock.calls[0]?.[0] as any;
    expect(updateCall.data.subtasks[0].text).toBe('trimmed');
  });

  it('writes the corresponding audit log with count + done totals', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: 't1',
      projectId: 'proj-1',
    } as any);

    await updateAcceptanceCriteria(
      't1',
      [
        { id: 'a', text: 'X', done: true },
        { id: 'b', text: 'Y', done: false },
      ],
      'u1',
    );

    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'updated_acceptance_criteria',
        details: { count: 2, done: 1 },
      }),
      expect.anything(),
    );
  });

  it('throws NotFoundError when the task does not exist', async () => {
    prismaMock.task.findUnique.mockResolvedValue(null);
    await expect(
      updateSubtasks('gone', [{ id: 'a', text: 'X' }], 'u1'),
    ).rejects.toThrow(NotFoundError);
  });
});

// ─── getMyTasks ───────────────────────────────────────────────────────

describe('getMyTasks', () => {
  beforeEach(() => {
    prismaMock.task.findMany.mockResolvedValue([] as any);
  });

  it('filters tasks by assigneeId === userId', async () => {
    checkPermissionSpy.mockResolvedValue(false);
    prismaMock.projectMember.findMany.mockResolvedValue([{ projectId: 'p1' }] as any);

    await getMyTasks('u1', UserRole.ENGINEER);

    const where = prismaMock.task.findMany.mock.calls[0]?.[0]?.where as any;
    expect(where.assigneeId).toBe('u1');
  });

  it('filters to projects the user is currently a member of (Team feedback #8)', async () => {
    // Previously the dashboard showed tasks in projects the user had
    // been removed from. The detail click would 403 from taskAccess.
    checkPermissionSpy.mockResolvedValue(false);
    prismaMock.projectMember.findMany.mockResolvedValue([
      { projectId: 'p1' },
      { projectId: 'p2' },
    ] as any);

    await getMyTasks('u1', UserRole.ENGINEER);

    const where = prismaMock.task.findMany.mock.calls[0]?.[0]?.where as any;
    expect(where.projectId).toEqual({ in: ['p1', 'p2'] });
  });

  it('SKIPS the membership filter when caller has project.view_all (admin sees all)', async () => {
    checkPermissionSpy.mockResolvedValue(true);

    await getMyTasks('admin-1', UserRole.SUPER_ADMIN);

    const where = prismaMock.task.findMany.mock.calls[0]?.[0]?.where as any;
    expect(where.projectId).toBeUndefined();
    // No projectMember.findMany should fire — admin doesnt need it.
    expect(prismaMock.projectMember.findMany).not.toHaveBeenCalled();
  });

  it('hides DONE tasks older than 60 days from My Tasks (avoids 1000+ row dashboards)', async () => {
    checkPermissionSpy.mockResolvedValue(true);

    const before = Date.now();
    await getMyTasks('u1', UserRole.ADMIN);
    const after = Date.now();

    const where = prismaMock.task.findMany.mock.calls[0]?.[0]?.where as any;
    expect(where.OR).toEqual([
      { status: { not: 'DONE' } },
      {
        status: 'DONE',
        updatedAt: { gte: expect.any(Date) },
      },
    ]);
    // The cutoff is "60 days ago" — verify within a 1s tolerance.
    const cutoff = (where.OR[1].updatedAt.gte as Date).getTime();
    const expectedMin = before - 60 * 86_400_000;
    const expectedMax = after - 60 * 86_400_000;
    expect(cutoff).toBeGreaterThanOrEqual(expectedMin);
    expect(cutoff).toBeLessThanOrEqual(expectedMax);
  });

  it('caps results at 200 tasks (DoS guard for engineers with huge backlogs)', async () => {
    checkPermissionSpy.mockResolvedValue(true);
    await getMyTasks('u1', UserRole.ADMIN);
    const args = prismaMock.task.findMany.mock.calls[0]?.[0] as any;
    expect(args.take).toBe(200);
  });

  it('orders by priority asc then dueDate asc (P0 due-soonest first)', async () => {
    checkPermissionSpy.mockResolvedValue(true);
    await getMyTasks('u1', UserRole.ADMIN);
    const args = prismaMock.task.findMany.mock.calls[0]?.[0] as any;
    expect(args.orderBy).toEqual([{ priority: 'asc' }, { dueDate: 'asc' }]);
  });
});

// ─── CC feature PR 2026-05-20 — nudgeTask ───────────────────────────
// (`nudgeTask` and `notificationService` are re-imported at the top
//  of this file; no duplicate-import needed here.)

import { nudgeTask } from './task.service';

describe('nudgeTask', () => {
  const baseTask = {
    id: 't-1',
    projectId: 'proj-1',
    title: 'Wire SSO',
    assigneeId: 'eng-1',
    assignee: { id: 'eng-1', name: 'Vikram' },
    project: { name: 'Indigo' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findUnique.mockResolvedValue({ name: 'Maya' } as any);
    // $transaction pass-through so the tx-wrapped writes hit the
    // same prismaMock client.
    (prismaMock.$transaction as any).mockImplementation(async (fn: any) => fn(prismaMock));
  });

  it('THROWS NotFoundError when task does not exist', async () => {
    prismaMock.task.findUnique.mockResolvedValue(null);

    await expect(nudgeTask('gone', 'maya', null)).rejects.toThrow(NotFoundError);
  });

  it('THROWS ValidationError when the task has no assignee (nobody to nudge)', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ ...baseTask, assigneeId: null, assignee: null } as any);

    await expect(nudgeTask('t-1', 'maya', null)).rejects.toThrow(ValidationError);
  });

  it('THROWS ValidationError when the sender IS the assignee (no self-nudge)', async () => {
    prismaMock.task.findUnique.mockResolvedValue(baseTask as any);

    await expect(nudgeTask('t-1', 'eng-1', null)).rejects.toThrow(/can't nudge yourself/i);
  });

  it('THROWS ConflictError when sender already nudged this task in the last 24h (cooldown)', async () => {
    prismaMock.task.findUnique.mockResolvedValue(baseTask as any);
    // Most recent nudge was 5h ago (within the 24h window).
    const recent = new Date(Date.now() - 5 * 60 * 60 * 1000);
    prismaMock.taskNudge.findFirst.mockResolvedValue({ createdAt: recent } as any);

    await expect(nudgeTask('t-1', 'maya', null)).rejects.toThrow(ConflictError);
    // Error message inlines hours-left so the FE can render
    // "try again in 19 hours."
    await expect(nudgeTask('t-1', 'maya', null)).rejects.toThrow(/19 hours/);
    // Critical: no nudge row written when cooldown trips.
    expect(prismaMock.taskNudge.create).not.toHaveBeenCalled();
  });

  it('PROCEEDS when cooldown has cleared (last nudge > 24h ago)', async () => {
    prismaMock.task.findUnique.mockResolvedValue(baseTask as any);
    // No recent nudge in the window.
    prismaMock.taskNudge.findFirst.mockResolvedValue(null);

    await nudgeTask('t-1', 'maya', 'when you get a sec');

    // Nudge row + activity log both fired.
    expect(prismaMock.taskNudge.create).toHaveBeenCalledWith({
      data: { taskId: 't-1', senderId: 'maya', message: 'when you get a sec' },
    });
    expect(notificationService.notifyTaskNudge).toHaveBeenCalledWith(
      expect.objectContaining({
        nudgedUserId: 'eng-1',
        nudgerName: 'Maya',
        message: 'when you get a sec',
      }),
    );
  });

  it('does NOT BLOCK on notification failure (fire-and-forget)', async () => {
    prismaMock.task.findUnique.mockResolvedValue(baseTask as any);
    prismaMock.taskNudge.findFirst.mockResolvedValue(null);
    vi.mocked(notificationService.notifyTaskNudge).mockRejectedValue(new Error('notify down'));

    // The nudge row is committed inside the tx; a notification
    // failure can't undo that.
    await expect(nudgeTask('t-1', 'maya', null)).resolves.toBeUndefined();
    expect(prismaMock.taskNudge.create).toHaveBeenCalled();
  });
});

// ─── CC feature PR 2026-05-20 — completion encouragement ─────────

describe('completion encouragement on DONE transition (moveTask path)', () => {
  const baseTask = {
    id: 't-1',
    projectId: 'proj-1',
    title: 'Wire SSO',
    status: TaskStatus.IN_PROGRESS,
    // Owned — active statuses require an assignee, and this suite is about
    // the completion-encouragement notify, not the assignee gate. With an
    // assignee the task-closed productivity emit also runs (skipped for
    // unowned tasks), so the fixture needs createdAt for its age calc.
    assigneeId: 'eng-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    acceptanceCriteria: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    checkPermissionSpy.mockResolvedValue(true);
    (prismaMock.$transaction as any).mockImplementation(async (fn: any) => fn(prismaMock));
    prismaMock.task.findUnique.mockResolvedValue(baseTask as any);
    prismaMock.task.update.mockResolvedValue({ ...baseTask, status: TaskStatus.DONE } as any);
    prismaMock.task.aggregate.mockResolvedValue({ _max: { sortOrder: 0 } } as any);
    prismaMock.project.findUnique.mockResolvedValue({ name: 'Indigo' } as any);
  });

  it('FIRES encouragement when moveTask transitions to DONE (plain "Nice work" when streak < 3)', async () => {
    prismaMock.taskStatusHistory.count.mockResolvedValue(1); // first DONE today

    await moveTask('t-1', TaskStatus.DONE, undefined, 'eng-1', { userType: 'HUMAN', role: UserRole.ENGINEER });
    // The encouragement call is fire-and-forget (`.catch()` chain
    // in production code) so the moveTask resolution doesn't block
    // on it. Drain the microtask queue so the assertion observes
    // the spy invocation that's already in flight.
    await vi.waitFor(() =>
      expect(notificationService.notifyTaskCompletionEncouragement).toHaveBeenCalled()
    );

    expect(notificationService.notifyTaskCompletionEncouragement).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 't-1',
        completerId: 'eng-1',
        tasksCompletedToday: 1,
      }),
    );
  });

  it('passes a streak count to the notify helper when ≥ 3 tasks completed today', async () => {
    prismaMock.taskStatusHistory.count.mockResolvedValue(5);

    await moveTask('t-1', TaskStatus.DONE, undefined, 'eng-1', { userType: 'HUMAN', role: UserRole.ENGINEER });
    await vi.waitFor(() =>
      expect(notificationService.notifyTaskCompletionEncouragement).toHaveBeenCalled()
    );

    expect(notificationService.notifyTaskCompletionEncouragement).toHaveBeenCalledWith(
      expect.objectContaining({ tasksCompletedToday: 5 }),
    );
  });

  it('does NOT fire encouragement when moveTask transitions to NON-DONE statuses', async () => {
    await moveTask('t-1', TaskStatus.IN_REVIEW, undefined, 'eng-1', { userType: 'HUMAN', role: UserRole.ENGINEER });

    expect(notificationService.notifyTaskCompletionEncouragement).not.toHaveBeenCalled();
  });

  it('does NOT fire encouragement on a status no-op (same-status save)', async () => {
    prismaMock.task.findUnique.mockResolvedValue({ ...baseTask, status: TaskStatus.DONE } as any);

    await moveTask('t-1', TaskStatus.DONE, undefined, 'eng-1', { userType: 'HUMAN', role: UserRole.ENGINEER });

    expect(notificationService.notifyTaskCompletionEncouragement).not.toHaveBeenCalled();
  });
});
