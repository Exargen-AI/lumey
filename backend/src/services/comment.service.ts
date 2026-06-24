import { UserRole } from '@prisma/client';
import prisma from '../config/database';
import { COMMENT_LIST_CAP } from '../constants/listLimits';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { logActivity } from './activity.service';
import {
  createBulkNotifications,
  createNotification,
  notifyTaskSubscribersOfComment,
  notifyClientsOfStoryUpdate,
} from './notification.service';
import { checkPermission, canViewProjectInternal } from './rbac.service';
import { subscribeToTask, getSubscriberIdsForNotify } from './taskSubscription.service';
import { viewerCanSeeAgents } from '../lib/agentVisibility';
import { logger } from '../lib/logger';

/**
 * Find every project member whose name is @-mentioned in the comment
 * text. Replaces the original regex-only approach
 * (`/@([A-Za-z][A-Za-z ]{0,49})/g`) which had a known correctness
 * bug surfaced by the 2026-05-15 comments audit:
 *
 *   The character class `[A-Za-z ]` greedy-matches across spaces, so
 *   the most natural typing pattern — `@John how about that?` — was
 *   captured as the literal mention name `"John how about that"`,
 *   which then never matched any actual project member's name.
 *   Mentions only worked when the @-name was immediately followed by
 *   a non-letter/non-space character (period, comma, newline, end of
 *   string). The dominant typing pattern was silently broken.
 *
 * The new approach: load project members up front, then for each
 * member scan the text for `@${user.name}` bounded by a trailing
 * non-name char (or end of string). This handles:
 *
 *   ✓ "@John how are you" — finds John, stops at the space-letter
 *     boundary correctly
 *   ✓ "@John Smith hello" — finds "John Smith" if that user exists,
 *     OR finds "John" if there's only a "John" member (and stops at
 *     the space before "Smith")
 *   ✓ "@John," / "@John." / "@John\n" — finds John (non-letter
 *     terminator)
 *   ✓ "@John@" — finds John (next char isn't a letter)
 *
 * Edge case: if BOTH "John" and "John Smith" are project members,
 * a comment `@John Smith` will match both (worst case: a spurious
 * notification to plain-John). Acceptable — alternative is a
 * longest-match-first scan, which is overkill for the regression
 * fix. Document and move on.
 *
 * Caller is responsible for filtering out the author (self-skip).
 */
async function findMentionedMemberIds(projectId: string, text: string): Promise<Set<string>> {
  const members = await prisma.projectMember.findMany({
    where: { projectId },
    include: { user: { select: { id: true, name: true } } },
  });

  const mentioned = new Set<string>();
  for (const m of members) {
    const name = m.user?.name;
    if (!name) continue;
    // Escape regex metacharacters in the user's name. Names rarely
    // contain regex syntax, but defense-in-depth — `Mary (PM)` would
    // otherwise crash the comment.
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // `@${name}` followed by a non-name char or end-of-string. The
    // negative lookahead `(?![A-Za-z])` stops the match from
    // bleeding into the next word. The `escapedName` is regex-safe
    // (every metachar is backslash-escaped above) so the dynamic
    // RegExp construction here is safe from injection.
    // eslint-disable-next-line security/detect-non-literal-regexp
    const pattern = new RegExp(`@${escapedName}(?![A-Za-z])`, 'i');
    if (pattern.test(text)) {
      mentioned.add(m.userId);
    }
  }
  return mentioned;
}

export async function listProjectComments(
  projectId: string,
  viewer: { id?: string; role: UserRole; canViewAgents?: boolean | null },
) {
  const where: any = { projectId };

  // Visibility gate: viewers who can't see this project's internal work
  // only see comments on client-visible tasks/milestones (or general
  // project-level comments).
  // 2026-06-02: switched to the PER-PROJECT check so a CLIENT granted full
  // access on THIS project (ProjectMember.fullAccess) — or the legacy
  // global flag — sees internal-only comment threads here, while staying
  // restricted on other projects.
  const canViewInternal = await canViewProjectInternal(viewer, projectId);
  if (!canViewInternal) {
    where.OR = [
      { taskId: null, milestoneId: null },
      { task: { clientVisible: true } },
      { milestone: { clientVisible: true } },
    ];
  }

  // 2026-06-01 — Agent visibility lockdown. Hide comments authored by
  // an AI agent from anyone off the allowlist (SUPER_ADMIN passes).
  if (!viewerCanSeeAgents(viewer)) {
    where.author = { userType: { not: 'AGENT' } };
  }

  return prisma.comment.findMany({
    where,
    include: {
      author: { select: { id: true, name: true, role: true } },
    },
    orderBy: { createdAt: 'asc' },
    // Defensive ceiling (2026-06-01 hardening) — see constants/listLimits.
    take: COMMENT_LIST_CAP,
  });
}

export async function listTaskComments(
  taskId: string,
  viewer?: { role: UserRole; canViewAgents?: boolean | null },
) {
  const where: any = { taskId };
  // Hide agent-authored comments for unauthorised viewers. `viewer`
  // optional so internal callers default to the safe (hide) behaviour.
  if (!viewer || !viewerCanSeeAgents(viewer)) {
    where.author = { userType: { not: 'AGENT' } };
  }
  return prisma.comment.findMany({
    where,
    include: {
      author: { select: { id: true, name: true, role: true } },
    },
    orderBy: { createdAt: 'asc' },
    // Defensive ceiling (2026-06-01 hardening) — see constants/listLimits.
    take: COMMENT_LIST_CAP,
  });
}

/**
 * Render a story-update payload to the plaintext that lands in the
 * comment's `content` column. The structured `storyData` drives the FE
 * card; this text is the source of truth for full-text search, the
 * Pulse COMMUNICATION scorer, and any reader that doesn't understand the
 * `story_update` kind (graceful degradation). Server-owned so the stored
 * text always matches the structured fields.
 */
export type StoryUpdateInput = {
  objective: string;
  currentTask: string;
  reason?: string;
  impact?: string;
  designChange: 'none' | 'changed';
  designOriginal?: string;
  designNew?: string;
  progress: number;
  nextStep?: string;
};

export function renderStoryUpdateText(s: StoryUpdateInput): string {
  const lines: string[] = [`📊 Progress update — ${s.progress}%`, ''];
  lines.push(`Objective: ${s.objective}`);
  lines.push(`Current task: ${s.currentTask}`);
  if (s.reason?.trim()) lines.push(`Reason: ${s.reason.trim()}`);
  if (s.impact?.trim()) lines.push(`Impact: ${s.impact.trim()}`);
  if (s.designChange === 'changed') {
    lines.push(`Design change: ${s.designOriginal?.trim() || '—'} → ${s.designNew?.trim() || '—'}`);
  }
  if (s.nextStep?.trim()) lines.push(`Next step: ${s.nextStep.trim()}`);
  return lines.join('\n');
}

export async function createComment(projectId: string, data: any, userId: string) {
  // ── Story-update normalization (Ask 1, 2026-06) ───────────────────
  // A story_update is always task-scoped and the server owns its
  // rendered `content` (derived from `storyData`), so a client can't
  // post a "story update" whose human-readable text disagrees with its
  // structured fields. Done first so the rest of createComment — mention
  // parsing, the productivity event, content-length guard — operates on
  // the rendered text exactly as it would for a plain comment.
  const isStoryUpdate = data.kind === 'story_update';
  if (isStoryUpdate) {
    if (!data.taskId) {
      throw new ValidationError('A story update can only be posted on a task');
    }
    if (!data.storyData) {
      throw new ValidationError('storyData is required for a story update');
    }
    data.content = renderStoryUpdateText(data.storyData);
  }

  // Reject body-supplied taskId/milestoneId that doesn't actually live in
  // this project (QA finding #35). Without this, a member of project A can
  // POST /projects/A/comments with a taskId belonging to project B and
  // attach a comment to a task they shouldn't be commenting on.
  if (data.taskId) {
    const task = await prisma.task.findUnique({
      where: { id: data.taskId },
      select: { projectId: true },
    });
    if (!task || task.projectId !== projectId) {
      throw new ValidationError('taskId does not belong to this project');
    }
  }
  if (data.milestoneId) {
    const milestone = await prisma.milestone.findUnique({
      where: { id: data.milestoneId },
      select: { projectId: true },
    });
    if (!milestone || milestone.projectId !== projectId) {
      throw new ValidationError('milestoneId does not belong to this project');
    }
  }

  // Parse @-mentions up front (reads project membership rows) so the
  // notification fan-out below can target mentioned members.
  const mentionedIds = await findMentionedMemberIds(projectId, data.content);
  mentionedIds.delete(userId); // self-skip

  const comment = await prisma.$transaction(async (tx) => {
    const inner = await tx.comment.create({
      data: {
        projectId,
        content: data.content,
        taskId: data.taskId || null,
        milestoneId: data.milestoneId || null,
        authorId: userId,
        kind: isStoryUpdate ? 'story_update' : 'plain',
        storyData: isStoryUpdate ? data.storyData : undefined,
      },
      include: {
        author: { select: { id: true, name: true, role: true } },
      },
    });

    return inner;
  });

  await logActivity({
    userId, projectId, action: 'created_comment',
    targetType: data.taskId ? 'task' : data.milestoneId ? 'milestone' : 'project',
    targetId: data.taskId || data.milestoneId || projectId,
  });

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
  if (mentionedIds.size > 0) {
    await createBulkNotifications(
      Array.from(mentionedIds).map((mentionedUserId) => ({
        userId: mentionedUserId,
        type: 'mention',
        title: `${comment.author.name} mentioned you`,
        body: `In ${project?.name || 'a project'}: "${data.content.substring(0, 100)}"`,
        link: data.taskId ? `/projects/${projectId}/tasks/${data.taskId}` : `/projects/${projectId}`,
      }))
    ).catch((err) => logger.warn({ err: err?.message }, '[notify] mention notifications failed:')); // non-blocking
  }

  // ── CC feature PR 2026-05-20 — task subscriptions + fan-out ─────
  //
  // Two related actions, only when the comment is attached to a
  // task (project-level + milestone comments don't have a
  // "subscriber" concept — those use the project's activity stream).
  //
  //   1. Auto-subscribe every @-mentioned user to the task. A
  //      mention is an explicit "I want this person's attention"
  //      signal; subscribing keeps the loop open as the task
  //      evolves. Re-subscribe is idempotent so this is safe to
  //      fire on every comment.
  //
  //   2. Fan out a subscriber-comment notification. Dedupe vs the
  //      mention recipients (above) AND vs the comment author
  //      (always self-skip).
  if (data.taskId) {
    // Auto-subscribe mentioned users.
    for (const mentionedUserId of mentionedIds) {
      subscribeToTask(data.taskId, mentionedUserId, 'AUTO_MENTIONED')
        .catch((err) => logger.warn({ err: err?.message }, '[subscribe] AUTO_MENTIONED failed:'));
    }

    // Subscriber fan-out. Build the exclude set so we don't double-
    // notify users who already got a mention ping above.
    const exclude = new Set<string>([userId, ...mentionedIds]);
    const subscriberIds = await getSubscriberIdsForNotify(data.taskId, exclude);
    if (subscriberIds.length > 0) {
      const task = await prisma.task.findUnique({
        where: { id: data.taskId },
        select: { title: true },
      });
      if (task) {
        notifyTaskSubscribersOfComment({
          taskId: data.taskId,
          taskTitle: task.title,
          projectId,
          projectName: project?.name ?? 'a project',
          authorId: userId,
          authorName: comment.author.name,
          commentSnippet: data.content.substring(0, 100),
          subscriberIds,
        }).catch((err) => logger.warn({ err: err?.message }, '[notify] notifyTaskSubscribersOfComment failed:'));
      }
    }
  }

  // ── Story-update → client notification (Ask 1, 2026-06) ───────────
  //
  // The whole point of a story update is that the client sees it. Ping
  // every CLIENT member of the project who can see this task (the bell
  // in the client portal then carries the unread badge + deep link).
  // Non-blocking: a notification failure must not fail the post.
  if (isStoryUpdate && data.taskId) {
    const task = await prisma.task.findUnique({
      where: { id: data.taskId },
      select: { title: true },
    });
    notifyClientsOfStoryUpdate({
      taskId: data.taskId,
      taskTitle: task?.title ?? 'a task',
      projectId,
      authorId: userId,
      progress: data.storyData.progress,
      nextStep: data.storyData.nextStep,
    }).catch((err) => logger.warn({ err: err?.message }, '[notify] notifyClientsOfStoryUpdate failed:'));
  }

  return comment;
}

/**
 * Edit a comment's content. Author-only — admins can DELETE through the
 * existing path but mustn't be able to silently rewrite a member's words
 * (different trust posture: deletion leaves a gap, edit leaves a lie).
 *
 * Round 2 follow-up R2: previously there was no edit endpoint at all, so
 * a typo meant deleting + re-posting (which broke @-mention notifications,
 * timestamp ordering, and any thread quote that referenced the original).
 *
 * Validation parity with `createComment`:
 *   - 1..5000 chars after trim
 *   - Same UUID guard (route enforces)
 *   - Same membership check (must still be a member of the project that
 *     owns the comment — leaving the project means losing edit rights, same
 *     as Slack/Linear).
 */
export async function updateComment(
  commentId: string,
  // A plain edit passes the new body as a string (the original shape). A
  // story_update edit passes `{ storyData }` and the server re-renders the
  // content — the same "server owns the rendered text" rule as createComment,
  // so an edited update can't drift from its structured fields.
  update: string | { content?: string; storyData?: StoryUpdateInput },
  userId: string,
  // 2026-05-21 optimistic-locking expansion (matches Task pattern from
  // PR #128). Comments have less concurrent-edit risk than tasks but
  // a long thread where two reviewers edit a single comment at once
  // would otherwise silently lose one of them. OPT-IN.
  expectedUpdatedAt?: string,
) {
  const opts = typeof update === 'string' ? { content: update } : update;

  const comment = await prisma.comment.findUnique({ where: { id: commentId } });
  if (!comment) throw new NotFoundError('Comment');

  // Story updates re-render their content from the edited structured
  // fields; plain comments validate the supplied body. Either way the
  // result is `trimmed` — what lands in the content column.
  const isStoryUpdate = comment.kind === 'story_update';
  let trimmed: string;
  let storyData: StoryUpdateInput | undefined;
  if (isStoryUpdate) {
    if (!opts.storyData) throw new ValidationError('storyData is required to edit a story update');
    storyData = opts.storyData;
    trimmed = renderStoryUpdateText(opts.storyData);
  } else {
    trimmed = (opts.content ?? '').trim();
    if (trimmed.length === 0) throw new ValidationError('Comment cannot be empty');
    if (trimmed.length > 5000) throw new ValidationError('Comment exceeds 5000 chars');
  }

  // Early conflict detection before the auth + membership chain.
  // Comment uses `updatedAt` (managed by Prisma) — distinct from the
  // human-facing `editedAt` set by this same write.
  if (expectedUpdatedAt && comment.updatedAt.toISOString() !== expectedUpdatedAt) {
    throw new ConflictError(
      `This comment was edited by someone else. Refresh and reapply your changes. (server updatedAt: ${comment.updatedAt.toISOString()})`,
    );
  }

  // Author-only — admins may NOT edit other people's comments. Reads
  // membership server-side (not the bearer's role claim) so a member who
  // was removed from the project after authoring the comment can't still
  // edit it.
  if (comment.authorId !== userId) {
    throw new ForbiddenError('You can only edit your own comments');
  }
  // SUPER_ADMIN (and anyone else with `project.view_all`) can author
  // comments on any project they browse without first being added as a
  // member. Previously the membership check rejected them on edit even
  // though the create path doesn't enforce membership the same way —
  // matched the same gap as the project-acknowledgment bug.
  const [user, membership] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
    prisma.projectMember.findUnique({
      where: { userId_projectId: { userId, projectId: comment.projectId } },
    }),
  ]);
  if (!user) throw new ForbiddenError('User no longer exists');
  const canViewAllProjects = await checkPermission(user.role, 'project.view_all');
  if (!canViewAllProjects && !membership) {
    throw new ForbiddenError('Not a member of this project');
  }

  // For a story_update we also persist the edited structured fields.
  const writeData = isStoryUpdate
    ? { content: trimmed, editedAt: new Date(), storyData }
    : { content: trimmed, editedAt: new Date() };

  // Race-safe write — see milestone/task/sprint services for the
  // same pattern. updateMany lets us include `updatedAt` in the
  // where clause so a write that lost the race between our early
  // check and here surfaces as a 409.
  let updated;
  if (expectedUpdatedAt) {
    const result = await prisma.comment.updateMany({
      where: { id: commentId, updatedAt: comment.updatedAt },
      data: writeData,
    });
    if (result.count === 0) {
      const current = await prisma.comment.findUnique({
        where: { id: commentId },
        select: { updatedAt: true },
      });
      throw new ConflictError(
        `This comment was edited by someone else. Refresh and reapply your changes. (server updatedAt: ${current?.updatedAt.toISOString() ?? 'unknown'})`,
      );
    }
    const fresh = await prisma.comment.findUnique({
      where: { id: commentId },
      include: { author: { select: { id: true, name: true, role: true } } },
    });
    if (!fresh) throw new NotFoundError('Comment');
    updated = fresh;
  } else {
    updated = await prisma.comment.update({
      where: { id: commentId },
      data: writeData,
      include: { author: { select: { id: true, name: true, role: true } } },
    });
  }

  await logActivity({
    userId,
    projectId: comment.projectId,
    action: 'edited_comment',
    targetType: comment.taskId ? 'task' : comment.milestoneId ? 'milestone' : 'project',
    targetId: comment.taskId || comment.milestoneId || comment.projectId,
    // The diff itself isn't logged — comment text can be private (mentions
    // of customers, IP). Recording WHO edited WHEN is enough audit; if
    // forensic content is needed we can add a CommentRevision table later.
    details: { commentId },
  }).catch(() => { /* non-blocking */ });

  // ── Notify newly-added @-mentions (added by 2026-05-15 audit) ───
  //
  // Pre-fix: edits NEVER notified mentioned users, so the natural
  // "oh wait, I forgot to tag Sarah" follow-up edit was silent. Now
  // we re-scan the new content, find mentions, and DIFF against the
  // original — only the newly-added users get pinged, so we don't
  // double-notify someone who was mentioned in the first version.
  //
  // The "removed mentions" case (Sarah was in v1, edited out in v2)
  // is intentionally not handled — Sarah already got her v1 ping
  // and trying to "un-notify" is a UX rabbit hole.
  const oldMentions = await findMentionedMemberIds(comment.projectId, comment.content);
  const newMentions = await findMentionedMemberIds(comment.projectId, trimmed);
  const newlyMentioned = new Set<string>();
  for (const id of newMentions) {
    if (!oldMentions.has(id)) newlyMentioned.add(id);
  }
  newlyMentioned.delete(userId); // self-skip
  if (newlyMentioned.size > 0) {
    const project = await prisma.project.findUnique({ where: { id: comment.projectId }, select: { name: true } });
    await createBulkNotifications(
      Array.from(newlyMentioned).map((mentionedUserId) => ({
        userId: mentionedUserId,
        type: 'mention',
        title: `${updated.author.name} mentioned you`,
        body: `In ${project?.name || 'a project'}: "${trimmed.substring(0, 100)}"`,
        link: comment.taskId
          ? `/projects/${comment.projectId}/tasks/${comment.taskId}`
          : `/projects/${comment.projectId}`,
      })),
    ).catch((err) => logger.warn({ err: err?.message }, '[notify] edit-added mention notifications failed:'));
  }

  // ── Story-update edit → re-notify the client ──────────────────────
  // Editing an update (e.g. "now 80%, next step changed") matters to the
  // client just as much as the original post, so re-fire the same client
  // fan-out. Non-blocking, same as the create path.
  if (isStoryUpdate && storyData && comment.taskId) {
    const task = await prisma.task.findUnique({
      where: { id: comment.taskId },
      select: { title: true },
    });
    notifyClientsOfStoryUpdate({
      taskId: comment.taskId,
      taskTitle: task?.title ?? 'a task',
      projectId: comment.projectId,
      authorId: userId,
      progress: storyData.progress,
      nextStep: storyData.nextStep,
    }).catch((err) => logger.warn({ err: err?.message }, '[notify] story-update edit re-notify failed:'));
  }

  return updated;
}

export async function deleteComment(commentId: string, userId: string) {
  const comment = await prisma.comment.findUnique({ where: { id: commentId } });
  if (!comment) throw new NotFoundError('Comment');

  // Look up the actor's role + project membership server-side rather than
  // trusting the bearer token. Catches the case where a user was removed from
  // a project but still holds an old comment id (QA finding #4).
  const [user, membership] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
    prisma.projectMember.findUnique({
      where: { userId_projectId: { userId, projectId: comment.projectId } },
    }),
  ]);
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';

  // Admins moderate cross-project; everyone else must still be a member of
  // the project the comment lives on AND be the author.
  if (!isAdmin) {
    if (!membership) throw new ForbiddenError('Not a member of this project');
    if (comment.authorId !== userId) {
      throw new ForbiddenError('You can only delete your own comments');
    }
  }

  await prisma.comment.delete({ where: { id: commentId } });

  // ── Audit log + author notification (added by 2026-05-15 audit) ─
  //
  // Pre-fix: deleteComment fired ZERO activity-log row and ZERO
  // notification. The result was silent moderation — an admin could
  // remove a member's words with no trail and no signal back to the
  // author. Both gaps:
  //
  //   1. **Activity log** — every other comment mutation (create,
  //      edit) logs. The asymmetry meant "show me everything that
  //      happened in this project" had a hole exactly where you'd
  //      most want a record (destructive moderation).
  //
  //   2. **Author notification** — when an admin/PM removes someone
  //      else's comment, the author should know their content was
  //      removed. Silent removal feels hostile (Slack/Linear/Notion
  //      all surface this).
  //
  // Both fire AFTER the delete is committed and are non-blocking —
  // a notification failure must not undo a moderation decision.
  await logActivity({
    userId,
    projectId: comment.projectId,
    action: 'deleted_comment',
    targetType: comment.taskId ? 'task' : comment.milestoneId ? 'milestone' : 'project',
    targetId: comment.taskId || comment.milestoneId || comment.projectId,
    // Snapshot the first 100 chars so an admin auditing later can
    // see WHAT was deleted (without retaining the full text, which
    // could leak customer data the author later regretted typing).
    details: { commentId, contentSnippet: comment.content.substring(0, 100) },
  }).catch((err) => logger.warn({ err: err?.message }, '[activity] deleted_comment log failed:'));

  // Notify the author only if someone ELSE deleted their comment
  // (self-deletes don't need a self-ping).
  if (comment.authorId !== userId) {
    const project = await prisma.project.findUnique({
      where: { id: comment.projectId },
      select: { name: true },
    });
    await createNotification({
      userId: comment.authorId,
      type: 'comment_deleted',
      title: 'Your comment was removed',
      body: `A moderator removed your comment in ${project?.name || 'a project'}`,
      // Link to the surface the comment was on so the author can
      // see the conversation context.
      link: comment.taskId
        ? `/projects/${comment.projectId}/tasks/${comment.taskId}`
        : `/projects/${comment.projectId}`,
    }).catch((err) => logger.warn({ err: err?.message }, '[notify] comment-deleted notification failed:'));
  }
}
