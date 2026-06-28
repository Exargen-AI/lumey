import {
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  GitMerge,
  CheckCircle2,
  XCircle,
  LoaderCircle,
  Clock,
  CircleDot,
  MinusCircle,
  ExternalLink,
  ChevronRight,
} from 'lucide-react';
import { useRunSdlc } from '@/hooks/useAgentRuns';
import type { RunCheck, RunPullRequest } from '@/api/agentRuns';
import { cn } from '@/lib/cn';

/**
 * The run's delivery pipeline — commits → pull request → CI checks — as a single
 * horizontal flow on the run card. Turns "a PR was opened" into a living view of
 * the agent's work from edit to merge: the PR state and each check update live
 * (the SSE invalidation refetches this), so a human watches CI go green before
 * they merge. Renders nothing until the run has produced delivery activity.
 */
export function SdlcPipeline({ taskId, runId, enabled }: { taskId: string; runId: string; enabled: boolean }) {
  const { data } = useRunSdlc(taskId, runId, { enabled });
  if (!data || (data.commits.length === 0 && !data.pullRequest)) return null;

  const { commits, pullRequest, checks } = data;

  return (
    <div className="mt-2 rounded-md border border-gray-200 dark:border-obsidian-border bg-gray-50/60 dark:bg-white/[0.02] p-2.5">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-obsidian-muted">
        <GitBranch size={11} />
        Delivery pipeline
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-2">
        {/* Commits */}
        {commits.length > 0 && (
          <Stage>
            <GitCommitHorizontal size={13} className="text-gray-500 dark:text-obsidian-muted" />
            <span className="font-medium">{commits.length} commit{commits.length === 1 ? '' : 's'}</span>
            {commits[commits.length - 1] && (
              <span className="font-mono text-[10px] text-gray-400 dark:text-obsidian-muted">
                {commits[commits.length - 1].sha.slice(0, 7)}
              </span>
            )}
          </Stage>
        )}

        {/* Pull request */}
        {pullRequest && (
          <>
            {commits.length > 0 && <Connector />}
            <PrStage pr={pullRequest} />
          </>
        )}

        {/* Checks */}
        {pullRequest && checks.length > 0 && (
          <>
            <Connector />
            <div className="flex flex-wrap items-center gap-1.5">
              {checks.map((c) => (
                <CheckPill key={c.id} check={c} />
              ))}
            </div>
          </>
        )}
      </div>

      {pullRequest && checks.length > 0 && <ChecksSummary checks={checks} />}
    </div>
  );
}

function Stage({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-raised px-2 py-1 text-[11px] text-gray-700 dark:text-obsidian-fg">
      {children}
    </span>
  );
}

function Connector() {
  return <ChevronRight size={13} className="shrink-0 text-gray-300 dark:text-obsidian-muted" />;
}

const PR_STYLE: Record<RunPullRequest['state'], { label: string; dot: string; text: string; Icon: typeof GitPullRequest }> = {
  OPEN: { label: 'open', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', Icon: GitPullRequest },
  MERGED: { label: 'merged', dot: 'bg-violet-500', text: 'text-violet-600 dark:text-violet-400', Icon: GitMerge },
  CLOSED: { label: 'closed', dot: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400', Icon: GitPullRequest },
};

function PrStage({ pr }: { pr: RunPullRequest }) {
  const s = PR_STYLE[pr.state];
  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noopener noreferrer"
      title={pr.title}
      className="group inline-flex max-w-[260px] items-center gap-1.5 rounded-md border border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-raised px-2 py-1 text-[11px] text-gray-700 dark:text-obsidian-fg hover:border-gray-300 dark:hover:border-white/20"
    >
      <s.Icon size={13} className={s.text} />
      <span className="font-medium">{pr.number ? `PR #${pr.number}` : 'PR'}</span>
      <span className={cn('inline-flex items-center gap-1 text-[10px] font-medium', s.text)}>
        <span className={cn('h-1.5 w-1.5 rounded-full', s.dot)} />
        {s.label}
      </span>
      <span className="truncate text-gray-400 dark:text-obsidian-muted">· {pr.title}</span>
      <ExternalLink size={10} className="shrink-0 text-gray-300 opacity-0 transition group-hover:opacity-100 dark:text-obsidian-muted" />
    </a>
  );
}

/** Pick the icon + colour for a single check from its status/conclusion. */
function checkVisual(check: RunCheck): { Icon: typeof CheckCircle2; cls: string; spin?: boolean } {
  if (check.status !== 'COMPLETED') {
    if (check.status === 'IN_PROGRESS') return { Icon: LoaderCircle, cls: 'text-amber-500', spin: true };
    return { Icon: Clock, cls: 'text-gray-400 dark:text-obsidian-muted' };
  }
  switch (check.conclusion) {
    case 'SUCCESS':
      return { Icon: CheckCircle2, cls: 'text-emerald-500' };
    case 'FAILURE':
    case 'TIMED_OUT':
    case 'ACTION_REQUIRED':
      return { Icon: XCircle, cls: 'text-rose-500' };
    case 'CANCELLED':
    case 'SKIPPED':
    case 'STALE':
      return { Icon: MinusCircle, cls: 'text-gray-400 dark:text-obsidian-muted' };
    default:
      return { Icon: CircleDot, cls: 'text-gray-400 dark:text-obsidian-muted' };
  }
}

function CheckPill({ check }: { check: RunCheck }) {
  const { Icon, cls, spin } = checkVisual(check);
  const inner = (
    <span className="inline-flex items-center gap-1 rounded-md border border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-raised px-1.5 py-1 text-[11px] text-gray-700 dark:text-obsidian-fg">
      <Icon size={12} className={cn(cls, spin && 'animate-spin')} />
      {check.name}
    </span>
  );
  return check.url ? (
    <a href={check.url} target="_blank" rel="noopener noreferrer" title={check.name} className="hover:opacity-80">
      {inner}
    </a>
  ) : (
    inner
  );
}

function ChecksSummary({ checks }: { checks: RunCheck[] }) {
  const passed = checks.filter((c) => c.status === 'COMPLETED' && c.conclusion === 'SUCCESS').length;
  const failed = checks.filter((c) => c.status === 'COMPLETED' && (c.conclusion === 'FAILURE' || c.conclusion === 'TIMED_OUT' || c.conclusion === 'ACTION_REQUIRED')).length;
  const running = checks.filter((c) => c.status !== 'COMPLETED').length;
  const parts = [
    passed > 0 && `${passed} passed`,
    failed > 0 && `${failed} failed`,
    running > 0 && `${running} running`,
  ].filter(Boolean) as string[];
  if (parts.length === 0) return null;
  return (
    <p className="mt-1.5 text-[10px] text-gray-400 dark:text-obsidian-muted">
      {parts.join(' · ')}
    </p>
  );
}
