/**
 * SDLC graph service — the run's software-delivery chain: commits → pull request
 * → CI checks. It is populated from two sources:
 *
 *   1. the agent's finalize tools as they fire (a commit on the run branch, a PR
 *      opened) — recorded by the native adapter, and
 *   2. GitHub webhooks (PR state changes, `check_run` events) — so CI status
 *      flows back onto the run after a human approves and the PR lands.
 *
 * Everything is idempotent (a commit by `(runId, sha)`, a PR/check by its
 * provider id) so webhook replays and tool retries never duplicate. The whole
 * point is to turn "a PR was opened" into a visible pipeline on the task card.
 */
import prisma from '../config/database';
import { CheckConclusion, CheckStatus, PrState } from '@prisma/client';

/** Record a commit the agent made on its run branch (idempotent on the sha). */
export async function recordRunCommit(input: { runId: string; sha: string; message: string; branch: string }) {
  return prisma.runCommit.upsert({
    where: { runId_sha: { runId: input.runId, sha: input.sha } },
    create: { runId: input.runId, sha: input.sha, message: input.message, branch: input.branch },
    update: { message: input.message, branch: input.branch },
  });
}

/** Record the PR a run opened (idempotent on its provider id). */
export async function recordRunPullRequest(input: {
  runId: string;
  externalId: string;
  number: number | null;
  url: string;
  title: string;
  branch: string;
  baseBranch: string;
}) {
  return prisma.runPullRequest.upsert({
    where: { externalId: input.externalId },
    create: { ...input },
    update: { url: input.url, title: input.title, number: input.number },
  });
}

/**
 * Update a run PR's state from a `pull_request` webhook. No-op (returns null) if
 * the PR isn't one we recorded for a run — the webhook also drives the
 * task-level link, which is handled separately.
 */
export async function updateRunPullRequestState(input: {
  externalId: string;
  state: PrState;
  mergedAt?: Date | null;
  closedAt?: Date | null;
}) {
  const existing = await prisma.runPullRequest.findUnique({ where: { externalId: input.externalId }, select: { id: true } });
  if (!existing) return null;
  return prisma.runPullRequest.update({
    where: { externalId: input.externalId },
    data: { state: input.state, mergedAt: input.mergedAt ?? null, closedAt: input.closedAt ?? null },
  });
}

// ─── check_run webhook ───

/** The slice of a GitHub `check_run` event payload we use. */
export interface GitHubCheckRunEvent {
  readonly action: string;
  readonly check_run: {
    readonly id: number;
    readonly name: string;
    readonly status: string; // queued | in_progress | completed
    readonly conclusion: string | null;
    readonly html_url?: string | null;
    readonly started_at?: string | null;
    readonly completed_at?: string | null;
    readonly check_suite?: { readonly head_branch?: string | null } | null;
  };
  readonly repository: { readonly full_name: string };
}

const STATUS_MAP: Record<string, CheckStatus> = {
  queued: CheckStatus.QUEUED,
  in_progress: CheckStatus.IN_PROGRESS,
  completed: CheckStatus.COMPLETED,
};

const CONCLUSION_MAP: Record<string, CheckConclusion> = {
  success: CheckConclusion.SUCCESS,
  failure: CheckConclusion.FAILURE,
  neutral: CheckConclusion.NEUTRAL,
  cancelled: CheckConclusion.CANCELLED,
  timed_out: CheckConclusion.TIMED_OUT,
  action_required: CheckConclusion.ACTION_REQUIRED,
  skipped: CheckConclusion.SKIPPED,
  stale: CheckConclusion.STALE,
};

/**
 * Attach a `check_run` to the run PR it belongs to. We match by the check's
 * head branch (the run branch `lumey/run-<id>`), scoped to the webhook's
 * project so a branch name can't cross projects. Idempotent on the check id, so
 * GitHub's repeated created/in_progress/completed deliveries converge.
 * Returns the upserted check, or null if no matching run PR exists.
 */
export async function processCheckRunEvent(projectId: string, event: GitHubCheckRunEvent) {
  const headBranch = event.check_run.check_suite?.head_branch;
  if (!headBranch) return null;

  const pr = await prisma.runPullRequest.findFirst({
    where: { branch: headBranch, run: { task: { projectId } } },
    orderBy: { openedAt: 'desc' },
    select: { id: true },
  });
  if (!pr) return null;

  const externalId = `${event.repository.full_name}#check#${event.check_run.id}`;
  const status = STATUS_MAP[event.check_run.status] ?? CheckStatus.QUEUED;
  const conclusion = event.check_run.conclusion ? CONCLUSION_MAP[event.check_run.conclusion] ?? null : null;
  const data = {
    name: event.check_run.name,
    status,
    conclusion,
    url: event.check_run.html_url ?? null,
    startedAt: event.check_run.started_at ? new Date(event.check_run.started_at) : null,
    completedAt: event.check_run.completed_at ? new Date(event.check_run.completed_at) : null,
  };
  return prisma.runCheck.upsert({
    where: { externalId },
    create: { runPullRequestId: pr.id, externalId, ...data },
    update: data,
  });
}

// ─── assembly (read) ───

/** The run's full delivery chain for the UI: commits → the PR → its checks. */
export async function getRunSdlc(runId: string) {
  const [commits, pullRequests] = await Promise.all([
    prisma.runCommit.findMany({ where: { runId }, orderBy: { committedAt: 'asc' } }),
    prisma.runPullRequest.findMany({
      where: { runId },
      orderBy: { openedAt: 'desc' },
      include: { checks: { orderBy: { name: 'asc' } } },
    }),
  ]);
  if (!pullRequests[0]) return { commits, pullRequest: null, checks: [] };
  const { checks, ...pullRequest } = pullRequests[0];
  return { commits, pullRequest, checks };
}
