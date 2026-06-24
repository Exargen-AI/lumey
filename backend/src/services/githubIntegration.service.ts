import crypto from 'crypto';
import { TaskStatus, type Prisma } from '@prisma/client';
import prisma from '../config/database';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';
import { assertLegalTransition, enforceDoneGate } from './task.service';
import { logActivity } from './activity.service';
import { logger } from '../lib/logger';

/**
 * GitHub PR linking — wires a project up to a GitHub repo so that any PR
 * mentioning a task identifier (FURIX-7, BOUNTIPOS-12) shows up on the task
 * page automatically. Optional auto-close on `Closes <ID>` + merge.
 *
 *  Flow:
 *   1. Admin POST /projects/:id/integrations/github { repoOwner, repoName }
 *      → server mints a webhook secret, returns it ONCE plus the webhook URL.
 *   2. Admin pastes both into GitHub repo Settings → Webhooks.
 *   3. Every PR event hits POST /integrations/github/webhook?projectId=…
 *      → we HMAC-verify with the per-project secret, parse the title/body for
 *      task IDs, and upsert TaskExternalLink rows. On `merged: true` with a
 *      `Closes <ID>` keyword, the matching task auto-transitions to DONE
 *      (subject to the same state-machine + AC done-gate the manual move
 *      uses — never bypasses our invariants).
 */

const KEYWORD_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+([A-Z]{2,10})-(\d+)/gi;
const REFERENCE_RE = /\b([A-Z]{2,10})-(\d+)\b/g;

/**
 * Pull task identifiers out of a PR's title + body. Returns two sets — IDs
 * referenced anywhere (always linked) and IDs flagged with a "closes"
 * keyword (eligible for auto-close on merge). Closes-keyword matches also
 * count as references; we de-dupe.
 */
export function extractTaskRefs(text: string): { references: Array<{ slug: string; number: number }>; closes: Array<{ slug: string; number: number }> } {
  const seenRef = new Set<string>();
  const refs: Array<{ slug: string; number: number }> = [];
  const seenClose = new Set<string>();
  const closes: Array<{ slug: string; number: number }> = [];

  // First pass: closes-keyword references.
  for (const match of text.matchAll(KEYWORD_RE)) {
    const slug = match[1].toLowerCase();
    const number = Number.parseInt(match[2], 10);
    const key = `${slug}-${number}`;
    if (!seenClose.has(key)) {
      seenClose.add(key);
      closes.push({ slug, number });
    }
    if (!seenRef.has(key)) {
      seenRef.add(key);
      refs.push({ slug, number });
    }
  }
  // Second pass: bare references. Doesn't double-count what closes already
  // captured.
  for (const match of text.matchAll(REFERENCE_RE)) {
    const slug = match[1].toLowerCase();
    const number = Number.parseInt(match[2], 10);
    const key = `${slug}-${number}`;
    if (!seenRef.has(key)) {
      seenRef.add(key);
      refs.push({ slug, number });
    }
  }
  return { references: refs, closes };
}

/**
 * Constant-time HMAC-SHA-256 verification matching GitHub's
 * `X-Hub-Signature-256: sha256=<hex>` header. Returns false on any
 * malformed/missing header rather than throwing — the route turns that into
 * a clean 401.
 */
export function verifyGitHubSignature(secret: string, payload: Buffer | string, header: string | undefined): boolean {
  if (!header || !header.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const provided = header.slice('sha256='.length);
  // Both buffers must be the same length for timingSafeEqual; bail fast on
  // mismatch to avoid throwing.
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(provided, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

interface ConnectInput {
  repoOwner: string;
  repoName: string;
  autoCloseOnMerge?: boolean;
  /**
   * Force-rotate the webhook secret. Default false on update so toggling
   * autoCloseOnMerge or fixing a typo in the repo name doesn't silently
   * invalidate the live webhook in GitHub (pre-launch finding B1). The
   * route layer maps an explicit `?rotate=true` query into this.
   */
  rotateSecret?: boolean;
}

/**
 * Connect or update a project's GitHub integration.
 *
 *  - First connect (no existing row): mints a fresh webhook secret and
 *    returns it ONCE in the response so the admin can paste it into GitHub.
 *  - Re-save (row already exists): preserves the existing secret by default,
 *    so changing the repo name or toggling auto-close doesn't break the
 *    webhook GitHub already has configured. Pass `rotateSecret: true` to
 *    explicitly mint a new one (covered by GET /...?rotate=true on the FE).
 *
 * The secret is never echoed through GET; it's only present in the response
 * when it was actually (re-)minted by this call.
 */
export async function connectGitHub(projectId: string, input: ConnectInput, actingUserId: string) {
  const repoOwner = input.repoOwner.trim();
  const repoName = input.repoName.trim();
  if (!/^[A-Za-z0-9._-]+$/.test(repoOwner) || !/^[A-Za-z0-9._-]+$/.test(repoName)) {
    throw new ValidationError('repoOwner and repoName must use GitHub-safe characters');
  }

  const existing = await prisma.projectGitHubIntegration.findUnique({
    where: { projectId },
    select: { webhookSecret: true },
  });
  const isNew = !existing;
  const shouldRotate = isNew || input.rotateSecret === true;
  // Only generate a fresh secret when actually rotating; otherwise keep the
  // existing one so the GitHub-side webhook keeps verifying.
  const webhookSecret = shouldRotate ? crypto.randomBytes(32).toString('hex') : existing!.webhookSecret;

  const integration = await prisma.projectGitHubIntegration.upsert({
    where: { projectId },
    create: {
      projectId,
      repoOwner,
      repoName,
      webhookSecret,
      autoCloseOnMerge: input.autoCloseOnMerge ?? false,
    },
    update: {
      repoOwner,
      repoName,
      // Conditionally include the secret — Prisma only updates fields
      // present on the object, so omitting it leaves the column untouched.
      ...(shouldRotate ? { webhookSecret } : {}),
      autoCloseOnMerge: input.autoCloseOnMerge ?? false,
    },
  });

  await logActivity({
    userId: actingUserId,
    projectId,
    action: isNew ? 'connected_github' : (shouldRotate ? 'rotated_github_secret' : 'updated_github'),
    targetType: 'project',
    targetId: projectId,
    details: { repo: `${repoOwner}/${repoName}`, rotatedSecret: shouldRotate },
  }).catch(() => { /* non-blocking */ });

  return {
    repoOwner: integration.repoOwner,
    repoName: integration.repoName,
    autoCloseOnMerge: integration.autoCloseOnMerge,
    // Only return the secret on a real (re-)mint. On a plain update we
    // return `null` so the caller knows it wasn't shown again — the admin
    // already has it in GitHub from the original connect.
    webhookSecret: shouldRotate ? webhookSecret : null,
    secretRotated: shouldRotate && !isNew,
    lastWebhookAt: integration.lastWebhookAt,
  };
}

/** Disconnect (drop the row + secret). Tolerant — no-op if not connected. */
export async function disconnectGitHub(projectId: string, actingUserId: string) {
  // Wrap delete + audit in one tx so we never end up with a row that's
  // gone but no audit trail (or vice-versa). Round 2 follow-up #19:
  // previously the two ops ran sequentially with the audit `.catch(() => {})`
  // — a DB hiccup between delete and audit would leave admins wondering
  // who killed the integration, and the missing trail would matter for
  // the security investigation when the next "who disabled this" question
  // comes up.
  await prisma.$transaction(async (tx) => {
    const existing = await tx.projectGitHubIntegration.findUnique({ where: { projectId } });
    if (!existing) return;
    await tx.projectGitHubIntegration.delete({ where: { projectId } });
    await logActivity({
      userId: actingUserId,
      projectId,
      action: 'disconnected_github',
      targetType: 'project',
      targetId: projectId,
      details: { repo: `${existing.repoOwner}/${existing.repoName}` },
    }, tx);
  });
}

/** Read the public-facing config (no secret). */
export async function getGitHubIntegration(projectId: string) {
  const row = await prisma.projectGitHubIntegration.findUnique({ where: { projectId } });
  if (!row) return null;
  return {
    repoOwner: row.repoOwner,
    repoName: row.repoName,
    autoCloseOnMerge: row.autoCloseOnMerge,
    lastWebhookAt: row.lastWebhookAt,
    // Surface error context so the FE can show a yellow/red pill and
    // a "last error" tooltip. Round 2 follow-up #11.
    lastWebhookErrorAt: row.lastWebhookErrorAt,
    lastWebhookError: row.lastWebhookError,
    // Never echo the secret back. The connect endpoint surfaced it once.
  };
}

/**
 * GitHub PR webhook handler — already past HMAC verification by the route
 * layer. Idempotent: redelivered events upsert the same row.
 */
interface GitHubPullRequestEvent {
  action: string;
  pull_request: {
    number: number;
    html_url: string;
    title: string;
    body: string | null;
    state: 'open' | 'closed';
    merged: boolean;
    user?: { login?: string; avatar_url?: string };
    merged_at?: string | null;
    closed_at?: string | null;
    created_at?: string;
  };
  repository: {
    full_name: string;
  };
}

export async function processPullRequestEvent(projectId: string, event: GitHubPullRequestEvent) {
  // We delay stamping `lastWebhookAt` until the END of this function so it
  // only reflects fully-processed events. Round 2 follow-up #11: previously
  // the timestamp was set up-front, which meant a string of failing webhooks
  // (DB error, project deleted mid-flight, malformed payload) still showed
  // a recent "last received" — admins had no way to know the integration
  // was broken. Now the timestamp gap between lastWebhookAt and now() tells
  // the real story; lastWebhookErrorAt + lastWebhookError pin down what
  // went wrong.
  try {
    const result = await processPullRequestEventInner(projectId, event);
    await prisma.projectGitHubIntegration
      .update({
        where: { projectId },
        // Only clear the error fields on success. Leaving them set across
        // a recovery would be misleading (admin opens settings, sees an old
        // error timestamp from yesterday, panics).
        data: { lastWebhookAt: new Date(), lastWebhookError: null },
      })
      .catch(() => { /* row may have been disconnected mid-flight */ });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.projectGitHubIntegration
      .update({
        where: { projectId },
        data: {
          lastWebhookErrorAt: new Date(),
          // 500-char cap matches the ValidationError convention elsewhere
          // and keeps the column from blowing up on a stack-trace dump.
          lastWebhookError: message.length > 500 ? `${message.slice(0, 500)}…` : message,
        },
      })
      .catch(() => { /* row may have been disconnected mid-flight */ });
    throw err;
  }
}

async function processPullRequestEventInner(projectId: string, event: GitHubPullRequestEvent) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, slug: true, name: true },
  });
  if (!project) return { linked: 0, transitioned: 0 };

  const integration = await prisma.projectGitHubIntegration.findUnique({
    where: { projectId },
    select: { autoCloseOnMerge: true },
  });

  const { references, closes } = extractTaskRefs(`${event.pull_request.title}\n\n${event.pull_request.body || ''}`);

  // Only references whose project-slug matches THIS project. A repo wired to
  // BountiPOS shouldn't update Furix tasks even if a clever PR mentions a
  // FURIX-7 ID. (Cross-project linking is a future feature gated behind a
  // separate permission.)
  const ourRefs = references.filter((r) => r.slug === project.slug.toLowerCase());
  const ourCloses = closes.filter((c) => c.slug === project.slug.toLowerCase());

  if (ourRefs.length === 0) return { linked: 0, transitioned: 0 };

  const tasks = await prisma.task.findMany({
    where: { projectId, taskNumber: { in: ourRefs.map((r) => r.number) } },
    select: { id: true, taskNumber: true, status: true, acceptanceCriteria: true, title: true },
  });
  const byNumber = new Map(tasks.map((t) => [t.taskNumber, t]));

  // Compute the new state based on PR action + merged flag.
  const newState = event.pull_request.merged
    ? 'MERGED'
    : event.pull_request.state === 'closed'
      ? 'CLOSED'
      : 'OPEN';

  const externalId = `${event.repository.full_name}#${event.pull_request.number}`;
  const linkData = {
    kind: 'GITHUB_PR' as const,
    externalId,
    url: event.pull_request.html_url,
    title: event.pull_request.title,
    state: newState as 'OPEN' | 'MERGED' | 'CLOSED',
    authorName: event.pull_request.user?.login ?? null,
    authorAvatar: event.pull_request.user?.avatar_url ?? null,
    openedAt: event.pull_request.created_at ? new Date(event.pull_request.created_at) : null,
    mergedAt: event.pull_request.merged_at ? new Date(event.pull_request.merged_at) : null,
    closedAt: event.pull_request.closed_at ? new Date(event.pull_request.closed_at) : null,
  };

  let linked = 0;
  let transitioned = 0;

  for (const ref of ourRefs) {
    const task = byNumber.get(ref.number);
    if (!task) continue; // Referenced an ID that doesn't exist (typo). Silent.

    await prisma.taskExternalLink.upsert({
      where: { taskId_kind_externalId: { taskId: task.id, kind: 'GITHUB_PR', externalId } },
      create: { taskId: task.id, ...linkData },
      update: linkData,
    });
    linked += 1;

    // Auto-close: only on `merged: true` AND the integration is opted in
    // AND the PR's text uses a `closes <ID>` keyword for THIS task.
    const hasCloseKeyword = ourCloses.some((c) => c.number === ref.number);
    if (
      event.pull_request.merged &&
      integration?.autoCloseOnMerge &&
      hasCloseKeyword
    ) {
      // Resolve the system actor BEFORE the transaction so a "no admin to
      // attribute" failure surfaces *before* we write anything (pre-launch
      // finding for the agent's #8). If there's no viable actor, we refuse
      // the auto-close cleanly without a half-committed task move.
      let actorId: string;
      try {
        actorId = await pickSystemActor(prisma, projectId);
      } catch (err) {
        logger.warn({ err, taskNumber: task.taskNumber }, '[github] auto-close skipped');
        continue;
      }

      try {
        // Re-read task state INSIDE the transaction so the gate runs against
        // the snapshot we're about to write on top of. Closes the TOCTOU
        // window where a user could (a) check off all AC items just before
        // the webhook lands → we'd skip auto-close based on stale data, or
        // (b) add a new unchecked AC between our load and write → the gate
        // would have stopped a manual move but our stale snapshot would
        // bypass it. (Pre-launch finding B3.)
        const moved = await prisma.$transaction(async (tx) => {
          const fresh = await tx.task.findUnique({
            where: { id: task.id },
            select: { status: true, acceptanceCriteria: true },
          });
          if (!fresh) return false; // Task was deleted between events.
          if (fresh.status === TaskStatus.DONE) return false; // Already done.

          // Same guards a manual `moveTask` uses. If the gate rejects, we
          // throw so the outer catch logs and the link stays saved while
          // the task remains where it was — a human can review.
          assertLegalTransition(fresh.status, TaskStatus.DONE);
          enforceDoneGate(fresh as { acceptanceCriteria: unknown }, TaskStatus.DONE);

          await tx.task.update({
            where: { id: task.id },
            data: { status: TaskStatus.DONE },
          });
          await tx.taskStatusHistory.create({
            data: {
              taskId: task.id,
              fromStatus: fresh.status,
              toStatus: TaskStatus.DONE,
              changedBy: actorId,
            },
          });
          return true;
        });

        if (moved) {
          transitioned += 1;
          // Fire-and-forget audit so the activity feed surfaces the auto-move.
          // Reuses the actor we resolved before the tx — same identity for
          // both rows means the audit reads consistently.
          await logActivity({
            userId: actorId,
            projectId,
            action: 'auto_closed_via_github',
            targetType: 'task',
            targetId: task.id,
            details: { taskTitle: task.title, prUrl: event.pull_request.html_url },
          }).catch(() => { /* non-blocking */ });
        }
      } catch (err) {
        // Done-gate or state-machine refused — that's fine. Leave the link,
        // skip the move, log a console line so admins can debug.
        logger.warn({ err, taskNumber: task.taskNumber }, '[github] auto-close skipped');
      }
    }
  }

  return { linked, transitioned };
}

/**
 * Pick a User.id to attribute system-driven changes to. Preference order:
 * (1) any active SUPER_ADMIN (the only role guaranteed in every workspace),
 * (2) any active member of this project. The activity log + status history
 * tables both have FK constraints on userId; using a synthetic uuid would
 * 500 the upsert.
 */
async function pickSystemActor(
  client: Prisma.TransactionClient | typeof prisma,
  projectId: string,
): Promise<string> {
  const superAdmin = await client.user.findFirst({
    where: { role: 'SUPER_ADMIN', isActive: true },
    select: { id: true },
  });
  if (superAdmin) return superAdmin.id;
  const member = await client.projectMember.findFirst({
    where: { projectId, user: { isActive: true } },
    select: { userId: true },
  });
  if (member) return member.userId;
  // No viable actor — surface as a hard error rather than silently mis-attributing.
  throw new ConflictError('No active user available to attribute auto-close');
}

/**
 * Read all linked external records for a task. Used by the FE "Linked PRs"
 * section. Sorted newest-first so the most relevant PR sits at the top.
 */
export async function getTaskExternalLinks(taskId: string) {
  return prisma.taskExternalLink.findMany({
    where: { taskId },
    orderBy: [{ state: 'asc' }, { mergedAt: 'desc' }, { createdAt: 'desc' }],
  });
}

// Type re-exports so route layer stays narrow.
export type { GitHubPullRequestEvent };
// Hoist NotFound + Forbidden to keep the import surface uniform with other
// services (some callers will throw 404 on missing project).
export { NotFoundError, ForbiddenError };
