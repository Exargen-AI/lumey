/**
 * referenceGitProvider — a deterministic, dependency-free GitProvider for local
 * dev, demos, and tests. It fabricates a stable `PullRequestRef` from the branch
 * name (no remote, no push, no network), exactly where a real provider would
 * return the freshly-opened PR. The real `github` provider (push + create PR via
 * the project's GitHub integration) slots in behind the same seam.
 */
import type { GitProvider, PullRequestInput, PullRequestRef } from './gitProvider';

/** Deterministic small number from a string, so the same branch → same PR ref. */
function stableNumber(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 1_000_000;
  return (h % 999) + 1;
}

export const referenceGitProvider: GitProvider = {
  id: 'reference',
  async openPullRequest(input: PullRequestInput): Promise<PullRequestRef> {
    const n = stableNumber(input.branch);
    return {
      externalId: `local/sandbox#${n}`,
      url: `https://lumey.local/pull/${n}`,
      number: n,
      branch: input.branch,
    };
  },
};
