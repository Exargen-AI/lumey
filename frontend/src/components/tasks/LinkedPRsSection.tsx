import { ExternalLink, GitMerge, GitPullRequest, GitPullRequestClosed } from 'lucide-react';
import { useTaskExternalLinks } from '@/hooks/useGitHubIntegration';
import { formatRelative } from '@/lib/formatters';
import { cn } from '@/lib/cn';

interface Props {
  taskId: string;
}

/**
 * Reads-only render of every external system linked to this task. Today only
 * GitHub PRs; the table model is extensible (Slack threads, Linear issues)
 * and this component will gain switch arms as we add kinds.
 *
 * Refresh strategy: react-query refetches on window focus, so a freshly-
 * merged PR pops in within a few seconds when the user tabs back from
 * GitHub. No optimistic mutation here — links are written exclusively by
 * the webhook handler.
 */
export function LinkedPRsSection({ taskId }: Props) {
  const { data: links, isLoading } = useTaskExternalLinks(taskId);

  if (isLoading) {
    return (
      <div className="space-y-1.5">
        <div className="h-3 w-24 bg-gray-200 dark:bg-obsidian-raised rounded animate-pulse" />
        <div className="h-9 bg-gray-100 dark:bg-obsidian-raised rounded animate-pulse" />
      </div>
    );
  }

  // Don't render the section header at all if there's nothing to show — the
  // task page already has a busy column. Connect-CTA lives in project
  // settings, not on every task page.
  if (!links || links.length === 0) {
    return null;
  }

  return (
    <div>
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted mb-2 flex items-center gap-1.5">
        <GitPullRequest size={11} />
        Linked PRs
      </h3>
      <div className="space-y-1.5">
        {links.map((link) => (
          <a
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'group flex items-center gap-2 px-2.5 py-2 rounded-md',
              'border border-gray-200 dark:border-obsidian-border',
              'bg-white dark:bg-obsidian-bg',
              'hover:border-brand-400/40 hover:bg-brand-50/40 dark:hover:bg-brand-500/5',
              'transition-colors',
            )}
          >
            <StatePill state={link.state} />
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-medium text-gray-900 dark:text-obsidian-fg truncate">
                {link.title || link.externalId}
              </div>
              <div className="text-[11px] text-gray-500 dark:text-obsidian-muted flex items-center gap-1.5">
                <span>{link.externalId}</span>
                {link.authorName && (
                  <>
                    <span>·</span>
                    <span>by {link.authorName}</span>
                  </>
                )}
                {link.mergedAt ? (
                  <>
                    <span>·</span>
                    <span>merged {formatRelative(link.mergedAt)}</span>
                  </>
                ) : link.openedAt ? (
                  <>
                    <span>·</span>
                    <span>opened {formatRelative(link.openedAt)}</span>
                  </>
                ) : null}
              </div>
            </div>
            <ExternalLink
              size={12}
              className="text-gray-400 dark:text-obsidian-faded group-hover:text-brand-500 shrink-0"
            />
          </a>
        ))}
      </div>
    </div>
  );
}

function StatePill({ state }: { state: 'OPEN' | 'MERGED' | 'CLOSED' }) {
  if (state === 'MERGED') {
    return (
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-purple-100 dark:bg-purple-500/15 text-purple-600 dark:text-purple-300 shrink-0" title="Merged">
        <GitMerge size={12} />
      </span>
    );
  }
  if (state === 'CLOSED') {
    return (
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-rose-100 dark:bg-rose-500/15 text-rose-600 dark:text-rose-300 shrink-0" title="Closed without merge">
        <GitPullRequestClosed size={12} />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 shrink-0" title="Open">
      <GitPullRequest size={12} />
    </span>
  );
}
