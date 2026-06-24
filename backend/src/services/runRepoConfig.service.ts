/**
 * Resolve a task's run repository config from its **project**, replacing the
 * single-repo env bridge: each project's tasks open PRs against that project's
 * own GitHub repo. The access token stays a deployment secret (the integration
 * is webhook-inbound and stores none) — this only resolves *which* repo + base
 * branch, not the credential.
 */
import prisma from '../config/database';

export interface RunRepoConfig {
  readonly owner: string;
  readonly repo: string;
  readonly baseBranch: string;
}

/** The project's repo identity for a task, or null if it has no GitHub integration. */
export async function resolveRunRepoConfig(taskId: string): Promise<RunRepoConfig | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      project: {
        select: {
          githubIntegration: { select: { repoOwner: true, repoName: true, defaultBranch: true } },
        },
      },
    },
  });
  const gh = task?.project?.githubIntegration;
  if (!gh) return null;
  return { owner: gh.repoOwner, repo: gh.repoName, baseBranch: gh.defaultBranch };
}
