/**
 * The real `github` GitProvider — pushes the run branch and opens a pull request
 * via the GitHub REST API (raw fetch, no Octokit dependency). Same seam as the
 * reference simulator: the runtime above never knows which provider ran.
 *
 * Auth is a token passed in (the project's GitHub integration is webhook-inbound
 * only and stores no token, so the deployment supplies one — a GitHub App
 * installation token in production, or a PAT for local use). The token is used
 * for the authenticated push URL and the API call, and is redacted from any
 * surfaced git output so it never lands on the trace or in logs.
 */
import type { GitProvider, PullRequestInput, PullRequestRef } from './gitProvider';

export interface GitHubExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

export interface GitHubProviderConfig {
  /** Run git in the workspace (the sandbox's exec) to push the branch. */
  readonly exec: (command: string, args: string[]) => Promise<GitHubExecResult>;
  readonly token: string;
  readonly owner: string;
  readonly repo: string;
  /** Default `https://api.github.com`. */
  readonly apiBaseUrl?: string;
  /** Default `github.com` (override for GitHub Enterprise). */
  readonly gitHost?: string;
  readonly fetchImpl?: typeof fetch;
}

function truncate(s: string, n = 300): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function createGitHubProvider(cfg: GitHubProviderConfig): GitProvider {
  if (!cfg.token) throw new Error('createGitHubProvider: token is required');
  if (!cfg.owner || !cfg.repo) throw new Error('createGitHubProvider: owner and repo are required');
  const apiBase = (cfg.apiBaseUrl ?? 'https://api.github.com').replace(/\/$/, '');
  const gitHost = cfg.gitHost ?? 'github.com';
  const fetchImpl = cfg.fetchImpl ?? globalThis.fetch;
  const redact = (s: string): string => s.split(cfg.token).join('***');

  return {
    id: 'github',
    async openPullRequest(input: PullRequestInput): Promise<PullRequestRef> {
      // 1. push the run branch using a token-authenticated remote URL.
      const remote = `https://x-access-token:${cfg.token}@${gitHost}/${cfg.owner}/${cfg.repo}.git`;
      const push = await cfg.exec('git', ['push', remote, `${input.branch}:${input.branch}`]);
      if (push.exitCode !== 0) {
        throw new Error(`git push failed: ${truncate(redact(push.stderr || push.stdout))}`);
      }

      // 2. open the PR via the REST API.
      const res = await fetchImpl(`${apiBase}/repos/${cfg.owner}/${cfg.repo}/pulls`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${cfg.token}`,
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
          'user-agent': 'lumey-agent-runtime',
        },
        body: JSON.stringify({ title: input.title, head: input.branch, base: input.base, body: input.body }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`GitHub PR create failed (${res.status}): ${truncate(redact(text))}`);
      }
      const json = (await res.json()) as { number?: number; html_url?: string };
      if (typeof json.number !== 'number' || typeof json.html_url !== 'string') {
        throw new Error('GitHub PR create returned an unexpected payload');
      }
      return {
        externalId: `${cfg.owner}/${cfg.repo}#${json.number}`,
        url: json.html_url,
        number: json.number,
        branch: input.branch,
      };
    },
  };
}
