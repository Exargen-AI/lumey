/**
 * Pulse GitHub webhook ingestion — CODE signal (Wave 3, PR #33).
 *
 * Receives org-level GitHub webhook deliveries, HMAC-verifies them,
 * persists the raw delivery to `github_webhook_events`, maps the
 * actor's GitHub login to a Command Center user, and emits CODE
 * productivity events via the outbox.
 *
 * Separate from the existing per-project webhook at
 * `/api/v1/integrations/github/webhook` (which handles task-PR
 * linking). This webhook is intentionally org-level: we want
 * productivity events for ALL repos in the Exargen-AI org, not just
 * the ones that opted-in to project-task linking.
 *
 * Setup (one-time, SUPER_ADMIN):
 *   1. Create a GitHub App on github.com/settings/apps with scope
 *      "Pull requests: Read" + "Issues: Read" + "Repository contents:
 *      Read" + "Repository metadata: Read".
 *   2. Webhook URL:
 *      https://exargencommandcenter-production.up.railway.app/api/v1/webhooks/github/pulse
 *   3. Webhook secret: generate, store in env var
 *      PULSE_GITHUB_WEBHOOK_SECRET.
 *   4. Subscribe to events: push, pull_request, pull_request_review.
 *   5. Install on Exargen-AI org with org-wide repo access.
 *
 * Security:
 *   - HMAC-SHA256 verification against PULSE_GITHUB_WEBHOOK_SECRET on
 *     the raw request body. Constant-time compare in the handler.
 *   - Endpoint is anonymous (no JWT, no API key). The HMAC IS the
 *     auth boundary — GitHub is the only party with the secret.
 *   - All output (writes to productivity_events) gated by the
 *     `pulseCompositeScore.beta` feature flag via the outbox writer.
 *
 * De-dupe:
 *   - `github_webhook_events.deliveryId` is UNIQUE. Re-deliveries of
 *     the same delivery_id no-op on the second insert.
 *   - `productivity_events.(source, sourceId, eventType)` is UNIQUE.
 *     Different events from the same delivery (e.g. a push with N
 *     commits) get N distinct sourceIds.
 */

import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  emitProductivityEvent,
  emitProductivityEvents,
  type EmitProductivityEventInput,
} from '../lib/productivityOutbox';

/** Constant-time HMAC-SHA256 comparison against `X-Hub-Signature-256`. */
export function verifyPulseWebhookSignature(
  secret: string,
  rawBody: Buffer,
  headerValue: string | undefined,
): boolean {
  if (!headerValue || !headerValue.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const given = headerValue.slice('sha256='.length);
  // Both must be the same length OR timingSafeEqual throws.
  if (expected.length !== given.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(given));
  } catch {
    return false;
  }
}

/**
 * Known automation users — their PRs / reviews / commits don't credit
 * a human's CODE score. Match by login prefix (case-insensitive).
 */
const BOT_LOGIN_PATTERNS: RegExp[] = [
  /^dependabot/i,
  /^renovate/i,
  /^github-actions/i,
  /^codecov/i,
  /^stale\[bot\]$/i,
  /\[bot\]$/i, // GitHub's standard convention for app bots
];

export function isBotLogin(login: string | null | undefined): boolean {
  if (!login) return false;
  return BOT_LOGIN_PATTERNS.some((rx) => rx.test(login));
}

interface GithubUser {
  login?: string;
  type?: string;
}

interface GithubRepository {
  full_name?: string;
  default_branch?: string;
}

interface GithubPullRequest {
  number?: number;
  draft?: boolean;
  merged?: boolean;
  merged_at?: string | null;
  state?: string;
  user?: GithubUser;
  body?: string | null;
  additions?: number;
  deletions?: number;
  base?: { repo?: GithubRepository };
}

interface PullRequestEventPayload {
  action?: string;
  pull_request?: GithubPullRequest;
  sender?: GithubUser;
  repository?: GithubRepository;
}

interface PullRequestReviewEventPayload {
  action?: string;
  review?: { state?: string; user?: GithubUser };
  pull_request?: GithubPullRequest;
  sender?: GithubUser;
  repository?: GithubRepository;
}

interface PushEventPayload {
  ref?: string;
  before?: string;
  after?: string;
  commits?: Array<{
    id?: string;
    message?: string;
    author?: { username?: string; email?: string };
    added?: string[];
    modified?: string[];
    removed?: string[];
  }>;
  head_commit?: { id?: string };
  repository?: GithubRepository;
  pusher?: { name?: string };
  sender?: GithubUser;
}

/**
 * Identify the actor login for the top-level event. Prefers
 * `sender.login` (the human who triggered the delivery) over PR
 * author or commit author — sender is who CAUSED the delivery.
 */
function actorLoginFromPayload(payload: Record<string, unknown>): string | null {
  const sender = (payload as { sender?: GithubUser }).sender;
  const login = sender?.login?.toLowerCase() ?? null;
  return login;
}

function repoFromPayload(payload: Record<string, unknown>): string | null {
  const repo = (payload as { repository?: GithubRepository }).repository;
  return repo?.full_name ?? null;
}

/**
 * Top-level entry: process one delivery. Idempotent — on duplicate
 * deliveryId the github_webhook_events insert returns 0 affected rows
 * (skipDuplicates) and the function early-returns.
 *
 * Returns the number of productivity_events emitted (0 if the
 * delivery was a duplicate, an ignored event type, or had no actor
 * we could map to a user).
 */
export async function processPulseWebhookDelivery(
  tx: Prisma.TransactionClient,
  delivery: {
    deliveryId: string;
    eventType: string;
    rawBody: string; // already parsed by Express but kept for completeness
    payload: Record<string, unknown>;
  },
): Promise<{ emittedCount: number; deduped: boolean }> {
  const { deliveryId, eventType, payload } = delivery;
  const actorLogin = actorLoginFromPayload(payload);
  const actorIsBot = isBotLogin(actorLogin);
  const repo = repoFromPayload(payload);
  const action =
    typeof (payload as { action?: unknown }).action === 'string'
      ? ((payload as { action: string }).action)
      : null;

  // Write the audit row first. Unique index on deliveryId enforces
  // de-dup; createMany with skipDuplicates makes retries safe.
  const inserted = await tx.githubWebhookEvent.createMany({
    data: [
      {
        deliveryId,
        eventType: eventType.slice(0, 32),
        action: action ? action.slice(0, 32) : null,
        repo: repo ? repo.slice(0, 255) : null,
        actorLogin: actorLogin ? actorLogin.slice(0, 64) : null,
        actorIsBot,
        rawPayload: payload as Prisma.InputJsonValue,
        eventsEmitted: 0, // updated below if we emit
      },
    ],
    skipDuplicates: true,
  });
  if (inserted.count === 0) {
    return { emittedCount: 0, deduped: true };
  }

  // Map login → user id. Bot deliveries skip this lookup entirely (we
  // still want the audit row, but no productivity events fire).
  if (actorIsBot || !actorLogin) {
    return { emittedCount: 0, deduped: false };
  }

  const user = await tx.user.findUnique({
    where: { githubLogin: actorLogin },
    select: { id: true },
  });
  if (!user) {
    // No user mapped to this login — common during rollout before
    // SUPER_ADMIN has populated githubLogin for everyone. Audit row
    // still landed; recompute will skip.
    return { emittedCount: 0, deduped: false };
  }

  let emitInputs: EmitProductivityEventInput[] = [];

  switch (eventType) {
    case 'pull_request':
      emitInputs = buildPullRequestEmits(
        deliveryId,
        user.id,
        payload as PullRequestEventPayload,
        repo,
      );
      break;
    case 'pull_request_review':
      emitInputs = buildReviewEmits(
        deliveryId,
        user.id,
        payload as PullRequestReviewEventPayload,
        repo,
      );
      break;
    case 'push':
      emitInputs = buildPushEmits(deliveryId, user.id, payload as PushEventPayload, repo);
      break;
    case 'ping':
      // GitHub's first-time setup probe. Already audit-logged above.
      return { emittedCount: 0, deduped: false };
    default:
      // Unrecognized event — audit only.
      return { emittedCount: 0, deduped: false };
  }

  if (emitInputs.length === 0) {
    return { emittedCount: 0, deduped: false };
  }

  const emitted = await emitProductivityEvents(tx, emitInputs);

  // Update the audit row with the emission count. Single update by
  // deliveryId — small write.
  if (emitted > 0) {
    await tx.githubWebhookEvent.update({
      where: { deliveryId },
      data: { eventsEmitted: emitted },
    });
  }

  return { emittedCount: emitted, deduped: false };
}

function buildPullRequestEmits(
  deliveryId: string,
  userId: string,
  payload: PullRequestEventPayload,
  repo: string | null,
): EmitProductivityEventInput[] {
  const pr = payload.pull_request;
  if (!pr || typeof pr.number !== 'number') return [];

  const action = payload.action ?? '';
  const occurredAt = new Date();
  const authorLogin = pr.user?.login?.toLowerCase() ?? null;
  const authorIsBot = isBotLogin(authorLogin);
  const bodyLength = (pr.body ?? '').length;
  const additions = Number.isFinite(pr.additions) ? Number(pr.additions) : 0;
  const deletions = Number.isFinite(pr.deletions) ? Number(pr.deletions) : 0;
  const repoName = repo ?? pr.base?.repo?.full_name ?? null;

  const emits: EmitProductivityEventInput[] = [];

  if (action === 'opened') {
    emits.push({
      userId,
      signal: 'CODE',
      eventType: 'github.pr_opened',
      occurredAt,
      rawPayload: {
        prNumber: pr.number,
        repo: repoName,
        occurredAt: occurredAt.toISOString(),
        bodyLength,
        additions,
        deletions,
        authorIsBot,
        draft: pr.draft ?? false,
        deliveryId,
      },
      source: 'github',
      sourceId: `pr-opened-${repoName}-${pr.number}`,
    });
  } else if (action === 'closed' && pr.merged === true) {
    // Only MERGED closes credit; "closed without merging" is a no-op
    // for CODE — the opener still got opened credit.
    emits.push({
      userId,
      signal: 'CODE',
      eventType: 'github.pr_merged',
      occurredAt,
      rawPayload: {
        prNumber: pr.number,
        repo: repoName,
        occurredAt: occurredAt.toISOString(),
        bodyLength,
        additions,
        deletions,
        authorIsBot,
        deliveryId,
      },
      source: 'github',
      sourceId: `pr-merged-${repoName}-${pr.number}`,
    });
  }
  // 'edited', 'reopened', 'synchronize' etc. don't emit — they're
  // re-deliveries of state we already captured at the open/close
  // points.
  return emits;
}

function buildReviewEmits(
  deliveryId: string,
  reviewerUserId: string,
  payload: PullRequestReviewEventPayload,
  repo: string | null,
): EmitProductivityEventInput[] {
  const review = payload.review;
  const pr = payload.pull_request;
  if (!review || !pr || typeof pr.number !== 'number') return [];
  if (payload.action !== 'submitted') return [];

  const reviewerLogin = review.user?.login?.toLowerCase() ?? null;
  const reviewerIsBot = isBotLogin(reviewerLogin);
  const authorLogin = pr.user?.login?.toLowerCase() ?? null;
  const selfReview = reviewerLogin !== null && reviewerLogin === authorLogin;
  const state = (review.state ?? '').toLowerCase();
  const occurredAt = new Date();
  const repoName = repo ?? pr.base?.repo?.full_name ?? null;

  return [
    {
      userId: reviewerUserId,
      signal: 'CODE',
      eventType: 'github.pr_review',
      occurredAt,
      rawPayload: {
        prNumber: pr.number,
        repo: repoName,
        occurredAt: occurredAt.toISOString(),
        state,
        selfReview,
        reviewerIsBot,
        deliveryId,
      },
      source: 'github',
      // sourceId includes prNumber + reviewer so multiple reviews on the
      // same PR by the same reviewer (a rare but valid case) still dedupe.
      sourceId: `pr-review-${repoName}-${pr.number}-${reviewerLogin ?? 'unknown'}-${Date.now()}`,
    },
  ];
}

function buildPushEmits(
  deliveryId: string,
  userId: string,
  payload: PushEventPayload,
  repo: string | null,
): EmitProductivityEventInput[] {
  const commits = Array.isArray(payload.commits) ? payload.commits : [];
  // We only want commits to the default branch — feature-branch
  // commits will be counted when the PR merges (via the pr_merged
  // event). Without this filter we'd double-credit any commit that
  // both lives in a PR branch AND is later squash-merged.
  //
  // GitHub fires push events for every branch; the `ref` looks like
  // 'refs/heads/<branch>'. We compare against repository.default_branch.
  const ref = (payload.ref ?? '').replace(/^refs\/heads\//, '');
  const defaultBranch = payload.repository?.default_branch ?? null;
  if (defaultBranch && ref !== defaultBranch) return [];

  const occurredAt = new Date();
  return commits
    .filter((c): c is { id: string } & typeof c => typeof c?.id === 'string')
    .map((commit) => ({
      userId,
      signal: 'CODE' as const,
      eventType: 'github.commit',
      occurredAt,
      rawPayload: {
        commitSha: commit.id,
        repo,
        occurredAt: occurredAt.toISOString(),
        message: (commit.message ?? '').slice(0, 500),
        filesChanged:
          (commit.added?.length ?? 0) +
          (commit.modified?.length ?? 0) +
          (commit.removed?.length ?? 0),
        deliveryId,
      },
      source: 'github',
      sourceId: `commit-${repo ?? 'unknown'}-${commit.id}`,
    }));
}

// Re-export for the handler to use.
export { emitProductivityEvent };
