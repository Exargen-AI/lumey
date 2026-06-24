/**
 * Phase 2.6b — today.service closeout.
 *
 * This service was rewritten by the team in 2026-05-15 (PR #111) when
 * Activity + Today were merged. It grew from 194 → 506 LOC. Less audit
 * time than auth / task / RBAC — exactly the kind of fresh team code
 * where real bugs hide.
 *
 * ## Bugs found + fixed in this service across the hardening pass
 *
 *   • **Activity-event visibility leak: milestones** (PR #117,
 *     2026-05-15) — milestone-targeted activity rows leaked
 *     `details.title` of internal milestones to CLIENT viewers.
 *     Fix: per-event filter parallel to the existing task filter.
 *     Tests for this fix are the `milestone-targeted event
 *     visibility` block below.
 *
 *   • **Activity-event visibility leak: decisions** (this PR, 2026-
 *     05-15 audit) — CLIENT role does NOT have `decision.view`
 *     permission, so the `GET /projects/:id/decisions` endpoint
 *     correctly hides decisions. But the today.service feed only
 *     filtered task + milestone events; `created_decision`,
 *     `updated_decision`, `deleted_decision` activity rows passed
 *     through to CLIENT viewers in the project with full
 *     `details.title`. Same-shape leak as milestones. Fix: gate
 *     decision-targeted events on `scope.canViewDecisions`
 *     (`decision.view` permission lookup added to
 *     `computeVisibility`). Tests for this fix are the
 *     `decision-targeted event visibility` block below.
 *
 * ## What was deliberately NOT a leak (audited 2026-05-15, no fix)
 *
 *   • **Deliverables** — inherently client-facing (CLIENT has
 *     `deliverable.sign_off`).
 *   • **Documents** — CLIENT has `document.read` for all project
 *     docs.
 *   • **RBAC `updated_rbac` events** — `logActivity` does NOT set
 *     `projectId` on these org-level rows, and the activity query
 *     filters by `projectId: { in: allowedProjectIds }` which
 *     excludes null. Structurally safe.
 *
 * The full audit + per-entity reasoning lives in the doc-comment
 * above the event-hydration block in `today.service.ts` — keep it
 * in sync as new entity types start emitting activity rows.
 */

import './../test/prismaMock';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserRole } from '@prisma/client';
import { prismaMock } from '../test/prismaMock';

const { checkPermissionSpy } = vi.hoisted(() => ({
  checkPermissionSpy: vi.fn(),
}));

// 2026-06-02: today.service gates visibility on role-level `checkPermission`
// (cross-project) and per-project `canViewProjectInternal` (when scoped to a
// project). The key-based `asViewer` helper drives `checkPermissionSpy`;
// route `canViewProjectInternal` to it via the task.view_internal key so a
// projectId-scoped call resolves to the same "internal" truth value.
vi.mock('./rbac.service', () => ({
  __esModule: true,
  checkPermission: checkPermissionSpy,
  checkPermissionForUser: checkPermissionSpy,
  canViewProjectInternal: vi.fn((user: { role: string }) =>
    checkPermissionSpy(user.role, 'task.view_internal'),
  ),
}));

import { getActivityFeed } from './today.service';

beforeEach(() => {
  checkPermissionSpy.mockReset();
  // Default: configure as a CLIENT-like viewer (no view_all, no
  // view_internal, no decision.view). Each test that needs elevated
  // permissions overrides via `mockImplementation` or
  // `mockResolvedValueOnce`. `computeVisibility` checks three
  // permissions in parallel; a single `mockResolvedValue(false)`
  // returns false for all of them.
  checkPermissionSpy.mockResolvedValue(false);
  prismaMock.projectMember.findMany.mockResolvedValue([
    { projectId: 'proj-1' },
  ] as any);
  prismaMock.taskStatusHistory.findMany.mockResolvedValue([] as any);
  prismaMock.task.findMany.mockResolvedValue([] as any);
  prismaMock.comment.findMany.mockResolvedValue([] as any);
  prismaMock.activity.findMany.mockResolvedValue([] as any);
  prismaMock.milestone.findMany.mockResolvedValue([] as any);
});

/**
 * Helper: wire `checkPermission` mock to return per-key truth values.
 * Without this, the order-sensitive `mockResolvedValueOnce` chain in
 * `computeVisibility` (project.view_all, then task.view_internal,
 * then decision.view) becomes brittle. With this, a test can declare
 * its intent (`asViewer({ decision: true })`) and not care about
 * order.
 */
function asViewer(grants: { all?: boolean; internal?: boolean; decision?: boolean } = {}) {
  checkPermissionSpy.mockImplementation((_role: unknown, key: string) => {
    if (key === 'project.view_all') return Promise.resolve(!!grants.all);
    if (key === 'task.view_internal') return Promise.resolve(!!grants.internal);
    if (key === 'decision.view') return Promise.resolve(!!grants.decision);
    return Promise.resolve(false);
  });
}

// ─── Empty-scope short-circuit ─────────────────────────────────────────

describe('getActivityFeed — empty scope short-circuit', () => {
  it('returns a structurally-complete empty payload when caller belongs to no projects', async () => {
    // Non-admin with no project memberships → allowedProjectIds === [].
    // The service must NOT fire heavy queries; it short-circuits to
    // empty arrays so the FE never gets null.
    prismaMock.projectMember.findMany.mockResolvedValue([] as any);

    const result = await getActivityFeed('u-orphan', UserRole.ENGINEER, {
      date: '2026-05-15',
      tzOffsetMinutes: 0,
    });

    expect(result).toMatchObject({
      date: '2026-05-15',
      today: { doneTasks: [], events: [] },
      thisWeek: { inFocus: [], shippedGroups: [] },
    });
    // No heavy queries fired.
    expect(prismaMock.taskStatusHistory.findMany).not.toHaveBeenCalled();
    expect(prismaMock.activity.findMany).not.toHaveBeenCalled();
  });
});

// ─── Visibility filter on task-targeted activity events (existing path) ─

describe('getActivityFeed — task-targeted event visibility (existing fix)', () => {
  it('drops a task-targeted activity event when the task is NOT clientVisible AND viewer lacks view_internal', async () => {
    // Setup: viewer is a CLIENT (no view_internal), there's a recently-
    // created task activity row pointing at a private task. The event
    // should be filtered out.
    checkPermissionSpy.mockResolvedValue(false);
    prismaMock.activity.findMany.mockResolvedValue([
      {
        id: 'a1',
        action: 'created_task',
        createdAt: new Date('2026-05-15T10:00:00Z'),
        targetType: 'task',
        targetId: 't-private',
        details: { title: 'Internal refactor — should not leak' },
        user: { id: 'u1', name: 'Anil', role: 'ADMIN' },
        project: { id: 'proj-1', name: 'Indigo', slug: 'indigo' },
      },
    ] as any);
    prismaMock.task.findMany.mockResolvedValue([
      // The corresponding task hydration call returns the private task.
      // `updatedAt` is also read by the inFocus query path that reuses
      // this same mock — provide a real Date.
      { id: 't-private', title: 'Internal refactor', taskNumber: 42, clientVisible: false, updatedAt: new Date('2026-05-15T09:00:00Z'), status: 'IN_PROGRESS', project: { id: 'proj-1', name: 'Indigo', slug: 'indigo' }, assignee: null, reviewer: null },
    ] as any);

    const result = await getActivityFeed('u-client', UserRole.CLIENT, {
      date: '2026-05-15',
      tzOffsetMinutes: 0,
    });

    expect(result.today.events).toEqual([]);
  });

  it('keeps a task-targeted event when the task IS clientVisible', async () => {
    checkPermissionSpy.mockResolvedValue(false);
    prismaMock.activity.findMany.mockResolvedValue([
      {
        id: 'a1',
        action: 'created_task',
        createdAt: new Date('2026-05-15T10:00:00Z'),
        targetType: 'task',
        targetId: 't-public',
        details: { title: 'Public feature' },
        user: { id: 'u1', name: 'Anil', role: 'ADMIN' },
        project: { id: 'proj-1', name: 'Indigo', slug: 'indigo' },
      },
    ] as any);
    prismaMock.task.findMany.mockResolvedValue([
      { id: 't-public', title: 'Public feature', taskNumber: 7, clientVisible: true, updatedAt: new Date('2026-05-15T09:00:00Z'), status: 'IN_PROGRESS', project: { id: 'proj-1', name: 'Indigo', slug: 'indigo' }, assignee: null, reviewer: null },
    ] as any);

    const result = await getActivityFeed('u-client', UserRole.CLIENT, {
      date: '2026-05-15',
      tzOffsetMinutes: 0,
    });

    expect(result.today.events).toHaveLength(1);
    expect(result.today.events[0]?.task).toMatchObject({ id: 't-public', title: 'Public feature' });
  });
});

// ─── Agent visibility lockdown (2026-06-01) ────────────────────────────
//
// getActivityFeed takes a 5th arg `canViewAgents`. When false, agent
// actors, agent-assigned tasks, and agent-authored comments are dropped
// from every section so agent work never surfaces to an unauthorised
// viewer. When true (SUPER_ADMIN / allowlisted), they pass through.
describe('getActivityFeed — agent visibility filter', () => {
  beforeEach(() => {
    // An internal viewer (sees internal tasks) so only the agent filter
    // is in play for these assertions.
    checkPermissionSpy.mockResolvedValue(true);
  });

  it('drops an activity event authored by an AI agent when canViewAgents=false', async () => {
    prismaMock.activity.findMany.mockResolvedValue([
      {
        id: 'a-agent',
        action: 'created_task',
        createdAt: new Date('2026-05-15T10:00:00Z'),
        targetType: null,
        targetId: null,
        details: { title: 'Agent did a thing' },
        user: { id: 'agent-1', name: 'Codey', role: 'ENGINEER', userType: 'AGENT' },
        project: { id: 'proj-1', name: 'Indigo', slug: 'indigo' },
      },
    ] as any);

    const hidden = await getActivityFeed('u', UserRole.ADMIN, { date: '2026-05-15', tzOffsetMinutes: 0 }, false);
    expect(hidden.today.events).toEqual([]);

    // Same data, but an authorised viewer (canViewAgents=true) keeps it.
    const shown = await getActivityFeed('u', UserRole.ADMIN, { date: '2026-05-15', tzOffsetMinutes: 0 }, true);
    expect(shown.today.events).toHaveLength(1);
    expect(shown.today.events[0]?.actor).toMatchObject({ id: 'agent-1' });
  });

  it('drops an agent-assigned in-focus task when canViewAgents=false', async () => {
    prismaMock.task.findMany.mockResolvedValue([
      {
        id: 't-agent', title: 'Agent task', taskNumber: 99, clientVisible: true,
        updatedAt: new Date('2026-05-15T09:00:00Z'), status: 'IN_PROGRESS',
        project: { id: 'proj-1', name: 'Indigo', slug: 'indigo' },
        assignee: { id: 'agent-1', name: 'Codey', role: 'ENGINEER', userType: 'AGENT' },
        reviewer: null,
      },
    ] as any);

    const hidden = await getActivityFeed('u', UserRole.ADMIN, { date: '2026-05-15', tzOffsetMinutes: 0 }, false);
    expect(hidden.thisWeek.inFocus).toEqual([]);

    const shown = await getActivityFeed('u', UserRole.ADMIN, { date: '2026-05-15', tzOffsetMinutes: 0 }, true);
    expect(shown.thisWeek.inFocus).toHaveLength(1);
  });

  it('drops a transition performed BY an agent from the shipped section', async () => {
    prismaMock.taskStatusHistory.findMany.mockResolvedValue([
      {
        taskId: 't-1', changedAt: new Date('2026-05-15T10:00:00Z'),
        user: { id: 'agent-1', name: 'Codey', role: 'ENGINEER', userType: 'AGENT' },
        task: {
          id: 't-1', title: 'Closed by agent', taskNumber: 5, clientVisible: true,
          status: 'DONE', project: { id: 'proj-1', name: 'Indigo', slug: 'indigo' },
          assignee: null,
        },
      },
    ] as any);

    const hidden = await getActivityFeed('u', UserRole.ADMIN, { date: '2026-05-15', tzOffsetMinutes: 0 }, false);
    const allTasks = hidden.today.doneTasks.flatMap((g) => g.tasks)
      .concat(hidden.thisWeek.shippedGroups.flatMap((g) => g.tasks));
    expect(allTasks).toEqual([]);

    const shown = await getActivityFeed('u', UserRole.ADMIN, { date: '2026-05-15', tzOffsetMinutes: 0 }, true);
    const shownTasks = shown.today.doneTasks.flatMap((g) => g.tasks)
      .concat(shown.thisWeek.shippedGroups.flatMap((g) => g.tasks));
    expect(shownTasks.length).toBeGreaterThan(0);
  });

  it('strips an agent-authored comment from a human-transitioned task', async () => {
    // Human closed the task (entry survives), but an agent commented —
    // that comment must be stripped for an unauthorised viewer.
    prismaMock.taskStatusHistory.findMany.mockResolvedValue([
      {
        taskId: 't-2', changedAt: new Date('2026-05-15T10:00:00Z'),
        user: { id: 'u1', name: 'Anil', role: 'ADMIN', userType: 'HUMAN' },
        task: {
          id: 't-2', title: 'Human-closed', taskNumber: 6, clientVisible: true,
          status: 'DONE', project: { id: 'proj-1', name: 'Indigo', slug: 'indigo' },
          assignee: null,
        },
      },
    ] as any);
    prismaMock.comment.findMany.mockResolvedValue([
      {
        id: 'c-agent', taskId: 't-2', content: 'Agent note', createdAt: new Date('2026-05-15T10:30:00Z'),
        author: { id: 'agent-1', name: 'Codey', role: 'ENGINEER', userType: 'AGENT' },
      },
      {
        id: 'c-human', taskId: 't-2', content: 'Human note', createdAt: new Date('2026-05-15T10:31:00Z'),
        author: { id: 'u1', name: 'Anil', role: 'ADMIN', userType: 'HUMAN' },
      },
    ] as any);

    const hidden = await getActivityFeed('u', UserRole.ADMIN, { date: '2026-05-15', tzOffsetMinutes: 0 }, false);
    const task = hidden.today.doneTasks.flatMap((g) => g.tasks).find((t) => t.id === 't-2');
    expect(task?.comments.map((c) => c.id)).toEqual(['c-human']); // agent comment stripped

    const shown = await getActivityFeed('u', UserRole.ADMIN, { date: '2026-05-15', tzOffsetMinutes: 0 }, true);
    const shownTask = shown.today.doneTasks.flatMap((g) => g.tasks).find((t) => t.id === 't-2');
    expect(shownTask?.comments.map((c) => c.id).sort()).toEqual(['c-agent', 'c-human']);
  });

  it('drops an IN_REVIEW in-focus task whose reviewer is an agent', async () => {
    prismaMock.task.findMany.mockResolvedValue([
      {
        id: 't-rev', title: 'In review by agent', taskNumber: 11, clientVisible: true,
        updatedAt: new Date('2026-05-15T09:00:00Z'), status: 'IN_REVIEW',
        project: { id: 'proj-1', name: 'Indigo', slug: 'indigo' },
        assignee: { id: 'u1', name: 'Anil', role: 'ADMIN', userType: 'HUMAN' },
        reviewer: { id: 'agent-1', name: 'Codey', role: 'ENGINEER', userType: 'AGENT' },
      },
    ] as any);

    const hidden = await getActivityFeed('u', UserRole.ADMIN, { date: '2026-05-15', tzOffsetMinutes: 0 }, false);
    expect(hidden.thisWeek.inFocus).toEqual([]);

    const shown = await getActivityFeed('u', UserRole.ADMIN, { date: '2026-05-15', tzOffsetMinutes: 0 }, true);
    expect(shown.thisWeek.inFocus).toHaveLength(1);
  });
});

// ─── THE BUG: milestone-targeted event leak ────────────────────────────

describe('getActivityFeed — milestone-targeted event visibility (the bug)', () => {
  /**
   * Before the fix: this test failed because the activity feed only
   * applied `clientVisible` filtering for `targetType === 'task'`.
   * Milestone-targeted events passed through with full `details.title`
   * exposed.
   *
   * After the fix: the per-event hydration now also looks up
   * milestones by id and drops the event when the milestone is
   * `clientVisible: false` AND the viewer lacks `task.view_internal`.
   */
  it('DROPS a milestone-targeted event when the milestone is NOT clientVisible AND viewer lacks view_internal', async () => {
    checkPermissionSpy.mockResolvedValue(false);
    prismaMock.activity.findMany.mockResolvedValue([
      {
        id: 'a-milestone',
        action: 'created_milestone',
        createdAt: new Date('2026-05-15T10:00:00Z'),
        targetType: 'milestone',
        targetId: 'm-internal',
        // This is the leaked-title field.
        details: { title: 'Q3 layoffs planning' },
        user: { id: 'u-admin', name: 'Anil', role: 'ADMIN' },
        project: { id: 'proj-1', name: 'Indigo', slug: 'indigo' },
      },
    ] as any);
    // The milestone is INTERNAL — clientVisible: false.
    prismaMock.milestone.findMany.mockResolvedValue([
      { id: 'm-internal', clientVisible: false },
    ] as any);

    const result = await getActivityFeed('u-client', UserRole.CLIENT, {
      date: '2026-05-15',
      tzOffsetMinutes: 0,
    });

    // The event must NOT appear in the feed — the milestone title would
    // otherwise leak through `details.title`.
    expect(result.today.events).toEqual([]);
  });

  it('KEEPS a milestone-targeted event when the milestone IS clientVisible (legitimate visibility)', async () => {
    checkPermissionSpy.mockResolvedValue(false);
    prismaMock.activity.findMany.mockResolvedValue([
      {
        id: 'a-milestone',
        action: 'created_milestone',
        createdAt: new Date('2026-05-15T10:00:00Z'),
        targetType: 'milestone',
        targetId: 'm-public',
        details: { title: 'Beta launch' },
        user: { id: 'u-admin', name: 'Anil', role: 'ADMIN' },
        project: { id: 'proj-1', name: 'Indigo', slug: 'indigo' },
      },
    ] as any);
    prismaMock.milestone.findMany.mockResolvedValue([
      { id: 'm-public', clientVisible: true },
    ] as any);

    const result = await getActivityFeed('u-client', UserRole.CLIENT, {
      date: '2026-05-15',
      tzOffsetMinutes: 0,
    });

    expect(result.today.events).toHaveLength(1);
    expect(result.today.events[0]?.action).toBe('created_milestone');
  });

  it('KEEPS a milestone-targeted event for an admin viewer (view_internal granted)', async () => {
    // Admin should see everything regardless of clientVisible.
    checkPermissionSpy.mockResolvedValue(true);
    prismaMock.activity.findMany.mockResolvedValue([
      {
        id: 'a-milestone',
        action: 'created_milestone',
        createdAt: new Date('2026-05-15T10:00:00Z'),
        targetType: 'milestone',
        targetId: 'm-internal',
        details: { title: 'Internal-only milestone' },
        user: { id: 'u-admin', name: 'Anil', role: 'ADMIN' },
        project: { id: 'proj-1', name: 'Indigo', slug: 'indigo' },
      },
    ] as any);
    prismaMock.milestone.findMany.mockResolvedValue([
      { id: 'm-internal', clientVisible: false },
    ] as any);

    const result = await getActivityFeed('u-admin', UserRole.ADMIN, {
      date: '2026-05-15',
      tzOffsetMinutes: 0,
    });

    // Admin sees the event.
    expect(result.today.events).toHaveLength(1);
  });

  it('DROPS a milestone-targeted event whose milestone has been deleted (orphan row)', async () => {
    // Defensive: an activity row whose target milestone has since been
    // deleted shouldn't surface with no title resolution.
    checkPermissionSpy.mockResolvedValue(false);
    prismaMock.activity.findMany.mockResolvedValue([
      {
        id: 'a-orphan',
        action: 'deleted_milestone',
        createdAt: new Date('2026-05-15T10:00:00Z'),
        targetType: 'milestone',
        targetId: 'm-gone',
        details: { title: 'Was Once A Milestone' },
        user: { id: 'u-admin', name: 'Anil', role: 'ADMIN' },
        project: { id: 'proj-1', name: 'Indigo', slug: 'indigo' },
      },
    ] as any);
    prismaMock.milestone.findMany.mockResolvedValue([]); // milestone gone

    const result = await getActivityFeed('u-client', UserRole.CLIENT, {
      date: '2026-05-15',
      tzOffsetMinutes: 0,
    });

    // Deleted milestone → drop the event for non-admin viewers. The
    // post-deletion title would otherwise leak.
    expect(result.today.events).toEqual([]);
  });
});

// ─── Non-task / non-milestone events still pass through ────────────────

describe('getActivityFeed — events without a per-entity visibility model', () => {
  it('lets PROJECT-level events through (projectId scoping is sufficient)', async () => {
    // Project-level events like `updated_project_health` belong to the
    // project; if the user is in the project, they see these.
    checkPermissionSpy.mockResolvedValue(false);
    prismaMock.activity.findMany.mockResolvedValue([
      {
        id: 'a-proj',
        action: 'updated_project_health',
        createdAt: new Date('2026-05-15T10:00:00Z'),
        targetType: 'project',
        targetId: 'proj-1',
        details: { from: 'GREEN', to: 'YELLOW' },
        user: { id: 'u-admin', name: 'Anil', role: 'ADMIN' },
        project: { id: 'proj-1', name: 'Indigo', slug: 'indigo' },
      },
    ] as any);

    const result = await getActivityFeed('u-client', UserRole.CLIENT, {
      date: '2026-05-15',
      tzOffsetMinutes: 0,
    });

    expect(result.today.events).toHaveLength(1);
    expect(result.today.events[0]?.action).toBe('updated_project_health');
  });

  it('lets DELIVERABLE events through (inherently client-facing — CLIENT has DELIVERABLE_SIGN_OFF)', async () => {
    // Documented audit finding: deliverable activity rows leak NOTHING
    // a CLIENT wasn't already entitled to see. This invariant test
    // pins that behavior so a future "let's add a filter for every
    // entity" refactor doesn't accidentally over-filter.
    asViewer({});
    prismaMock.activity.findMany.mockResolvedValue([
      {
        id: 'a-deliverable',
        action: 'created_deliverable',
        createdAt: new Date('2026-05-15T10:00:00Z'),
        targetType: 'deliverable',
        targetId: 'd1',
        details: { title: 'Landing page sign-off' },
        user: { id: 'u-pm', name: 'Maya', role: 'PRODUCT_MANAGER' },
        project: { id: 'proj-1', name: 'Indigo', slug: 'indigo' },
      },
    ] as any);

    const result = await getActivityFeed('u-client', UserRole.CLIENT, {
      date: '2026-05-15',
      tzOffsetMinutes: 0,
    });

    expect(result.today.events).toHaveLength(1);
    expect(result.today.events[0]?.action).toBe('created_deliverable');
  });
});

// ─── THE SECOND BUG: decision-targeted event leak ──────────────────────

describe('getActivityFeed — decision-targeted event visibility (the audit-bug)', () => {
  /**
   * The audit accompanying the milestone leak fix surfaced this one.
   * Decisions have no `clientVisible` column — visibility is entirely
   * permission-based via `decision.view`. CLIENT role does NOT have
   * this permission (see `shared/src/constants/roles.ts` —
   * CLIENT only has PROJECT_VIEW_ASSIGNED, TASK_VIEW_CLIENT_VISIBLE,
   * etc.; no DECISION_VIEW).
   *
   * Before this fix: `created_decision` rows carrying
   * `details: { title: 'Pivot away from AWS to GCP' }` showed up in
   * the CLIENT's activity feed even though the underlying
   * `GET /projects/:id/decisions` endpoint correctly returns 403.
   *
   * After this fix: decision-targeted events are gated on the
   * `decision.view` permission (`scope.canViewDecisions`, plumbed
   * through `computeVisibility`).
   */
  it('DROPS a decision-targeted event for a CLIENT viewer (lacks decision.view)', async () => {
    asViewer({}); // CLIENT — no view_all, no view_internal, no decision.view
    prismaMock.activity.findMany.mockResolvedValue([
      {
        id: 'a-decision',
        action: 'created_decision',
        createdAt: new Date('2026-05-15T10:00:00Z'),
        targetType: 'decision',
        targetId: 'dec-1',
        details: { title: 'Pivot away from AWS to GCP' },
        user: { id: 'u-admin', name: 'Anil', role: 'ADMIN' },
        project: { id: 'proj-1', name: 'Indigo', slug: 'indigo' },
      },
    ] as any);

    const result = await getActivityFeed('u-client', UserRole.CLIENT, {
      date: '2026-05-15',
      tzOffsetMinutes: 0,
    });

    expect(result.today.events).toEqual([]);
  });

  it('DROPS updated_decision and deleted_decision events for a CLIENT (every action variant)', async () => {
    // Catch a future regression where someone gates only
    // `created_decision` and forgets the update/delete shapes.
    asViewer({});
    prismaMock.activity.findMany.mockResolvedValue([
      {
        id: 'a-upd', action: 'updated_decision', createdAt: new Date('2026-05-15T10:00:00Z'),
        targetType: 'decision', targetId: 'dec-1',
        details: { title: 'Pivot away from AWS to GCP (rev 2)' },
        user: { id: 'u-admin', name: 'Anil', role: 'ADMIN' },
        project: { id: 'proj-1', name: 'Indigo', slug: 'indigo' },
      },
      {
        id: 'a-del', action: 'deleted_decision', createdAt: new Date('2026-05-15T11:00:00Z'),
        targetType: 'decision', targetId: 'dec-2',
        details: { title: 'Defer Q3 launch' },
        user: { id: 'u-admin', name: 'Anil', role: 'ADMIN' },
        project: { id: 'proj-1', name: 'Indigo', slug: 'indigo' },
      },
    ] as any);

    const result = await getActivityFeed('u-client', UserRole.CLIENT, {
      date: '2026-05-15',
      tzOffsetMinutes: 0,
    });

    expect(result.today.events).toEqual([]);
  });

  it('KEEPS a decision-targeted event for an ADMIN viewer (decision.view granted)', async () => {
    asViewer({ all: true, internal: true, decision: true });
    prismaMock.activity.findMany.mockResolvedValue([
      {
        id: 'a-decision',
        action: 'created_decision',
        createdAt: new Date('2026-05-15T10:00:00Z'),
        targetType: 'decision',
        targetId: 'dec-1',
        details: { title: 'Internal-only decision' },
        user: { id: 'u-admin', name: 'Anil', role: 'ADMIN' },
        project: { id: 'proj-1', name: 'Indigo', slug: 'indigo' },
      },
    ] as any);

    const result = await getActivityFeed('u-admin', UserRole.ADMIN, {
      date: '2026-05-15',
      tzOffsetMinutes: 0,
    });

    expect(result.today.events).toHaveLength(1);
    expect(result.today.events[0]?.action).toBe('created_decision');
  });

  it('KEEPS a decision-targeted event for an ENGINEER viewer (engineer has decision.view too)', async () => {
    // Engineer has decision.view but lacks view_all (so they go
    // through the membership-scoped path). Pins that the decision
    // filter is GRANT-based, not gated on view_internal.
    asViewer({ internal: true, decision: true });
    prismaMock.activity.findMany.mockResolvedValue([
      {
        id: 'a-decision', action: 'created_decision',
        createdAt: new Date('2026-05-15T10:00:00Z'),
        targetType: 'decision', targetId: 'dec-1',
        details: { title: 'Technology choice' },
        user: { id: 'u-eng', name: 'Vikram', role: 'ENGINEER' },
        project: { id: 'proj-1', name: 'Indigo', slug: 'indigo' },
      },
    ] as any);

    const result = await getActivityFeed('u-eng', UserRole.ENGINEER, {
      date: '2026-05-15',
      tzOffsetMinutes: 0,
    });

    expect(result.today.events).toHaveLength(1);
  });
});

// ─── hydrateTransitions: today doneTasks groups ────────────────────────

describe('getActivityFeed — today.doneTasks hydration (hydrateTransitions)', () => {
  it('groups DONE-today tasks by project + hydrates comments', async () => {
    // Pre-fix coverage gap: hydrateTransitions had zero tests — every
    // existing test passed an empty taskStatusHistory result. Real
    // path exercises the comment-join, the de-dup, and groupByProject.
    //
    // `getActivityFeed` fires `taskStatusHistory.findMany` twice in
    // sequence (today bucket, then week-shipped bucket), so we set
    // up the queue with `mockResolvedValueOnce` calls — first =
    // today, second = empty week.
    asViewer({ internal: true });
    prismaMock.taskStatusHistory.findMany
      .mockResolvedValueOnce([
        {
          taskId: 't1',
          changedAt: new Date('2026-05-15T15:00:00Z'),
          user: { id: 'u1', name: 'Anil', role: 'ENGINEER' },
          task: {
            id: 't1', title: 'Wire SSO', taskNumber: 42,
            taskType: 'FEATURE', priority: 'HIGH', storyPoints: 5,
            status: 'DONE', clientVisible: true,
            project: { id: 'proj-1', name: 'Indigo', slug: 'indigo' },
          },
        },
      ] as any)
      .mockResolvedValueOnce([] as any);
    prismaMock.comment.findMany.mockResolvedValue([
      {
        id: 'c1', taskId: 't1',
        content: 'Shipped after the rollback path passed prod-canary.',
        createdAt: new Date('2026-05-15T14:30:00Z'),
        author: { id: 'u1', name: 'Anil', role: 'ENGINEER' },
      },
    ] as any);

    const result = await getActivityFeed('u-eng', UserRole.ENGINEER, {
      date: '2026-05-15',
      tzOffsetMinutes: 0,
    });

    expect(result.today.doneTasks).toHaveLength(1);
    expect(result.today.doneTasks[0]).toMatchObject({
      project: { id: 'proj-1', name: 'Indigo' },
      tasks: [
        {
          id: 't1',
          title: 'Wire SSO',
          taskNumber: 42,
          storyPoints: 5,
          timestamp: '2026-05-15T15:00:00.000Z',
          comments: [{ id: 'c1', content: 'Shipped after the rollback path passed prod-canary.' }],
        },
      ],
    });
  });

  it('de-dups transitions when a task bounces in/out of DONE in the same window', async () => {
    // hydrateTransitions has explicit "keep first row per taskId"
    // logic. Transitions are passed in DESC order, so the most recent
    // bounce wins. This test pins that — if we re-implemented the
    // de-dup by accident in a way that kept the OLDEST, the timestamp
    // assertion would catch it.
    asViewer({ internal: true });
    prismaMock.taskStatusHistory.findMany.mockResolvedValueOnce([
      // Most recent first (DESC order from the service's `orderBy`).
      {
        taskId: 't1', changedAt: new Date('2026-05-15T17:00:00Z'),
        user: null,
        task: {
          id: 't1', title: 'Bouncy task', taskNumber: 1,
          taskType: 'FEATURE', priority: 'NORMAL', storyPoints: 2,
          status: 'DONE', clientVisible: true,
          project: { id: 'proj-1', name: 'Indigo', slug: 'indigo' },
        },
      },
      {
        // Earlier transition for the same task — must be dropped.
        taskId: 't1', changedAt: new Date('2026-05-15T10:00:00Z'),
        user: null,
        task: {
          id: 't1', title: 'Bouncy task', taskNumber: 1,
          taskType: 'FEATURE', priority: 'NORMAL', storyPoints: 2,
          status: 'DONE', clientVisible: true,
          project: { id: 'proj-1', name: 'Indigo', slug: 'indigo' },
        },
      },
    ] as any).mockResolvedValueOnce([] as any);
    prismaMock.comment.findMany.mockResolvedValue([] as any);

    const result = await getActivityFeed('u-eng', UserRole.ENGINEER, {
      date: '2026-05-15',
      tzOffsetMinutes: 0,
    });

    expect(result.today.doneTasks).toHaveLength(1);
    expect(result.today.doneTasks[0]?.tasks).toHaveLength(1);
    expect(result.today.doneTasks[0]?.tasks[0]?.timestamp).toBe('2026-05-15T17:00:00.000Z');
  });

  it('caps inline comments per task at 5 — keeps the activity feed scannable', async () => {
    asViewer({ internal: true });
    prismaMock.taskStatusHistory.findMany.mockResolvedValueOnce([
      {
        taskId: 't1', changedAt: new Date('2026-05-15T15:00:00Z'),
        user: { id: 'u1', name: 'Anil', role: 'ENGINEER' },
        task: {
          id: 't1', title: 'Chatty task', taskNumber: 9,
          taskType: 'BUG', priority: 'HIGH', storyPoints: null,
          status: 'DONE', clientVisible: true,
          project: { id: 'proj-1', name: 'Indigo', slug: 'indigo' },
        },
      },
    ] as any).mockResolvedValueOnce([] as any);
    prismaMock.comment.findMany.mockResolvedValue(
      Array.from({ length: 8 }).map((_, i) => ({
        id: `c${i}`,
        taskId: 't1',
        content: `Comment ${i}`,
        createdAt: new Date(`2026-05-15T1${i}:00:00Z`),
        author: { id: 'u1', name: 'Anil', role: 'ENGINEER' },
      })) as any,
    );

    const result = await getActivityFeed('u-eng', UserRole.ENGINEER, {
      date: '2026-05-15',
      tzOffsetMinutes: 0,
    });

    expect(result.today.doneTasks[0]?.tasks[0]?.comments).toHaveLength(5);
  });

  it('ties between projects fall back to task count then alphabetical name', async () => {
    // groupByProject sort cascade:
    //   1. story-point total desc
    //   2. task count desc
    //   3. project name asc
    // Two projects with identical SP totals (3 each), different task
    // counts: the higher count wins. If counts were also equal, name
    // ASC.
    asViewer({ internal: true });
    prismaMock.taskStatusHistory.findMany.mockResolvedValueOnce([
      {
        taskId: 't-a', changedAt: new Date('2026-05-15T15:00:00Z'),
        user: null,
        task: {
          id: 't-a', title: 'A task', taskNumber: 1,
          taskType: 'BUG', priority: 'NORMAL', storyPoints: 3,
          status: 'DONE', clientVisible: true,
          project: { id: 'proj-1', name: 'Indigo', slug: 'indigo' },
        },
      },
      {
        taskId: 't-b1', changedAt: new Date('2026-05-15T15:30:00Z'),
        user: null,
        task: {
          id: 't-b1', title: 'B1', taskNumber: 2,
          taskType: 'BUG', priority: 'NORMAL', storyPoints: 2,
          status: 'DONE', clientVisible: true,
          project: { id: 'proj-2', name: 'Saffron', slug: 'saffron' },
        },
      },
      {
        taskId: 't-b2', changedAt: new Date('2026-05-15T15:45:00Z'),
        user: null,
        task: {
          id: 't-b2', title: 'B2', taskNumber: 3,
          taskType: 'BUG', priority: 'NORMAL', storyPoints: 1,
          status: 'DONE', clientVisible: true,
          project: { id: 'proj-2', name: 'Saffron', slug: 'saffron' },
        },
      },
    ] as any).mockResolvedValueOnce([] as any);
    prismaMock.comment.findMany.mockResolvedValue([] as any);

    const result = await getActivityFeed('u-eng', UserRole.ENGINEER, {
      date: '2026-05-15',
      tzOffsetMinutes: 0,
    });

    // Both projects total 3 SP. proj-2 has 2 tasks vs proj-1's 1 →
    // proj-2 wins the count tiebreaker and ranks first.
    expect(result.today.doneTasks[0]?.project.id).toBe('proj-2');
    expect(result.today.doneTasks[1]?.project.id).toBe('proj-1');
  });

  it('full tie on SP + count falls back to alphabetical project name asc', async () => {
    // Same SP total (2), same task count (1): the third tiebreaker
    // kicks in — `project.name.localeCompare`. 'Aether' < 'Indigo',
    // so Aether ranks first.
    asViewer({ internal: true });
    prismaMock.taskStatusHistory.findMany.mockResolvedValueOnce([
      {
        taskId: 't-i', changedAt: new Date('2026-05-15T15:00:00Z'),
        user: null,
        task: {
          id: 't-i', title: 'I task', taskNumber: 1,
          taskType: 'BUG', priority: 'NORMAL', storyPoints: 2,
          status: 'DONE', clientVisible: true,
          project: { id: 'proj-i', name: 'Indigo', slug: 'indigo' },
        },
      },
      {
        taskId: 't-a', changedAt: new Date('2026-05-15T15:00:00Z'),
        user: null,
        task: {
          id: 't-a', title: 'A task', taskNumber: 2,
          taskType: 'BUG', priority: 'NORMAL', storyPoints: 2,
          status: 'DONE', clientVisible: true,
          project: { id: 'proj-a', name: 'Aether', slug: 'aether' },
        },
      },
    ] as any).mockResolvedValueOnce([] as any);
    prismaMock.comment.findMany.mockResolvedValue([] as any);

    const result = await getActivityFeed('u-eng', UserRole.ENGINEER, {
      date: '2026-05-15',
      tzOffsetMinutes: 0,
    });

    expect(result.today.doneTasks[0]?.project.name).toBe('Aether');
    expect(result.today.doneTasks[1]?.project.name).toBe('Indigo');
  });

  it('groups DONE-today tasks across two projects, sorted by story-point total desc', async () => {
    // groupByProject sorts groups by total story points. Two projects:
    // proj-2 has 8 points, proj-1 has 3. Expected order: proj-2 first.
    asViewer({ internal: true });
    prismaMock.taskStatusHistory.findMany.mockResolvedValueOnce([
      {
        taskId: 't-low', changedAt: new Date('2026-05-15T15:00:00Z'),
        user: null,
        task: {
          id: 't-low', title: 'Small fix', taskNumber: 1,
          taskType: 'BUG', priority: 'LOW', storyPoints: 3,
          status: 'DONE', clientVisible: true,
          project: { id: 'proj-1', name: 'Indigo', slug: 'indigo' },
        },
      },
      {
        taskId: 't-big', changedAt: new Date('2026-05-15T16:00:00Z'),
        user: null,
        task: {
          id: 't-big', title: 'Major feature', taskNumber: 2,
          taskType: 'FEATURE', priority: 'HIGH', storyPoints: 8,
          status: 'DONE', clientVisible: true,
          project: { id: 'proj-2', name: 'Saffron', slug: 'saffron' },
        },
      },
    ] as any).mockResolvedValueOnce([] as any);
    prismaMock.comment.findMany.mockResolvedValue([] as any);

    const result = await getActivityFeed('u-eng', UserRole.ENGINEER, {
      date: '2026-05-15',
      tzOffsetMinutes: 0,
    });

    expect(result.today.doneTasks).toHaveLength(2);
    expect(result.today.doneTasks[0]?.project.id).toBe('proj-2'); // higher SP
    expect(result.today.doneTasks[1]?.project.id).toBe('proj-1');
  });
});

// ─── This-week shipped + in-focus ───────────────────────────────────────

describe('getActivityFeed — thisWeek.shippedGroups + inFocus', () => {
  it('hydrates this-week shipped tasks separately from today', async () => {
    asViewer({ internal: true });
    // First findMany = today (empty), second = this-week.
    prismaMock.taskStatusHistory.findMany
      .mockResolvedValueOnce([] as any)
      .mockResolvedValueOnce([
        {
          taskId: 't-shipped', changedAt: new Date('2026-05-13T10:00:00Z'),
          user: null,
          task: {
            id: 't-shipped', title: 'Shipped Monday', taskNumber: 50,
            taskType: 'FEATURE', priority: 'NORMAL', storyPoints: 3,
            status: 'DONE', clientVisible: true,
            project: { id: 'proj-1', name: 'Indigo', slug: 'indigo' },
          },
        },
      ] as any);
    prismaMock.comment.findMany.mockResolvedValue([] as any);

    const result = await getActivityFeed('u-eng', UserRole.ENGINEER, {
      date: '2026-05-15',
      tzOffsetMinutes: 0,
    });

    expect(result.thisWeek.shippedGroups).toHaveLength(1);
    expect(result.thisWeek.shippedGroups[0]?.tasks[0]?.id).toBe('t-shipped');
    expect(result.today.doneTasks).toEqual([]); // today bucket distinct
  });

  it('inFocus IN_PROGRESS task uses the assignee as the actor', async () => {
    asViewer({ internal: true });
    prismaMock.task.findMany.mockResolvedValue([
      {
        id: 't-progress', title: 'Active task', taskNumber: 99,
        taskType: 'FEATURE', priority: 'NORMAL', storyPoints: 2,
        status: 'IN_PROGRESS', clientVisible: true,
        updatedAt: new Date('2026-05-15T10:00:00Z'),
        project: { id: 'proj-1', name: 'Indigo', slug: 'indigo' },
        assignee: { id: 'u-eng', name: 'Vikram', role: 'ENGINEER' },
        reviewer: { id: 'u-pm', name: 'Maya', role: 'PRODUCT_MANAGER' },
      },
    ] as any);

    const result = await getActivityFeed('u-eng', UserRole.ENGINEER, {
      date: '2026-05-15',
      tzOffsetMinutes: 0,
    });

    expect(result.thisWeek.inFocus).toHaveLength(1);
    // IN_PROGRESS → assignee, NOT reviewer
    expect(result.thisWeek.inFocus[0]?.actor).toMatchObject({ id: 'u-eng', name: 'Vikram' });
  });

  it('inFocus IN_REVIEW task uses the reviewer as the actor', async () => {
    // Coverage gap noted in vitest output: line 420 (the
    // `t.status === "IN_REVIEW" ? t.reviewer : t.assignee` branch).
    // Without this test the reviewer-actor branch is unexercised.
    asViewer({ internal: true });
    prismaMock.task.findMany.mockResolvedValue([
      {
        id: 't-review', title: 'Awaiting review', taskNumber: 100,
        taskType: 'FEATURE', priority: 'NORMAL', storyPoints: 3,
        status: 'IN_REVIEW', clientVisible: true,
        updatedAt: new Date('2026-05-15T10:00:00Z'),
        project: { id: 'proj-1', name: 'Indigo', slug: 'indigo' },
        assignee: { id: 'u-eng', name: 'Vikram', role: 'ENGINEER' },
        reviewer: { id: 'u-pm', name: 'Maya', role: 'PRODUCT_MANAGER' },
      },
    ] as any);

    const result = await getActivityFeed('u-eng', UserRole.ENGINEER, {
      date: '2026-05-15',
      tzOffsetMinutes: 0,
    });

    expect(result.thisWeek.inFocus[0]?.actor).toMatchObject({ id: 'u-pm', name: 'Maya' });
  });
});

// ─── Super-admin (canViewAll) path ──────────────────────────────────────

describe('getActivityFeed — super-admin canViewAll', () => {
  it('does NOT call projectMember.findMany when caller has project.view_all', async () => {
    // canViewAll short-circuits the membership lookup; allowedProjectIds
    // stays null and the activity query has no project scoping.
    asViewer({ all: true, internal: true, decision: true });

    await getActivityFeed('u-super', UserRole.SUPER_ADMIN, {
      date: '2026-05-15',
      tzOffsetMinutes: 0,
    });

    expect(prismaMock.projectMember.findMany).not.toHaveBeenCalled();
  });

  it('queries activity without a projectId IN clause when canViewAll', async () => {
    asViewer({ all: true, internal: true, decision: true });

    await getActivityFeed('u-super', UserRole.SUPER_ADMIN, {
      date: '2026-05-15',
      tzOffsetMinutes: 0,
    });

    const activityCall = prismaMock.activity.findMany.mock.calls[0]?.[0] as any;
    expect(activityCall.where.projectId).toBeUndefined();
  });
});

// ─── projectId scoping + mine filter ────────────────────────────────────

describe('getActivityFeed — projectId scope + mine=true', () => {
  it('honors explicit projectId option even when caller has wider membership', async () => {
    // Even a super-admin can pin to a single project via opts.projectId.
    asViewer({ all: true, internal: true, decision: true });

    await getActivityFeed('u-super', UserRole.SUPER_ADMIN, {
      date: '2026-05-15',
      tzOffsetMinutes: 0,
      projectId: 'proj-1',
    });

    const activityCall = prismaMock.activity.findMany.mock.calls[0]?.[0] as any;
    expect(activityCall.where.projectId).toBe('proj-1');
  });

  it('mine=true scopes activity feed and taskStatusHistory to the calling user', async () => {
    asViewer({ internal: true });

    await getActivityFeed('u-eng', UserRole.ENGINEER, {
      date: '2026-05-15',
      tzOffsetMinutes: 0,
      mine: true,
    });

    const activityCall = prismaMock.activity.findMany.mock.calls[0]?.[0] as any;
    expect(activityCall.where.userId).toBe('u-eng');

    // The DONE-today + week-shipped transitions are also scoped to
    // changedBy=u-eng so the "just my work" view doesn't surface the
    // team's tasks.
    const todayTransitionCall = prismaMock.taskStatusHistory.findMany.mock.calls[0]?.[0] as any;
    expect(todayTransitionCall.where.changedBy).toBe('u-eng');
  });
});

// ─── localDayWindow + date-string fallback ──────────────────────────────

describe('getActivityFeed — date / tz handling', () => {
  it('falls back to inferred-today when an invalid date string is supplied', async () => {
    // The service validates `opts.date` via /^\d{4}-\d{2}-\d{2}$/ —
    // anything that doesn't match (here: '2026/05/15' with slashes)
    // gets dropped and the server computes today from the offset.
    // This test pins the parsing branch without depending on a clock
    // mock — we just assert that `result.date` matches the
    // /YYYY-MM-DD/ shape.
    asViewer({ internal: true });

    const result = await getActivityFeed('u-eng', UserRole.ENGINEER, {
      date: 'not-a-date',
      tzOffsetMinutes: 0,
    });

    expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('shifts the day window by tzOffsetMinutes — IST viewer (offset -330) gets a different UTC window than UTC viewer', async () => {
    // IST is UTC+5:30. JS `getTimezoneOffset` returns minutes WEST of
    // UTC, so IST = -330. A query for "2026-05-15" in IST should
    // cover [May 14 18:30 UTC, May 15 18:30 UTC). For a UTC viewer
    // the same date string covers [May 15 00:00 UTC, May 16 00:00).
    asViewer({ internal: true });

    await getActivityFeed('u-eng', UserRole.ENGINEER, {
      date: '2026-05-15',
      tzOffsetMinutes: -330,
    });

    const todayTransitionCall = prismaMock.taskStatusHistory.findMany.mock.calls[0]?.[0] as any;
    expect(todayTransitionCall.where.changedAt.gte.toISOString()).toBe('2026-05-14T18:30:00.000Z');
    expect(todayTransitionCall.where.changedAt.lt.toISOString()).toBe('2026-05-15T18:30:00.000Z');
  });

  it('coerces a non-finite tzOffsetMinutes to 0', async () => {
    // Defensive: malformed `opts.tzOffsetMinutes` (NaN, undefined,
    // non-number from query string) should be treated as UTC, not
    // NaN-propagate into the date math.
    asViewer({ internal: true });

    await getActivityFeed('u-eng', UserRole.ENGINEER, {
      date: '2026-05-15',
      // @ts-expect-error — simulating a malformed query string
      tzOffsetMinutes: 'banana',
    });

    const todayTransitionCall = prismaMock.taskStatusHistory.findMany.mock.calls[0]?.[0] as any;
    expect(todayTransitionCall.where.changedAt.gte.toISOString()).toBe('2026-05-15T00:00:00.000Z');
  });
});

// ─── Legacy `getDoneToday` shim ─────────────────────────────────────────

describe('getDoneToday — legacy shim', () => {
  it('returns ONLY the today.doneTasks portion of the feed in the legacy { date, groups } shape', async () => {
    // The shim exists so unmerged feature branches or older API
    // consumers don't break before the new schema lands. Cover it
    // explicitly so a "looks unused, delete it" refactor catches a
    // test failure before catching a runtime one.
    asViewer({ internal: true });
    // Both transition findManys return an empty array; we just want
    // to validate the shape adaptation.
    const result = await (await import('./today.service')).getDoneToday('u-eng', UserRole.ENGINEER, {
      date: '2026-05-15',
      tzOffsetMinutes: 0,
    });

    expect(result).toMatchObject({
      date: '2026-05-15',
      groups: [],
    });
    // The shim returns the LEGACY shape — no `today`/`thisWeek`
    // envelope, just `{ date, groups }`.
    expect((result as any).today).toBeUndefined();
    expect((result as any).thisWeek).toBeUndefined();
  });
});
