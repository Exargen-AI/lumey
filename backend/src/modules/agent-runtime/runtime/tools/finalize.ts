/**
 * Finalize tools — the run-completing actions: verify the work (`run_tests`) and
 * prepare it for review (`git_commit` onto a per-run branch). They're separate
 * from the always-on coding tools (`builtins.ts`) because they're *run-scoped*:
 * the commit lands on a branch named for the run, and the test command comes
 * from deployment config. The native adapter binds them per run.
 *
 * Like every tool, failures are data: a failing test suite, an empty commit, or
 * a non-git workspace returns an `ok:false` result the agent reads — not a crash.
 */
import { z } from 'zod';
import {
  type CommandGuardrailPolicy,
  DEFAULT_ALLOWED_BINARIES,
  checkCommand,
} from './guardrails';
import type { GitProvider, PullRequestInput, PullRequestRef } from '../git/gitProvider';
import type { ToolContext, ToolDefinition, ToolOutput } from './types';

export interface RunTestsOptions {
  /** Default test command when the model doesn't override it. */
  readonly command?: string;
  /** Kill the suite after this many ms. Default 300_000. */
  readonly timeoutMs?: number;
  /** Guardrail policy for the (model-overridable) command. */
  readonly policy?: CommandGuardrailPolicy;
}

/** Run the project test suite (or a given command) and report pass/fail. */
export function createRunTestsTool(opts: RunTestsOptions = {}): ToolDefinition<{ command?: string }> {
  const fallback = opts.command || 'npm test';
  const policy = opts.policy ?? { allowedBinaries: DEFAULT_ALLOWED_BINARIES };
  return {
    name: 'run_tests',
    description: 'Run the project test suite (or a given command) and report pass/fail with output.',
    mutates: false,
    schema: z.object({ command: z.string().describe('Override the test command.').optional() }),
    async handler({ command }, { sandbox, signal }: ToolContext): Promise<ToolOutput> {
      const cmd = command || fallback;
      const decision = checkCommand(cmd, policy);
      if (!decision.allowed) throw new Error(decision.reason ?? 'test command blocked by guardrail');
      const res = await sandbox.exec('bash', ['-c', cmd], { timeoutMs: opts.timeoutMs ?? 300_000, signal });
      const ok = res.exitCode === 0 && !res.timedOut;
      const head = ok ? 'PASS' : res.timedOut ? 'TIMEOUT' : `FAIL (exit ${res.exitCode})`;
      return {
        content: [head, res.stdout, res.stderr].filter(Boolean).join('\n').trim(),
        data: { ok, exitCode: res.exitCode, timedOut: res.timedOut },
      };
    },
  };
}

export interface GitCommitOptions {
  /** The per-run branch to commit onto (created/moved if needed). */
  readonly branch: string;
}

/** Stage all changes and commit them onto the run branch. */
export function createGitCommitTool(opts: GitCommitOptions): ToolDefinition<{ message: string }> {
  return {
    name: 'git_commit',
    description: 'Stage all changes and commit them on the run branch. Use when the work is complete and verified.',
    mutates: true,
    schema: z.object({ message: z.string().describe('Commit message.') }),
    async handler({ message }, { sandbox, signal }: ToolContext): Promise<ToolOutput> {
      const checkout = await sandbox.exec('git', ['checkout', '-B', opts.branch], { signal });
      if (checkout.exitCode !== 0) {
        return { content: `not a git workspace or branch error:\n${checkout.stderr.trim()}`, data: { ok: false } };
      }
      await sandbox.exec('git', ['add', '-A'], { signal });
      const commit = await sandbox.exec('git', ['commit', '-m', message], { signal });
      if (commit.exitCode !== 0) {
        return { content: `commit failed:\n${[commit.stdout, commit.stderr].filter(Boolean).join('\n').trim()}`, data: { ok: false } };
      }
      const head = await sandbox.exec('git', ['rev-parse', 'HEAD'], { signal });
      const sha = head.stdout.trim();
      return { content: `Committed on ${opts.branch} (${sha.slice(0, 9)})`, data: { ok: true, branch: opts.branch, sha } };
    },
  };
}

export interface OpenPrOptions {
  /** The host that actually opens the PR (reference simulator / GitHub / …). */
  readonly provider: GitProvider;
  /** The run branch to open the PR from. */
  readonly branch: string;
  /** The branch to merge into. Default `main`. */
  readonly base?: string;
  /** Server-side hook to link the opened PR to its task (DB write). */
  readonly onOpened?: (ref: PullRequestRef, input: PullRequestInput) => Promise<void>;
}

/** Open a pull request for the run branch and request human review. */
export function createOpenPrTool(opts: OpenPrOptions): ToolDefinition<{ title: string; body?: string }> {
  const base = opts.base || 'main';
  return {
    name: 'open_pr',
    description: 'Open a pull request for the run branch and request human review. Use once the work is committed and tests pass.',
    mutates: true,
    schema: z.object({
      title: z.string().describe('Pull request title.'),
      body: z.string().describe('Pull request description.').optional(),
    }),
    async handler({ title, body }): Promise<ToolOutput> {
      const input: PullRequestInput = { branch: opts.branch, base, title, body: body ?? '' };
      const ref = await opts.provider.openPullRequest(input);
      if (opts.onOpened) await opts.onOpened(ref, input);
      return { content: `Opened PR ${ref.externalId} (${ref.url}) for ${ref.branch} → ${base}`, data: ref };
    },
  };
}
