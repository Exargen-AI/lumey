/**
 * End-to-end integration tests for the CC features shipped in
 * PR #130 (subscriptions, nudge, encouragement) + #131 (FE wiring).
 *
 * These tests exercise the FULL request stack through supertest:
 *   request → express → JSON parser → validator → handler →
 *     service composition → notification helper (mocked) →
 *     activity log (mocked) → response shape
 *
 * Prisma is mocked via the existing `prismaMock` (deep mock) so
 * tests don't need a real Postgres. The notification + activity
 * helpers are mocked so we can assert "this notification fired"
 * without exercising the real fan-out.
 *
 * What this catches that unit tests can't:
 *
 *   - Route → handler wiring (a typo in a route param crashes
 *     here, not in unit tests).
 *   - Validator-middleware shape check on real request bodies
 *     (zod's strip mode silently drops unknown fields, etc.).
 *   - Service composition: e.g. createComment fires mentionParse
 *     + autoSubscribe + subscriberFanOut + activityLog all in
 *     the right order with the right exclude sets.
 *   - Error-handler mapping of thrown ConflictError /
 *     NotFoundError / ValidationError into HTTP status codes.
 *
 * Status codes asserted:
 *   - 200/201 happy paths
 *   - 409 Conflict for nudge cooldown + optimistic-lock conflict
 *   - 400 Validation for malformed bodies
 *   - 404 Not Found for missing resources
 */

import './../prismaMock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import supertest from 'supertest';
import { prismaMock } from '../prismaMock';

// ─── Env mock (must run BEFORE integrationHarness loads) ────────
// `integrationHarness` imports `errorHandler`, which imports
// `../config/env`. In CI's unit-test job, DATABASE_URL +
// JWT_*_SECRET aren't set, so the env validator at the top of
// env.ts calls `process.exit(1)` the moment the module is loaded,
// crashing the test worker. PR #129 hit the same shape; the fix
// pattern (matching `auth.service.test.ts`) is to mock the env
// module with a hoisted stub so the validator never runs.
//
// `vi.mock` is hoisted to the top of the file regardless of source
// order, but using `vi.hoisted` for the env object makes the
// dependency explicit + lets future tests mutate the stub.
const envHoisted = vi.hoisted(() => ({
  env: {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    JWT_ACCESS_SECRET: 'test-access-secret-at-least-32-characters-long',
    JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters-long',
    JWT_ACCESS_EXPIRY: '15m',
    JWT_REFRESH_EXPIRY: '7d',
    PORT: 3000,
  },
}));
vi.mock('../../config/env', () => ({
  __esModule: true,
  env: envHoisted.env,
}));

import {
  createTestApp,
  fakeUser,
  asAuthHeader,
  mockAuthAndAccessMiddleware,
} from '../integrationHarness';

// Mock auth + access middleware BEFORE importing the route modules
// (which transitively pull in the middleware). `vi.mock` is hoisted
// so this runs first regardless of source order.
mockAuthAndAccessMiddleware();

// Mock notification + activity helpers — tests assert the calls
// were made with the right shape, but we don't need them to
// actually write rows.
const {
  notifyMock,
} = vi.hoisted(() => ({
  notifyMock: {
    // ── Trigger helpers (fan-out from services) ─────────────
    notifyTaskAssigned: vi.fn().mockResolvedValue(undefined),
    notifyTaskBlocked: vi.fn().mockResolvedValue(undefined),
    notifyReviewRequested: vi.fn().mockResolvedValue(undefined),
    notifyReviewDecided: vi.fn().mockResolvedValue(undefined),
    notifyTaskDeleted: vi.fn().mockResolvedValue(undefined),
    notifyTaskPriorityChanged: vi.fn().mockResolvedValue(undefined),
    notifyTaskDueDateChanged: vi.fn().mockResolvedValue(undefined),
    notifyTaskNudge: vi.fn().mockResolvedValue(undefined),
    notifyTaskSubscribersOfComment: vi.fn().mockResolvedValue(undefined),
    notifyTaskSubscribersOfEdit: vi.fn().mockResolvedValue(undefined),
    notifyTaskCompletionEncouragement: vi.fn().mockResolvedValue(undefined),
    // ── Low-level write primitives (used by triggers) ───────
    createNotification: vi.fn().mockResolvedValue({}),
    createBulkNotifications: vi.fn().mockResolvedValue(undefined),
    // ── Receiver-side CRUD (consumed by the notification
    //    handler — DELETE/markAsRead/markAllAsRead/list/count).
    //    Without these the handler crashes with "not a
    //    function" the moment the integration test hits one
    //    of the receiver endpoints.
    getUserNotifications: vi.fn().mockResolvedValue({
      notifications: [], total: 0, unreadCount: 0, page: 1, limit: 20,
    }),
    getUnreadCount: vi.fn().mockResolvedValue(0),
    markAsRead: vi.fn().mockResolvedValue({ updated: 1 }),
    markAllAsRead: vi.fn().mockResolvedValue({ updated: 0 }),
    // deleteNotification has an in-test override per scenario
    // (sometimes returns deleted=1 → 200, sometimes deleted=0 →
    // 404). Default to deleted=0 so a missing setup is loud.
    deleteNotification: vi.fn().mockResolvedValue({ deleted: 0 }),
  },
}));

vi.mock('../../services/notification.service', () => ({
  __esModule: true,
  ...notifyMock,
}));

vi.mock('../../services/activity.service', () => ({
  __esModule: true,
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

// rbac.service is checked by some routes (e.g. updateTask checks
// task.edit_any). Mock to grant everything for these tests; the
// access-control matrix is verified separately in unit tests.
vi.mock('../../services/rbac.service', () => ({
  __esModule: true,
  checkPermission: vi.fn().mockResolvedValue(true),
}));

// customField.service has a Prisma-touching helper used inside
// updateTask. Mock to pass-through.
vi.mock('../../services/customField.service', () => ({
  __esModule: true,
  validateValuesForProject: vi.fn(async (_p, v) => v ?? {}),
}));

// Import the routes AFTER the mocks above so the mocked versions
// of the middleware + services are wired into them.
import taskRoutes from '../../routes/task.routes';
import commentRoutes from '../../routes/comment.routes';
import notificationRoutes from '../../routes/notification.routes';
import { bus } from '../../kernel';

const app = createTestApp([
  ['/api/v1', taskRoutes],
  ['/api/v1', commentRoutes],
  ['/api/v1', notificationRoutes],
]);
const request = supertest(app);

// Fixtures — UUIDs are real (the validator enforces UUID shape on
// route params + body fields). Test names use the short labels.
const ENG_ID = '11111111-1111-1111-1111-111111111111';
const PM_ID  = '22222222-2222-2222-2222-222222222222';
const QA_ID  = '33333333-3333-3333-3333-333333333333';
const PROJECT_ID = '44444444-4444-4444-4444-444444444444';
const TASK_ID    = '55555555-5555-5555-5555-555555555555';

const ENG = fakeUser({ id: ENG_ID, name: 'Vikram', role: 'ENGINEER' });
const PM  = fakeUser({ id: PM_ID,  name: 'Maya',   role: 'PRODUCT_MANAGER' });

function baseTask(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    projectId: PROJECT_ID,
    title: 'Wire SSO',
    description: 'OAuth2 with PKCE',
    status: 'TODO',
    priority: 'P2',
    storyPoints: 5,
    assigneeId: ENG.id,
    creatorId: PM.id,
    reviewerId: null,
    clientVisible: true,
    isBlocked: false,
    acceptanceCriteria: [],
    subtasks: [],
    customFields: {},
    dueDate: null,
    labels: [],
    updatedAt: new Date('2026-05-20T10:00:00.000Z'),
    createdAt: new Date('2026-05-19T10:00:00.000Z'),
    ...overrides,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  // $transaction pass-through so service-layer transactions
  // resolve against the same prismaMock client.
  (prismaMock.$transaction as any).mockImplementation(async (fn: any) => fn(prismaMock));
});

// ─── @-mention + auto-subscribe on comment ──────────────────────────────

describe('POST /api/v1/tasks/:id/comments — @-mention fan-out + auto-subscribe', () => {
  beforeEach(() => {
    // The comment service:
    //   1. (when taskId set) verifies the task belongs to the project
    //   2. creates the comment row
    //   3. logs activity
    //   4. scans mentions → fans out + auto-subscribes
    //   5. fetches the task for the subscribers-of-comment fan-out
    prismaMock.task.findUnique.mockResolvedValue({
      ...baseTask(),
      projectId: PROJECT_ID,
    } as any);
    prismaMock.comment.create.mockResolvedValue({
      id: 'c-1',
      projectId: PROJECT_ID,
      taskId: TASK_ID,
      milestoneId: null,
      content: 'placeholder',
      authorId: PM.id,
      author: { id: PM.id, name: PM.name, role: PM.role },
    } as any);
    prismaMock.project.findUnique.mockResolvedValue({ name: 'Indigo' } as any);
    // Project members for the mention scan
    prismaMock.projectMember.findMany.mockResolvedValue([
      { userId: ENG.id, user: { id: ENG.id, name: ENG.name } },
      { userId: PM.id, user: { id: PM.id, name: PM.name } },
    ] as any);
  });

  it('@-mentioned user gets a notification AND is auto-subscribed', async () => {
    // PM (the comment author) tags ENG. ENG should get a mention
    // notification AND be auto-subscribed to the task.
    prismaMock.taskSubscription.findMany.mockResolvedValue([] as any); // no other subscribers

    const res = await request
      .post(`/api/v1/projects/${PROJECT_ID}/comments`)
      .set(asAuthHeader(PM))
      .send({
        content: `@${ENG.name} can you take a look at this?`,
        taskId: TASK_ID,
      });

    expect(res.status).toBe(201);

    // Mention notification fires (uses createBulkNotifications path).
    expect(notifyMock.createBulkNotifications).toHaveBeenCalled();
    const bulkCall = notifyMock.createBulkNotifications.mock.calls[0]?.[0] as any[];
    expect(bulkCall).toBeDefined();
    expect(bulkCall.some((n: any) => n.userId === ENG.id && n.type === 'mention')).toBe(true);

    // Auto-subscribe row for the mentioned user.
    expect(prismaMock.taskSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId_userId: { taskId: TASK_ID, userId: ENG.id } },
        create: expect.objectContaining({ source: 'AUTO_MENTIONED' }),
      }),
    );
  });

  it('does NOT notify the author when they @-mention themselves (self-skip)', async () => {
    // PM authors a comment that tags PM (themselves). No self-ping.
    prismaMock.taskSubscription.findMany.mockResolvedValue([] as any);

    const res = await request
      .post(`/api/v1/projects/${PROJECT_ID}/comments`)
      .set(asAuthHeader(PM))
      .send({
        content: `cc @${PM.name}`,
        taskId: TASK_ID,
      });

    expect(res.status).toBe(201);
    // Bulk notify either never fired OR fired with no PM recipient.
    const allBulks = notifyMock.createBulkNotifications.mock.calls.flatMap(
      (c: any[]) => (c[0] as any[]) ?? [],
    );
    const mentionsForPm = allBulks.filter(
      (n: any) => n.type === 'mention' && n.userId === PM.id,
    );
    expect(mentionsForPm).toHaveLength(0);
  });

  it('publishes comment.created carrying the author + mentioned users', async () => {
    // Decoupled: the comment route's job is to ANNOUNCE the fact on the bus.
    // The notifications module subscribes to comment.created and fans out to
    // task subscribers (exclude-set + dedupe logic tested in
    // notifications.module.test). Here we assert the route emits the contract.
    const publishSpy = vi.spyOn(bus, 'publish');

    const res = await request
      .post(`/api/v1/projects/${PROJECT_ID}/comments`)
      .set(asAuthHeader(PM))
      .send({
        content: `@${ENG.name} thoughts on this design?`,
        taskId: TASK_ID,
      });

    expect(res.status).toBe(201);
    expect(publishSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'comment.created',
        authorId: PM.id,
        taskId: TASK_ID,
        mentionedUserIds: [ENG.id],
      }),
    );
    publishSpy.mockRestore();
  });
});

// ─── PUT /tasks/:id — subscriber-edit fan-out + optimistic locking ──────

describe('PUT /api/v1/tasks/:id — subscriber edit notifications + 409 conflict', () => {
  it('notifies subscribers when significant fields change (title)', async () => {
    const subUpdatedAt = new Date('2026-05-20T10:00:00.000Z');
    prismaMock.task.findUnique
      .mockResolvedValueOnce(baseTask({ updatedAt: subUpdatedAt }) as any)    // existing fetch
      .mockResolvedValueOnce(baseTask({ updatedAt: subUpdatedAt }) as any);   // post-update fetch (include path)
    prismaMock.task.updateMany.mockResolvedValue({ count: 1 } as any);
    prismaMock.task.update.mockResolvedValue({ ...baseTask(), title: 'Wire SSO — phase 2' } as any);
    prismaMock.project.findUnique.mockResolvedValue({ name: 'Indigo' } as any);
    prismaMock.user.findUnique.mockResolvedValue({ name: PM.name } as any);
    prismaMock.taskSubscription.findMany.mockResolvedValue([
      { userId: 'sub-1' },
    ] as any);

    const res = await request
      .put(`/api/v1/tasks/${TASK_ID}`)
      .set(asAuthHeader(PM))
      .send({
        title: 'Wire SSO — phase 2',
        expectedUpdatedAt: subUpdatedAt.toISOString(),
      });

    expect(res.status).toBe(200);
    expect(notifyMock.notifyTaskSubscribersOfEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        editorId: PM.id,
        changedFields: ['title'],
        subscriberIds: ['sub-1'],
      }),
    );
  });

  it('returns 409 when expectedUpdatedAt does not match the server (the lost-write race)', async () => {
    // Server's task was last updated at t1; caller passes t0 →
    // 409 with the backend's "refresh and reapply" message.
    const serverNow = new Date('2026-05-20T11:00:00.000Z');
    const stale = new Date('2026-05-20T10:00:00.000Z');
    prismaMock.task.findUnique.mockResolvedValue(
      baseTask({ updatedAt: serverNow }) as any,
    );

    const res = await request
      .put(`/api/v1/tasks/${TASK_ID}`)
      .set(asAuthHeader(PM))
      .send({
        title: 'Wire SSO — phase 2',
        expectedUpdatedAt: stale.toISOString(),
      });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toContain('edited by someone else');
    expect(res.body.error.message).toContain(serverNow.toISOString());
    // CRITICAL: no write fired.
    expect(prismaMock.task.update).not.toHaveBeenCalled();
    expect(prismaMock.task.updateMany).not.toHaveBeenCalled();
  });
});

// ─── POST /tasks/:id/nudge — happy path + cooldown + refusals ────────

describe('POST /api/v1/tasks/:id/nudge — happy path + cooldown + refusals', () => {
  beforeEach(() => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: TASK_ID,
      projectId: PROJECT_ID,
      title: 'Wire SSO',
      assigneeId: ENG.id,
      assignee: { id: ENG.id, name: ENG.name },
      project: { name: 'Indigo' },
    } as any);
    prismaMock.user.findUnique.mockResolvedValue({ name: PM.name } as any);
  });

  it('200 + notifies the assignee on first nudge (no cooldown yet)', async () => {
    prismaMock.taskNudge.findFirst.mockResolvedValue(null); // no prior nudge

    const res = await request
      .post(`/api/v1/tasks/${TASK_ID}/nudge`)
      .set(asAuthHeader(PM))
      .send({ message: 'client is waiting for an ETA' });

    expect(res.status).toBe(200);
    expect(prismaMock.taskNudge.create).toHaveBeenCalledWith({
      data: { taskId: TASK_ID, senderId: PM.id, message: 'client is waiting for an ETA' },
    });
    expect(notifyMock.notifyTaskNudge).toHaveBeenCalledWith(
      expect.objectContaining({
        nudgedUserId: ENG.id,
        nudgerName: PM.name,
        message: 'client is waiting for an ETA',
      }),
    );
  });

  it('200 even without a message (message is optional)', async () => {
    prismaMock.taskNudge.findFirst.mockResolvedValue(null);

    const res = await request
      .post(`/api/v1/tasks/${TASK_ID}/nudge`)
      .set(asAuthHeader(PM))
      .send({});

    expect(res.status).toBe(200);
  });

  it('409 + hours-left message when sender already nudged this task within 24h', async () => {
    // Most recent nudge was 5h ago → 19h cooldown remaining.
    const recent = new Date(Date.now() - 5 * 60 * 60 * 1000);
    prismaMock.taskNudge.findFirst.mockResolvedValue({ createdAt: recent } as any);

    const res = await request
      .post(`/api/v1/tasks/${TASK_ID}/nudge`)
      .set(asAuthHeader(PM))
      .send({ message: 'still waiting' });

    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/19 hours/);
    // Critical: no nudge row written when cooldown trips.
    expect(prismaMock.taskNudge.create).not.toHaveBeenCalled();
    expect(notifyMock.notifyTaskNudge).not.toHaveBeenCalled();
  });

  it('400 when the sender IS the assignee (self-nudge refused)', async () => {
    // ENG is the assignee on the fixture task and nudges themselves.
    const res = await request
      .post(`/api/v1/tasks/${TASK_ID}/nudge`)
      .set(asAuthHeader(ENG))
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/can't nudge yourself/i);
  });

  it('400 when the task has no assignee (nobody to nudge)', async () => {
    prismaMock.task.findUnique.mockResolvedValue({
      id: TASK_ID,
      projectId: PROJECT_ID,
      title: 'Orphan task',
      assigneeId: null,
      assignee: null,
      project: { name: 'Indigo' },
    } as any);

    const res = await request
      .post(`/api/v1/tasks/${TASK_ID}/nudge`)
      .set(asAuthHeader(PM))
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/no assignee/i);
  });

  it('400 when message exceeds 500-char limit (validator catches it)', async () => {
    const tooLong = 'x'.repeat(501);
    const res = await request
      .post(`/api/v1/tasks/${TASK_ID}/nudge`)
      .set(asAuthHeader(PM))
      .send({ message: tooLong });

    expect(res.status).toBe(400);
    // Service never ran — validator rejected at the boundary.
    expect(prismaMock.task.findUnique).not.toHaveBeenCalled();
  });
});

// ─── Subscribe / unsubscribe / list subscribers ──────────────────────

describe('Task subscriptions — subscribe/unsubscribe/list endpoints', () => {
  beforeEach(() => {
    prismaMock.task.findUnique.mockResolvedValue({ id: TASK_ID } as any);
  });

  it('POST /tasks/:id/subscribe creates a MANUAL subscription via upsert', async () => {
    const res = await request
      .post(`/api/v1/tasks/${TASK_ID}/subscribe`)
      .set(asAuthHeader(ENG));

    expect(res.status).toBe(200);
    expect(prismaMock.taskSubscription.upsert).toHaveBeenCalledWith({
      where: { taskId_userId: { taskId: TASK_ID, userId: ENG.id } },
      create: { taskId: TASK_ID, userId: ENG.id, source: 'MANUAL' },
      update: {},
    });
  });

  it('DELETE /tasks/:id/subscribe removes the subscription (idempotent)', async () => {
    prismaMock.taskSubscription.deleteMany.mockResolvedValue({ count: 1 } as any);

    const res = await request
      .delete(`/api/v1/tasks/${TASK_ID}/subscribe`)
      .set(asAuthHeader(ENG));

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ removed: 1 });
  });

  it('GET /tasks/:id/subscribers returns the full subscriber list with source badges', async () => {
    prismaMock.taskSubscription.findMany.mockResolvedValue([
      {
        userId: ENG.id,
        source: 'AUTO_ASSIGNEE',
        createdAt: new Date('2026-05-19T10:00:00Z'),
        user: { id: ENG.id, name: ENG.name, role: ENG.role },
      },
      {
        userId: PM.id,
        source: 'MANUAL',
        createdAt: new Date('2026-05-20T10:00:00Z'),
        user: { id: PM.id, name: PM.name, role: PM.role },
      },
    ] as any);

    const res = await request
      .get(`/api/v1/tasks/${TASK_ID}/subscribers`)
      .set(asAuthHeader(ENG));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    // Source badges round-trip correctly so the FE can render
    // "assigned" / "follows" chips.
    expect(res.body.data[0].source).toBe('AUTO_ASSIGNEE');
    expect(res.body.data[1].source).toBe('MANUAL');
  });
});

// ─── DONE encouragement + streak tone ────────────────────────────────

describe('PATCH /api/v1/tasks/:id/status — encouragement on DONE transition', () => {
  beforeEach(() => {
    (prismaMock.$transaction as any).mockImplementation(async (fn: any) => fn(prismaMock));
    prismaMock.task.findUnique.mockResolvedValue(
      baseTask({ status: 'IN_PROGRESS' }) as any,
    );
    prismaMock.task.update.mockResolvedValue(
      baseTask({ status: 'DONE' }) as any,
    );
    prismaMock.task.aggregate.mockResolvedValue({ _max: { sortOrder: 0 } } as any);
    prismaMock.project.findUnique.mockResolvedValue({ name: 'Indigo' } as any);
    prismaMock.taskStatusHistory.create.mockResolvedValue({} as any);
  });

  it('fires encouragement notification when status transitions IN_PROGRESS → DONE (count=1, plain tone)', async () => {
    prismaMock.taskStatusHistory.count.mockResolvedValue(1); // first DONE today

    const res = await request
      .patch(`/api/v1/tasks/${TASK_ID}/status`)
      .set(asAuthHeader(ENG))
      .send({ status: 'DONE' });

    expect(res.status).toBe(200);
    // Encouragement is fire-and-forget — drain microtasks before
    // asserting via vi.waitFor (similar to the unit test pattern).
    await vi.waitFor(() =>
      expect(notifyMock.notifyTaskCompletionEncouragement).toHaveBeenCalled(),
    );
    expect(notifyMock.notifyTaskCompletionEncouragement).toHaveBeenCalledWith(
      expect.objectContaining({
        completerId: ENG.id,
        tasksCompletedToday: 1,
      }),
    );
  });

  it('passes tasksCompletedToday: 5 when the user is on a streak (≥3 today)', async () => {
    prismaMock.taskStatusHistory.count.mockResolvedValue(5);

    const res = await request
      .patch(`/api/v1/tasks/${TASK_ID}/status`)
      .set(asAuthHeader(ENG))
      .send({ status: 'DONE' });

    expect(res.status).toBe(200);
    await vi.waitFor(() =>
      expect(notifyMock.notifyTaskCompletionEncouragement).toHaveBeenCalled(),
    );
    expect(notifyMock.notifyTaskCompletionEncouragement).toHaveBeenCalledWith(
      expect.objectContaining({ tasksCompletedToday: 5 }),
    );
  });

  it('does NOT fire encouragement on a non-DONE transition (IN_PROGRESS → IN_REVIEW)', async () => {
    prismaMock.task.update.mockResolvedValue(
      baseTask({ status: 'IN_REVIEW' }) as any,
    );

    const res = await request
      .patch(`/api/v1/tasks/${TASK_ID}/status`)
      .set(asAuthHeader(ENG))
      .send({ status: 'IN_REVIEW' });

    expect(res.status).toBe(200);
    // No race here — encouragement is fire-and-forget but the
    // call site is gated on `newStatus === 'DONE'` so it should
    // be deterministically NOT called.
    expect(notifyMock.notifyTaskCompletionEncouragement).not.toHaveBeenCalled();
  });
});

// ─── DELETE /notifications/:id ───────────────────────────────────────

describe('DELETE /api/v1/notifications/:id — graveyard-inbox fix', () => {
  it('200 when the notification belongs to the caller', async () => {
    notifyMock.deleteNotification.mockResolvedValueOnce({ deleted: 1 });

    const NOTIF_ID = '66666666-6666-6666-6666-666666666666';
    const res = await request
      .delete(`/api/v1/notifications/${NOTIF_ID}`)
      .set(asAuthHeader(ENG));

    expect(res.status).toBe(200);
    expect(notifyMock.deleteNotification).toHaveBeenCalledWith(NOTIF_ID, ENG.id);
  });

  it('404 when the notification id is stale or belongs to another user', async () => {
    // Default mock returns `{ deleted: 0 }` → handler should 404.
    notifyMock.deleteNotification.mockResolvedValueOnce({ deleted: 0 });

    const res = await request
      .delete(`/api/v1/notifications/77777777-7777-7777-7777-777777777777`)
      .set(asAuthHeader(ENG));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOTIFICATION_NOT_FOUND');
  });
});
