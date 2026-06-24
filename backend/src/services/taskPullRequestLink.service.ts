/**
 * Link a pull request opened by an agent run to its task — the same
 * `TaskExternalLink` surface the GitHub webhook populates, so an agent-opened PR
 * shows up in the task's "Linked PRs" exactly like a human-opened one. Idempotent
 * on `(taskId, GITHUB_PR, externalId)`, so re-opening / replays don't double-link.
 */
import prisma from '../config/database';

export interface PullRequestLinkInput {
  readonly externalId: string;
  readonly url: string;
  readonly title?: string;
  readonly authorName?: string;
}

export async function linkPullRequestToTask(taskId: string, input: PullRequestLinkInput) {
  const linkData = {
    url: input.url,
    title: input.title ?? null,
    state: 'OPEN' as const,
    authorName: input.authorName ?? null,
    openedAt: new Date(),
  };
  return prisma.taskExternalLink.upsert({
    where: { taskId_kind_externalId: { taskId, kind: 'GITHUB_PR', externalId: input.externalId } },
    create: { taskId, kind: 'GITHUB_PR', externalId: input.externalId, ...linkData },
    update: linkData,
  });
}
