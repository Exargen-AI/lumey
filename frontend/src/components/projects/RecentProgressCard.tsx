import { CheckCircle2, Package, Bug, Wrench, Search, Sparkles } from 'lucide-react';
import { useRecentProgress } from '@/hooks/useRecentProgress';
import type { RecentProgressItem } from '@/api/recentProgress';
import { formatRelative } from '@/lib/formatters';
import { cn } from '@/lib/cn';

/**
 * "Shipped this week" highlight reel — top 3 client-visible tasks
 * completed in the last 7 days, ranked by storyPoints → priority →
 * recency. Self-hides when nothing shipped (no negative-signal empty
 * state — we don't want to broadcast "team didn't ship anything").
 *
 * Sits between the project hero and the two-column section on the
 * client project status page.
 */
interface Props {
  projectId: string;
}

export function RecentProgressCard({ projectId }: Props) {
  const { data, isLoading, error } = useRecentProgress(projectId, { days: 7, limit: 3 });

  if (isLoading || error || !data || data.items.length === 0) return null;

  const hasMore = data.totalThisWindow > data.items.length;

  return (
    <section
      className={cn(
        'rounded-2xl border p-5',
        'bg-white border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
        'shadow-soft dark:shadow-soft-dark',
        'animate-fade-in-up',
      )}
    >
      <header className="flex items-baseline justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-emerald-500 dark:text-emerald-400 shrink-0" />
          <h2 className="text-[13px] font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">
            Shipped this week
          </h2>
        </div>
        <span className="text-[11px] text-gray-400 dark:text-obsidian-faded shrink-0">
          {data.totalThisWindow === 1 ? '1 task completed' : `${data.totalThisWindow} tasks completed`} · last {data.windowDays}d
        </span>
      </header>

      <ul className="space-y-1.5">
        {data.items.map((item) => (
          <ProgressRow key={item.taskId} item={item} />
        ))}
      </ul>

      {hasMore && (
        <p className="mt-3 text-[11px] text-gray-400 dark:text-obsidian-faded">
          +{data.totalThisWindow - data.items.length} more completed — see Task Progress below.
        </p>
      )}
    </section>
  );
}

function ProgressRow({ item }: { item: RecentProgressItem }) {
  return (
    <li className="flex items-center gap-2.5 rounded-lg px-3 py-2 hover:bg-gray-50 dark:hover:bg-obsidian-raised/40 transition-colors group">
      <CheckCircle2 size={14} className="shrink-0 text-emerald-500 dark:text-emerald-400" />
      <TaskTypeIcon
        kind={item.taskType}
        className="shrink-0 text-gray-400 dark:text-obsidian-muted"
      />
      <span className="flex-1 min-w-0 truncate text-[13px] text-gray-900 dark:text-obsidian-fg font-medium">
        {item.title}
      </span>
      {typeof item.storyPoints === 'number' && (
        <span
          className="shrink-0 inline-flex items-center justify-center min-w-[24px] h-5 px-1.5 text-[10px] font-semibold rounded bg-gray-100 dark:bg-obsidian-raised text-gray-600 dark:text-obsidian-muted tabular-nums"
          title={`${item.storyPoints} story points`}
        >
          {item.storyPoints}
        </span>
      )}
      <span className="shrink-0 text-[11px] text-gray-400 dark:text-obsidian-faded">
        {formatRelative(item.completedAt)}
      </span>
    </li>
  );
}

function TaskTypeIcon({ kind, className }: { kind: RecentProgressItem['taskType']; className?: string }) {
  // Tiny visual cue for the task type. Skipped for FEATURE (the common
  // case) so it doesn't add noise on most rows; the icon is reserved for
  // chores, bugs, spikes which signal something different.
  if (kind === 'BUG') return <Bug size={12} className={className} />;
  if (kind === 'CHORE') return <Wrench size={12} className={className} />;
  if (kind === 'SPIKE') return <Search size={12} className={className} />;
  return <Package size={12} className={className} />;
}
