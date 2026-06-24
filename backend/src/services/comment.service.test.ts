/**
 * 2026-05-15 COMMENTS-AUDIT — three real bugs surfaced + fixed in
 * this PR. Tests below pin the fix.
 *
 * ## Bug A — @-mention regex broken for natural typing (HIGH)
 *
 *   Pre-fix: `/@([A-Za-z][A-Za-z ]{0,49})/g`. The character class
 *   `[A-Za-z ]` greedy-matches across spaces. So:
 *
 *     "@John, hello"       → captures "John" ✓ (comma stops)
 *     "@John how are you"  → captures "John how are you" 🐛
 *
 *   The captured "John how are you" never matches a project
 *   member's name, so no notification fired. The dominant typing
 *   pattern (`@Name followed by more words`) was silently broken.
 *
 *   Post-fix: load project members and scan the text for each
 *   `@${name}` bounded by a non-name char or end-of-string. See
 *   `findMentionedMemberIds` doc-comment for edge cases.
 *
 * ## Bug B — deleteComment fired zero audit log + zero notification (MEDIUM)
 *
 *   Pre-fix: `deleteComment` just called `prisma.comment.delete`.
 *   No activity row (the project's activity stream had a hole
 *   exactly where the destructive moderation event belonged); no
 *   notification to the author (silent moderation = hostile UX).
 *
 *   Post-fix: write `deleted_comment` activity log + ping the
 *   author when SOMEONE ELSE removes their comment.
 *
 * ## Bug C — updateComment didn't re-scan for new @-mentions (MEDIUM)
 *
 *   Pre-fix: only `createComment` parsed mentions. Editing in a new
 *   `@Sarah` didn't notify Sarah — the most natural way to add a
 *   forgotten tag was silent.
 *
 *   Post-fix: re-scan, diff against the original, notify only the
 *   newly-added mentions (existing mentions don't get pinged twice).
 */

import './../test/prismaMock';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prismaMock } from '../test/prismaMock';
import { ConflictError } from '../utils/errors';

const { checkPermissionSpy, checkPermissionForUserSpy, logActivitySpy } = vi.hoisted(() => ({
  checkPermissionSpy: vi.fn(),
  // 2026-05-30: listProjectComments switched from `checkPermission(role, key)`
  // to `checkPermissionForUser(viewer, key)` so the per-user extended
  // CLIENT grant is honoured. Tests below seed THIS spy; the legacy
  // `checkPermissionSpy` still drives the comment-create / edit paths
  // that pass a bare role.
  checkPermissionForUserSpy: vi.fn(),
  logActivitySpy: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./rbac.service', () => ({
  __esModule: true,
  checkPermission: checkPermissionSpy,
  checkPermissionForUser: checkPermissionForUserSpy,
  // listProjectComments now gates internal-comment visibility through the
  // per-project helper. Route it to the same spy the internal-gate tests
  // already drive so their toggles still apply.
  canViewProjectInternal: checkPermissionForUserSpy,
}));

vi.mock('./activity.service', () => ({
  __esModule: true,
  logActivity: logActivitySpy,
}));

// We use the real notification.service so we can assert on the
// `prisma.notification.create*` calls — that's the lowest-level
// surface this code controls.
import {
  createComment,
  updateComment,
  deleteComment,
  listProjectComments,
  listTaskComments,
  renderStoryUpdateText,
} from './comment.service';
import { UserRole } from '@prisma/client';

beforeEach(() => {
  checkPermissionSpy.mockReset();
  checkPermissionSpy.mockResolvedValue(false);
  checkPermissionForUserSpy.mockReset();
  checkPermissionForUserSpy.mockResolvedValue(false);
  logActivitySpy.mockReset();
  logActivitySpy.mockResolvedValue(undefined);
  prismaMock.notification.create.mockResolvedValue({} as any);
  prismaMock.notification.createMany.mockResolvedValue({ count: 0 } as any);
  prismaMock.project.findUnique.mockResolvedValue({ name: 'Indigo' } as any);
});

// ─── Bug A: @-mention regex correctness ─────────────────────────────────

describe('createComment — @-mention extraction (natural typing fix)', () => {
  // Two project members; the comment author is `john-id`.
  const members = [
    { userId: 'john-id', user: { id: 'john-id', name: 'John' } },
    { userId: 'sarah-id', user: { id: 'sarah-id', name: 'Sarah' } },
  ];

  beforeEach(() => {
    prismaMock.projectMember.findMany.mockResolvedValue(members as any);
    prismaMock.comment.create.mockResolvedValue({
      id: 'c1',
      projectId: 'proj-1',
      taskId: null,
      createdAt: new Date(),
      content: 'placeholder',
      author: { id: 'john-id', name: 'John', role: 'ENGINEER' },
    } as any);
    // PR #33 Wave 4: createComment now wraps create + outbox emit in a
    // $transaction. Mock invokes the callback with prismaMock as the
    // transactional client.
    (prismaMock.$transaction as any).mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.comment.findFirst.mockResolvedValue(null); // no prior thread comments
    prismaMock.productivityEvent.createMany.mockResolvedValue({ count: 0 } as any);
  });

  /**
   * THE PIVOTAL BUG REPRO. Pre-fix this would capture
   * "Sarah how are you" and never match any member.
   */
  it('NOTIFIES Sarah on "@Sarah how are you today?" (natural typing — words follow the @-name)', async () => {
    await createComment(
      'proj-1',
      { content: '@Sarah how are you today?' },
      'john-id',
    );

    expect(prismaMock.notification.createMany).toHaveBeenCalled();
    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    const userIds = call.data.map((d: any) => d.userId);
    expect(userIds).toContain('sarah-id');
  });

  it('NOTIFIES Sarah on "@Sarah," (comma terminator — already worked pre-fix; pinned as regression-guard)', async () => {
    await createComment(
      'proj-1',
      { content: '@Sarah, please review' },
      'john-id',
    );

    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    expect(call.data.map((d: any) => d.userId)).toContain('sarah-id');
  });

  it('NOTIFIES Sarah on "@Sarah" at end of message', async () => {
    await createComment(
      'proj-1',
      { content: 'cc: @Sarah' },
      'john-id',
    );

    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    expect(call.data.map((d: any) => d.userId)).toContain('sarah-id');
  });

  it('NOTIFIES both Sarah and a "Mary Jane Watson" member when each is mentioned', async () => {
    prismaMock.projectMember.findMany.mockResolvedValue([
      { userId: 'john-id', user: { id: 'john-id', name: 'John' } },
      { userId: 'sarah-id', user: { id: 'sarah-id', name: 'Sarah' } },
      { userId: 'mary-id', user: { id: 'mary-id', name: 'Mary Jane Watson' } },
    ] as any);

    await createComment(
      'proj-1',
      { content: '@Sarah and @Mary Jane Watson please confirm' },
      'john-id',
    );

    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    const userIds = call.data.map((d: any) => d.userId).sort();
    expect(userIds).toEqual(['mary-id', 'sarah-id']);
  });

  it('does NOT notify when nobody is mentioned', async () => {
    await createComment(
      'proj-1',
      { content: 'looks good to me' },
      'john-id',
    );

    expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
  });

  it('does NOT notify the author when they @-mention themselves (self-skip)', async () => {
    await createComment(
      'proj-1',
      { content: 'cc @John' },
      'john-id',
    );

    // The bulk call should not have fired with john-id as the
    // recipient. Since John was the only mention and it's a
    // self-skip, the call shouldn't fire at all.
    expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
  });

  it('handles names with regex special chars safely (e.g. "Mary (PM)")', async () => {
    // Defense-in-depth: the helper escapes regex metachars in the
    // user's name so a name like "Mary (PM)" doesn't crash the
    // pattern compile (the unescaped `(` is invalid alone).
    prismaMock.projectMember.findMany.mockResolvedValue([
      { userId: 'john-id', user: { id: 'john-id', name: 'John' } },
      { userId: 'mary-pm', user: { id: 'mary-pm', name: 'Mary (PM)' } },
    ] as any);

    await expect(
      createComment('proj-1', { content: '@Mary (PM) please review' }, 'john-id'),
    ).resolves.toBeDefined();

    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    expect(call.data.map((d: any) => d.userId)).toContain('mary-pm');
  });
});

// ─── Bug B: deleteComment audit log + author notification ───────────────

describe('deleteComment — audit log + author notification (silent-moderation fix)', () => {
  const ownerComment = {
    id: 'c1',
    projectId: 'proj-1',
    authorId: 'eng-1',
    taskId: 't1',
    milestoneId: null,
    content: 'A perfectly fine comment that an admin then removes',
  };

  it('WRITES a deleted_comment activity row on every delete', async () => {
    prismaMock.comment.findUnique.mockResolvedValue(ownerComment as any);
    prismaMock.user.findUnique.mockResolvedValue({ role: 'ADMIN' } as any);
    prismaMock.projectMember.findUnique.mockResolvedValue({ userId: 'admin-1' } as any);

    await deleteComment('c1', 'admin-1');

    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'deleted_comment',
        targetType: 'task',
        targetId: 't1',
        details: expect.objectContaining({ commentId: 'c1' }),
      }),
    );
  });

  it('SNAPSHOTS the first 100 chars of the deleted content in the audit row', async () => {
    const long = 'X'.repeat(200);
    prismaMock.comment.findUnique.mockResolvedValue({
      ...ownerComment,
      content: long,
    } as any);
    prismaMock.user.findUnique.mockResolvedValue({ role: 'ADMIN' } as any);
    prismaMock.projectMember.findUnique.mockResolvedValue({ userId: 'admin-1' } as any);

    await deleteComment('c1', 'admin-1');

    const logCall = logActivitySpy.mock.calls[0]?.[0] as any;
    expect(logCall.details.contentSnippet).toHaveLength(100);
    expect(logCall.details.contentSnippet).toBe('X'.repeat(100));
  });

  it('NOTIFIES the author when an ADMIN deletes their comment', async () => {
    prismaMock.comment.findUnique.mockResolvedValue(ownerComment as any);
    prismaMock.user.findUnique.mockResolvedValue({ role: 'ADMIN' } as any);
    prismaMock.projectMember.findUnique.mockResolvedValue({ userId: 'admin-1' } as any);

    await deleteComment('c1', 'admin-1');

    expect(prismaMock.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'eng-1',
        type: 'comment_deleted',
      }),
    });
  });

  it('does NOT notify the author on a SELF-delete (no self-ping)', async () => {
    prismaMock.comment.findUnique.mockResolvedValue(ownerComment as any);
    prismaMock.user.findUnique.mockResolvedValue({ role: 'ENGINEER' } as any);
    prismaMock.projectMember.findUnique.mockResolvedValue({ userId: 'eng-1' } as any);

    await deleteComment('c1', 'eng-1'); // self-delete

    expect(prismaMock.notification.create).not.toHaveBeenCalled();
    // Activity log still fires — destructive ops always get logged.
    expect(logActivitySpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'deleted_comment' }),
    );
  });

  it('still fires the delete itself even if notification or activity log fails (fire-and-forget)', async () => {
    prismaMock.comment.findUnique.mockResolvedValue(ownerComment as any);
    prismaMock.user.findUnique.mockResolvedValue({ role: 'ADMIN' } as any);
    prismaMock.projectMember.findUnique.mockResolvedValue({ userId: 'admin-1' } as any);
    logActivitySpy.mockRejectedValue(new Error('activity log down'));
    prismaMock.notification.create.mockRejectedValue(new Error('notify down'));

    // Must NOT throw — the delete already committed, and a
    // notification failure can't roll back the destructive op.
    await expect(deleteComment('c1', 'admin-1')).resolves.toBeUndefined();
    expect(prismaMock.comment.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
  });
});

// ─── Bug C: updateComment re-scans for new mentions ─────────────────────

describe('updateComment — newly-added @-mentions on edit (silent-edit fix)', () => {
  const ownerComment = {
    id: 'c1',
    projectId: 'proj-1',
    authorId: 'john-id',
    taskId: 't1',
    milestoneId: null,
    content: 'first draft, no mentions yet',
  };

  beforeEach(() => {
    prismaMock.comment.findUnique.mockResolvedValue(ownerComment as any);
    prismaMock.user.findUnique.mockResolvedValue({ role: 'ENGINEER' } as any);
    prismaMock.projectMember.findUnique.mockResolvedValue({ userId: 'john-id' } as any);
    prismaMock.projectMember.findMany.mockResolvedValue([
      { userId: 'john-id', user: { id: 'john-id', name: 'John' } },
      { userId: 'sarah-id', user: { id: 'sarah-id', name: 'Sarah' } },
      { userId: 'mary-id', user: { id: 'mary-id', name: 'Mary' } },
    ] as any);
    prismaMock.comment.update.mockResolvedValue({
      id: 'c1',
      content: 'placeholder',
      projectId: 'proj-1',
      taskId: 't1',
      author: { id: 'john-id', name: 'John', role: 'ENGINEER' },
    } as any);
  });

  it('NOTIFIES Sarah when she\'s added by edit (new mention)', async () => {
    await updateComment('c1', 'looks good, but @Sarah should confirm the rollback path', 'john-id');

    expect(prismaMock.notification.createMany).toHaveBeenCalled();
    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    expect(call.data.map((d: any) => d.userId)).toEqual(['sarah-id']);
  });

  it('does NOT re-notify Sarah if she was already mentioned in the original (diff-aware)', async () => {
    prismaMock.comment.findUnique.mockResolvedValue({
      ...ownerComment,
      content: '@Sarah please review',
    } as any);

    // Edit adds a wording change but keeps Sarah; she shouldn't
    // get re-pinged.
    await updateComment('c1', '@Sarah please review the PR when you get a sec', 'john-id');

    expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
  });

  it('NOTIFIES Mary but NOT Sarah when edit adds Mary and keeps Sarah', async () => {
    prismaMock.comment.findUnique.mockResolvedValue({
      ...ownerComment,
      content: '@Sarah please review',
    } as any);

    await updateComment('c1', '@Sarah and @Mary please review', 'john-id');

    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    expect(call.data.map((d: any) => d.userId)).toEqual(['mary-id']);
  });

  it('does NOT notify the author if they edit-add their own @-name (self-skip)', async () => {
    await updateComment('c1', 'I (@John) will follow up', 'john-id');

    expect(prismaMock.notification.createMany).not.toHaveBeenCalled();
  });

  it('throws ForbiddenError if a non-author tries to edit (existing behavior, regression-pin)', async () => {
    // The author check happens FIRST, so the mention re-scan path
    // doesn't even fire. Pinning that the failure mode hasn't
    // shifted.
    await expect(
      updateComment('c1', '@Sarah hi', 'mary-id'),
    ).rejects.toThrow(/can only edit your own comments/);

    expect(prismaMock.comment.update).not.toHaveBeenCalled();
  });
});

// ─── 2026-05-21 optimistic-locking expansion (PR #128 pattern → Comment) ─

describe('updateComment — optimistic locking', () => {
  const SERVER_UPDATED_AT = new Date('2026-05-21T10:00:00.000Z');
  const ACTOR = 'user-1';

  beforeEach(() => {
    // Author is the same as the actor so we don't trip the author-only
    // refusal. Membership stub: actor is a member of the project.
    // No taskId on the comment + no @-mentions in the new content →
    // the post-write mention-parse path is exercised but finds nothing.
    prismaMock.comment.findUnique.mockResolvedValue({
      id: 'c1',
      projectId: 'proj-1',
      authorId: ACTOR,
      taskId: null,
      milestoneId: null,
      content: 'Original',
      updatedAt: SERVER_UPDATED_AT,
    } as any);
    prismaMock.user.findUnique.mockResolvedValue({ role: 'ENGINEER' } as any);
    prismaMock.projectMember.findUnique.mockResolvedValue({ userId: ACTOR, projectId: 'proj-1' } as any);
    // Comment service walks projectMember.findMany during mention
    // parsing; return an empty member list so no fan-out fires.
    prismaMock.projectMember.findMany.mockResolvedValue([] as any);
  });

  it('writes through unchanged when expectedUpdatedAt is omitted', async () => {
    prismaMock.comment.update.mockResolvedValue({ id: 'c1', content: 'New' } as any);

    await updateComment('c1', 'New', ACTOR);

    expect(prismaMock.comment.update).toHaveBeenCalled();
    expect(prismaMock.comment.updateMany).not.toHaveBeenCalled();
  });

  it('uses updateMany with a compound where when expectedUpdatedAt matches', async () => {
    prismaMock.comment.updateMany.mockResolvedValue({ count: 1 } as any);
    // First findUnique → load the comment. Second → post-write re-fetch.
    prismaMock.comment.findUnique.mockResolvedValueOnce({
      id: 'c1', projectId: 'proj-1', authorId: ACTOR, content: 'Original', updatedAt: SERVER_UPDATED_AT,
    } as any);
    prismaMock.comment.findUnique.mockResolvedValueOnce({ id: 'c1', content: 'New' } as any);

    await updateComment('c1', 'New', ACTOR, SERVER_UPDATED_AT.toISOString());

    const args = (prismaMock.comment.updateMany as any).mock.calls[0]?.[0];
    expect(args.where).toEqual({ id: 'c1', updatedAt: SERVER_UPDATED_AT });
  });

  it('throws ConflictError at the EARLY check when expectedUpdatedAt is stale', async () => {
    await expect(
      updateComment('c1', 'New', ACTOR, new Date('2026-05-21T09:00:00.000Z').toISOString()),
    ).rejects.toBeInstanceOf(ConflictError);

    expect(prismaMock.comment.update).not.toHaveBeenCalled();
    expect(prismaMock.comment.updateMany).not.toHaveBeenCalled();
  });

  it('throws ConflictError at the WRITE-TIME check when the race wins (count=0)', async () => {
    prismaMock.comment.updateMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.comment.findUnique.mockResolvedValueOnce({
      id: 'c1', projectId: 'proj-1', authorId: ACTOR, updatedAt: SERVER_UPDATED_AT,
    } as any);
    prismaMock.comment.findUnique.mockResolvedValueOnce({ updatedAt: new Date() } as any);

    await expect(
      updateComment('c1', 'New', ACTOR, SERVER_UPDATED_AT.toISOString()),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

// ─── 2026-05-21 coverage expansion: untested list/read paths ─────────────

describe('listProjectComments — visibility filter', () => {
  beforeEach(() => {
    (prismaMock.comment.findMany as any).mockResolvedValue([]);
  });

  it('does NOT add the OR filter when the caller has task.view_internal (engineer)', async () => {
    checkPermissionForUserSpy.mockResolvedValueOnce(true);

    await listProjectComments('proj-1', { role: UserRole.ENGINEER });

    const where = (prismaMock.comment.findMany as any).mock.calls[0][0].where;
    // 2026-06-01: a normal engineer (not on the agent allowlist) also
    // gets agent-authored comments filtered out.
    expect(where).toEqual({
      projectId: 'proj-1',
      author: { userType: { not: 'AGENT' } },
    });
    expect(where.OR).toBeUndefined();
  });

  it('ADDS the client-visibility OR filter when the caller LACKS task.view_internal (CLIENT)', async () => {
    // Critical security property. A CLIENT user must NEVER see
    // comments on internal-only tasks/milestones. The OR clause
    // narrows to: project-level comments (no task/milestone) OR
    // comments on client-visible task OR comments on client-visible
    // milestone. Anything else is invisible.
    checkPermissionForUserSpy.mockResolvedValueOnce(false);

    await listProjectComments('proj-1', { role: UserRole.CLIENT });

    const where = (prismaMock.comment.findMany as any).mock.calls[0][0].where;
    expect(where.OR).toEqual([
      { taskId: null, milestoneId: null },
      { task: { clientVisible: true } },
      { milestone: { clientVisible: true } },
    ]);
  });

  // 2026-06-02 — per-project full access. When a CLIENT has
  // `ProjectMember.fullAccess` on this project, `canViewProjectInternal`
  // (routed to this spy in the module mock) returns true, so the
  // visibility filter stops adding the client-visible OR clause and the
  // client sees comments on internal-only tasks too.
  it('does NOT add the OR filter when the caller has full access to the project', async () => {
    // The spy seeds true to model the per-project grant succeeding.
    checkPermissionForUserSpy.mockResolvedValueOnce(true);

    await listProjectComments('proj-1', { id: 'client-1', role: UserRole.CLIENT });

    const where = (prismaMock.comment.findMany as any).mock.calls[0][0].where;
    // Full access lifts the OR visibility filter; the agent
    // author filter still applies (this client isn't on the agent
    // allowlist).
    expect(where).toEqual({
      projectId: 'proj-1',
      author: { userType: { not: 'AGENT' } },
    });
    expect(where.OR).toBeUndefined();
  });

  it('orders results by createdAt ASC (chronological — top to bottom)', async () => {
    checkPermissionForUserSpy.mockResolvedValueOnce(true);

    await listProjectComments('proj-1', { role: UserRole.ENGINEER });

    const args = (prismaMock.comment.findMany as any).mock.calls[0][0];
    expect(args.orderBy).toEqual({ createdAt: 'asc' });
  });

  it('includes the author summary (id + name + role) for UI rendering', async () => {
    checkPermissionForUserSpy.mockResolvedValueOnce(true);

    await listProjectComments('proj-1', { role: UserRole.ENGINEER });

    const args = (prismaMock.comment.findMany as any).mock.calls[0][0];
    expect(args.include.author.select).toEqual({ id: true, name: true, role: true });
  });
});

describe('listTaskComments — basic shape', () => {
  beforeEach(() => {
    (prismaMock.comment.findMany as any).mockResolvedValue([]);
  });

  it('filters by taskId (+ excludes agent authors for unauthorised viewers)', async () => {
    // listTaskComments has no client-visibility filter at the service
    // level (the route's taskAccess middleware gates "can you see the
    // task"). 2026-06-01: it DOES exclude agent-authored comments by
    // default — when no viewer is passed, or a viewer not on the agent
    // allowlist, agent comments are filtered out.
    await listTaskComments('task-1');

    const args = (prismaMock.comment.findMany as any).mock.calls[0][0];
    expect(args.where).toEqual({
      taskId: 'task-1',
      author: { userType: { not: 'AGENT' } },
    });
    expect(args.where.OR).toBeUndefined();
  });

  it('shows agent-authored comments to a viewer on the agent allowlist', async () => {
    await listTaskComments('task-1', { role: UserRole.ENGINEER, canViewAgents: true });
    const args = (prismaMock.comment.findMany as any).mock.calls[0][0];
    expect(args.where).toEqual({ taskId: 'task-1' });
  });

  it('orders by createdAt ASC', async () => {
    await listTaskComments('task-1', { role: UserRole.SUPER_ADMIN, canViewAgents: true });

    const args = (prismaMock.comment.findMany as any).mock.calls[0][0];
    expect(args.orderBy).toEqual({ createdAt: 'asc' });
  });
});

// ─── Story-update comments (Ask 1, 2026-06) ─────────────────────────────
//
// Engineers post a structured progress update against a task using the
// client-facing story template. The server owns the rendered `content`
// (so the stored text always matches the structured fields) and pings
// the project's clients so the update isn't buried.

describe('renderStoryUpdateText', () => {
  const base = {
    objective: 'Enable end-to-end event processing',
    currentTask: 'Updating parser service',
    designChange: 'none' as const,
    progress: 80,
  };

  it('always leads with the progress %, objective, and current task', () => {
    const text = renderStoryUpdateText(base);
    expect(text).toContain('📊 Progress update — 80%');
    expect(text).toContain('Objective: Enable end-to-end event processing');
    expect(text).toContain('Current task: Updating parser service');
  });

  it('omits optional sections (reason/impact/next step) when blank', () => {
    const text = renderStoryUpdateText({ ...base, reason: '   ', impact: '' });
    expect(text).not.toContain('Reason:');
    expect(text).not.toContain('Impact:');
    expect(text).not.toContain('Next step:');
  });

  it('renders a before→after line only when a design change is flagged', () => {
    const changed = renderStoryUpdateText({
      ...base,
      designChange: 'changed',
      designOriginal: 'Flat payload assumption',
      designNew: 'Recursive payload support',
    });
    expect(changed).toContain('Design change: Flat payload assumption → Recursive payload support');

    expect(renderStoryUpdateText(base)).not.toContain('Design change:');
  });
});

describe('createComment — story_update path', () => {
  const storyData = {
    objective: 'Enable end-to-end event processing',
    currentTask: 'Updating parser service',
    reason: 'Integration testing revealed nested payloads',
    impact: 'Enrichment + scoring depend on this',
    designChange: 'changed' as const,
    designOriginal: 'Flat payload assumption',
    designNew: 'Recursive payload support',
    progress: 80,
    nextStep: 'Complete integration testing',
  };

  beforeEach(() => {
    // task.findUnique is hit for the ownership check (projectId), the
    // story block (title), and notifyClientsOfStoryUpdate (clientVisible)
    // — one object satisfies all three selects.
    prismaMock.task.findUnique.mockResolvedValue({
      projectId: 'proj-1',
      title: 'Parser service',
      clientVisible: true,
    } as any);
    (prismaMock.$transaction as any).mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.comment.findFirst.mockResolvedValue(null);
    prismaMock.productivityEvent.createMany.mockResolvedValue({ count: 0 } as any);
    prismaMock.taskSubscription.findMany.mockResolvedValue([] as any);
    // Serves both the @-mention scan and the client-recipient lookup.
    prismaMock.projectMember.findMany.mockResolvedValue([
      { userId: 'client-1', fullAccess: true, user: { id: 'client-1', name: 'Acme', role: 'CLIENT' } },
    ] as any);
    prismaMock.comment.create.mockResolvedValue({
      id: 'c-story',
      projectId: 'proj-1',
      taskId: 't1',
      createdAt: new Date(),
      content: 'placeholder',
      author: { id: 'eng-1', name: 'Engineer', role: 'ENGINEER' },
    } as any);
  });

  it('persists kind="story_update" + storyData and a server-rendered content body', async () => {
    await createComment('proj-1', { taskId: 't1', kind: 'story_update', storyData }, 'eng-1');

    const createArg = prismaMock.comment.create.mock.calls[0]?.[0] as any;
    expect(createArg.data.kind).toBe('story_update');
    expect(createArg.data.storyData).toEqual(storyData);
    // Content is derived from the template, not from any client-supplied body.
    expect(createArg.data.content).toContain('📊 Progress update — 80%');
    expect(createArg.data.content).toContain('Objective: Enable end-to-end event processing');
  });

  it('notifies the project client with a portal deep link', async () => {
    await createComment('proj-1', { taskId: 't1', kind: 'story_update', storyData }, 'eng-1');
    // The client ping is fire-and-forget (a notify failure must not fail
    // the post), so flush the microtask/timer queue before asserting.
    await new Promise((resolve) => setImmediate(resolve));

    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    expect(call.data.map((d: any) => d.userId)).toContain('client-1');
    expect(call.data[0]).toMatchObject({
      type: 'story_update',
      link: '/client/projects/proj-1/tasks/t1',
    });
  });

  it('rejects a story_update with no taskId (task-scoped only)', async () => {
    await expect(
      createComment('proj-1', { kind: 'story_update', storyData }, 'eng-1'),
    ).rejects.toThrow(/can only be posted on a task/);
  });

  it('rejects a story_update with no storyData', async () => {
    await expect(
      createComment('proj-1', { taskId: 't1', kind: 'story_update' }, 'eng-1'),
    ).rejects.toThrow(/storyData is required/);
  });
});

describe('updateComment — story_update edit', () => {
  const newStory = {
    objective: 'Enable end-to-end event processing',
    currentTask: 'Wiring the enrichment stage',
    designChange: 'none' as const,
    progress: 90,
    nextStep: 'Ship to staging',
  };

  beforeEach(() => {
    prismaMock.comment.findUnique.mockResolvedValue({
      id: 'c-story',
      projectId: 'proj-1',
      authorId: 'eng-1',
      taskId: 't1',
      milestoneId: null,
      kind: 'story_update',
      content: '📊 Progress update — 80%',
      updatedAt: new Date('2026-06-19T00:00:00.000Z'),
    } as any);
    prismaMock.user.findUnique.mockResolvedValue({ role: 'ENGINEER' } as any);
    prismaMock.projectMember.findUnique.mockResolvedValue({ userId: 'eng-1' } as any);
    prismaMock.projectMember.findMany.mockResolvedValue([
      { userId: 'client-1', fullAccess: true, user: { id: 'client-1', name: 'Acme', role: 'CLIENT' } },
    ] as any);
    prismaMock.task.findUnique.mockResolvedValue({ title: 'Parser service', clientVisible: true } as any);
    prismaMock.comment.update.mockResolvedValue({
      id: 'c-story',
      projectId: 'proj-1',
      taskId: 't1',
      content: 'rendered',
      author: { id: 'eng-1', name: 'Engineer', role: 'ENGINEER' },
    } as any);
  });

  it('re-renders content from the edited fields and persists the new storyData', async () => {
    await updateComment('c-story', { storyData: newStory }, 'eng-1');

    const arg = prismaMock.comment.update.mock.calls[0]?.[0] as any;
    expect(arg.data.storyData).toEqual(newStory);
    expect(arg.data.content).toContain('📊 Progress update — 90%');
    expect(arg.data.content).toContain('Current task: Wiring the enrichment stage');
    expect(arg.data.editedAt).toBeInstanceOf(Date);
  });

  it('re-notifies the client on edit', async () => {
    await updateComment('c-story', { storyData: newStory }, 'eng-1');
    await new Promise((resolve) => setImmediate(resolve)); // fire-and-forget notify

    const call = prismaMock.notification.createMany.mock.calls[0]?.[0] as any;
    expect(call.data.map((d: any) => d.userId)).toContain('client-1');
    expect(call.data[0]).toMatchObject({ type: 'story_update', link: '/client/projects/proj-1/tasks/t1' });
  });

  it('rejects a story_update edit that omits storyData', async () => {
    await expect(
      updateComment('c-story', { content: 'just text' }, 'eng-1'),
    ).rejects.toThrow(/storyData is required/);
  });

  it('still rejects an edit from someone who is not the author', async () => {
    await expect(
      updateComment('c-story', { storyData: newStory }, 'someone-else'),
    ).rejects.toThrow(/only edit your own/);
  });
});
