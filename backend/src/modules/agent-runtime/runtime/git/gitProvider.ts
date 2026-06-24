/**
 * The GitProvider seam — the firewall between the runtime and whatever hosts the
 * repo (GitHub, GitLab, a local simulator). Opening a PR is "push the run branch
 * and create a review request"; *how* that happens is provider-specific, but the
 * runtime only ever sees a neutral `PullRequestRef`. Same philosophy as the
 * RuntimeAdapter seam: swap hosts by writing a provider, never by touching the
 * loop or the tools.
 */

export interface PullRequestInput {
  /** The branch holding the run's work. */
  readonly branch: string;
  /** The branch to merge into. */
  readonly base: string;
  readonly title: string;
  readonly body: string;
}

/** A runtime-neutral reference to an opened pull request. */
export interface PullRequestRef {
  /** Provider-stable id, e.g. `owner/repo#42` — matches TaskExternalLink.externalId. */
  readonly externalId: string;
  readonly url: string;
  /** The PR number, when the provider exposes one. */
  readonly number: number | null;
  readonly branch: string;
}

export interface GitProvider {
  /** Stable id, e.g. `reference`, `github`. */
  readonly id: string;
  /** Push the branch (if needed) and open a PR; returns a neutral reference. */
  openPullRequest(input: PullRequestInput): Promise<PullRequestRef>;
}
