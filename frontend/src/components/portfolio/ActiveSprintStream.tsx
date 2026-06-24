import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertOctagon, ChevronRight, Filter, X } from 'lucide-react';
import type { ActiveStreamTask } from '@/api/analytics';
import { CATEGORY_COLORS } from '@/lib/constants';
import { cn } from '@/lib/cn';

interface ActiveSprintStreamProps {
  tasks: ActiveStreamTask[];
  isLoading?: boolean;
}

const STATUS_GROUPS: Array<{
  key: ActiveStreamTask['status'];
  label: string;
  /** color of the group dot + accent. Muted so it doesn't yell. */
  dot: string;
}> = [
  { key: 'IN_PROGRESS', label: 'In Progress', dot: 'bg-info-500' },
  { key: 'IN_REVIEW',   label: 'In Review',   dot: 'bg-warning-500' },
  { key: 'TODO',        label: 'Up Next',     dot: 'bg-gray-400 dark:bg-obsidian-faded' },
];

const PRIO_DOT: Record<ActiveStreamTask['priority'], string> = {
  P0: 'bg-rose-500',
  P1: 'bg-orange-500',
  P2: 'bg-blue-500',
  P3: 'bg-gray-400',
};
const PRIO_LABEL: Record<ActiveStreamTask['priority'], string> = {
  P0: 'Critical', P1: 'High', P2: 'Medium', P3: 'Low',
};

/**
 * Band 2 — every active-sprint task across every product, grouped by status.
 *
 * The "what's happening right now everywhere" view. Filter chips keep it
 * focused; default shows everything. Clicking a row goes to the project
 * (later: deep-link to the issue in the slide-over).
 */
export function ActiveSprintStream({ tasks, isLoading }: ActiveSprintStreamProps) {
  const [productFilter, setProductFilter] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<ActiveStreamTask['priority'] | null>(null);
  const [showBlockedOnly, setShowBlockedOnly] = useState(false);

  // Derive unique products + priorities for filter chips, by traffic.
  const products = useMemo(() => {
    const m = new Map<string, { id: string; name: string; category: string; count: number }>();
    for (const t of tasks) {
      const cur = m.get(t.project.id);
      if (cur) cur.count += 1;
      else m.set(t.project.id, { id: t.project.id, name: t.project.name, category: t.project.category, count: 1 });
    }
    return Array.from(m.values()).sort((a, b) => b.count - a.count);
  }, [tasks]);

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (productFilter && t.project.id !== productFilter) return false;
      if (priorityFilter && t.priority !== priorityFilter) return false;
      if (showBlockedOnly && !t.isBlocked) return false;
      return true;
    });
  }, [tasks, productFilter, priorityFilter, showBlockedOnly]);

  const grouped = useMemo(() => {
    const m = new Map<ActiveStreamTask['status'], ActiveStreamTask[]>();
    for (const g of STATUS_GROUPS) m.set(g.key, []);
    for (const t of filtered) m.get(t.status)?.push(t);
    return m;
  }, [filtered]);

  if (isLoading) {
    return (
      <div className="rounded-xl bg-white border border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border p-4">
        <div className="space-y-2 animate-pulse">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-9 rounded-md bg-gray-100 dark:bg-obsidian-raised/60" />
          ))}
        </div>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 dark:border-obsidian-border p-8 text-center">
        <p className="text-sm text-gray-500 dark:text-obsidian-muted">
          No tasks in any active sprint. Start a sprint on a product to see live work here.
        </p>
      </div>
    );
  }

  const hasFilter = productFilter || priorityFilter || showBlockedOnly;

  return (
    <div className="rounded-xl bg-white border border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border overflow-hidden">
      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-gray-100 dark:border-obsidian-border/60 bg-gray-50/60 dark:bg-obsidian-sunken/40">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-faded">
          <Filter size={10} />
          Filter
        </div>

        {/* Product chips (top 6) */}
        <div className="flex flex-wrap gap-1.5">
          {products.slice(0, 6).map((p) => {
            const active = productFilter === p.id;
            const accent = (CATEGORY_COLORS as Record<string, string>)[p.category] ?? '#6366f1';
            return (
              <button
                key={p.id}
                onClick={() => setProductFilter(active ? null : p.id)}
                className={cn(
                  'group inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors',
                  active
                    ? 'border-brand-500/60 bg-brand-500/10 text-brand-700 dark:text-brand-200'
                    : 'border-gray-200 dark:border-obsidian-border text-gray-600 dark:text-obsidian-muted hover:border-gray-300 dark:hover:border-obsidian-border-strong',
                )}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: accent }} />
                {p.name}
                <span className="text-[10px] opacity-60 tabular-nums">{p.count}</span>
              </button>
            );
          })}
        </div>

        {/* Priority chips */}
        <div className="flex gap-1 ml-auto">
          {(['P0', 'P1'] as const).map((p) => {
            const active = priorityFilter === p;
            return (
              <button
                key={p}
                onClick={() => setPriorityFilter(active ? null : p)}
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors',
                  active
                    ? 'border-brand-500/60 bg-brand-500/10 text-brand-700 dark:text-brand-200'
                    : 'border-gray-200 dark:border-obsidian-border text-gray-600 dark:text-obsidian-muted hover:border-gray-300 dark:hover:border-obsidian-border-strong',
                )}
              >
                <span className={cn('w-1.5 h-1.5 rounded-full', PRIO_DOT[p])} />
                {p}
              </button>
            );
          })}
          <button
            onClick={() => setShowBlockedOnly((v) => !v)}
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors',
              showBlockedOnly
                ? 'border-rose-500/60 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                : 'border-gray-200 dark:border-obsidian-border text-gray-600 dark:text-obsidian-muted hover:border-gray-300 dark:hover:border-obsidian-border-strong',
            )}
          >
            <AlertOctagon size={10} strokeWidth={2.25} /> Blocked
          </button>
          {hasFilter && (
            <button
              onClick={() => { setProductFilter(null); setPriorityFilter(null); setShowBlockedOnly(false); }}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium text-gray-500 dark:text-obsidian-faded hover:text-gray-700 dark:hover:text-obsidian-fg"
            >
              <X size={10} /> Clear
            </button>
          )}
        </div>
      </div>

      {/* Status groups */}
      <div>
        {STATUS_GROUPS.map((g) => {
          const list = grouped.get(g.key) ?? [];
          if (list.length === 0) return null;
          return (
            <div key={g.key} className="border-b border-gray-100 dark:border-obsidian-border/60 last:border-b-0">
              <div className="flex items-center gap-2 px-4 py-2 bg-gray-50/40 dark:bg-obsidian-sunken/30">
                <span className={cn('w-1.5 h-1.5 rounded-full', g.dot)} aria-hidden="true" />
                <span className="text-[10px] uppercase tracking-[0.1em] font-semibold text-gray-500 dark:text-obsidian-muted">
                  {g.label}
                </span>
                <span className="text-[10px] tabular-nums text-gray-400 dark:text-obsidian-faded">{list.length}</span>
              </div>
              <ul>
                {list.map((t) => (
                  <StreamRow key={t.id} task={t} />
                ))}
              </ul>
            </div>
          );
        })}

        {filtered.length === 0 && hasFilter && (
          <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-obsidian-muted">
            No tasks match the current filter.
          </div>
        )}
      </div>
    </div>
  );
}

function StreamRow({ task }: { task: ActiveStreamTask }) {
  const accent = (CATEGORY_COLORS as Record<string, string>)[task.project.category] ?? '#6366f1';
  return (
    <li>
      <Link
        to={`/projects/${task.project.id}`}
        className="group grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-2 hover:bg-gray-50 dark:hover:bg-obsidian-raised/60 transition-colors"
      >
        {/* Project ID badge */}
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="inline-block w-1 h-3.5 rounded-sm"
            style={{ background: accent }}
            aria-hidden="true"
          />
          <code className="text-[10px] font-mono tabular-nums text-gray-500 dark:text-obsidian-faded">
            {task.project.slug.toUpperCase().slice(0, 4)}-{task.taskNumber}
          </code>
        </div>

        {/* Title + flags */}
        <div className="min-w-0 flex items-center gap-2">
          <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', PRIO_DOT[task.priority])} aria-label={PRIO_LABEL[task.priority]} />
          <span className="truncate text-[13px] text-gray-800 dark:text-obsidian-fg group-hover:text-brand-700 dark:group-hover:text-brand-200">
            {task.title}
          </span>
          {task.isBlocked && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1 py-0.5 rounded bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/20 shrink-0">
              <AlertOctagon size={9} strokeWidth={2.5} /> blocked
            </span>
          )}
        </div>

        {/* Right meta */}
        <div className="flex items-center gap-3 shrink-0">
          {task.storyPoints != null && (
            <span className="text-[10px] font-mono tabular-nums text-gray-400 dark:text-obsidian-faded">
              {task.storyPoints}pt
            </span>
          )}
          {task.assignee ? (
            <div
              className="w-6 h-6 rounded-full bg-brand-500/15 ring-1 ring-brand-500/25 flex items-center justify-center text-[9px] font-semibold text-brand-700 dark:text-brand-300"
              title={task.assignee.name}
              aria-label={task.assignee.name}
            >
              {task.assignee.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
            </div>
          ) : (
            <span className="text-[10px] italic text-rose-500/80 dark:text-rose-400/80">unassigned</span>
          )}
          <ChevronRight size={13} className="text-gray-300 dark:text-obsidian-faded opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </Link>
    </li>
  );
}
