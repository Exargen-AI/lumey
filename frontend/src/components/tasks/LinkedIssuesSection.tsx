import { useEffect, useRef, useState } from 'react';
import { Plus, Link2, X, Search, AlertOctagon, GitMerge, Copy as CopyIcon, Loader2, GitFork, GitBranch } from 'lucide-react';
import { useTaskLinks, useCreateTaskLink, useDeleteTaskLink } from '@/hooks/useTaskLinks';
import { searchTasksForLinking, type LinkedTaskSummary, type TaskLinkType, type TaskLinkSearchResult, type TaskLinks } from '@/api/taskLinks';
import { Button, useConfirm } from '@/components/ui';
import { Can } from '@/components/auth/Can';
import { cn } from '@/lib/cn';

interface LinkedIssuesSectionProps {
  taskId: string;
  projectId: string;
  /** Used to compose deep links to the linked tasks. */
  taskHref: (otherTaskId: string) => string;
  /**
   * Optional handler — if the surrounding host is the slide-over, prefer
   * navigating within the slide-over (J/K-style) over loading a full page.
   */
  onLinkedTaskClick?: (otherTaskId: string) => void;
}

const GROUP_DEFS: Array<{
  key: keyof TaskLinks;
  label: string;
  icon: React.ReactNode;
  tone: 'rose' | 'amber' | 'gray' | 'brand';
}> = [
  { key: 'blocks',       label: 'Blocks',         icon: <AlertOctagon size={11} />, tone: 'rose'  },
  { key: 'blockedBy',    label: 'Blocked by',     icon: <AlertOctagon size={11} />, tone: 'amber' },
  { key: 'relatesTo',    label: 'Related to',     icon: <GitMerge   size={11} />,   tone: 'brand' },
  { key: 'duplicates',   label: 'Duplicates',     icon: <CopyIcon   size={11} />,   tone: 'gray'  },
  { key: 'duplicatedBy', label: 'Duplicated by',  icon: <CopyIcon   size={11} />,   tone: 'gray'  },
  // PR C — bug triage spin-offs. `spawned` (children) is more important
  // to surface than `spawnedFrom` (parent) because the parent bug is
  // usually the one whose detail page you're on; the children are the
  // shipped fixes you want to see.
  { key: 'spawned',      label: 'Spawned tasks',  icon: <GitFork    size={11} />,   tone: 'brand' },
  { key: 'spawnedFrom',  label: 'Spawned from',   icon: <GitBranch  size={11} />,   tone: 'brand' },
];

const TONE_CHIP: Record<'rose' | 'amber' | 'gray' | 'brand', string> = {
  rose:  'bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/25',
  amber: 'bg-amber-500/12 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/25',
  gray:  'bg-gray-500/10 text-gray-700 dark:text-obsidian-fg ring-1 ring-gray-500/15',
  brand: 'bg-brand-500/10 text-brand-700 dark:text-brand-300 ring-1 ring-brand-500/25',
};

const PRIO_DOT: Record<string, string> = {
  P0: 'bg-rose-500', P1: 'bg-orange-500', P2: 'bg-blue-500', P3: 'bg-gray-400',
};

const STATUS_DOT: Record<string, string> = {
  BACKLOG:     'bg-gray-400 dark:bg-obsidian-faded',
  TODO:        'bg-gray-500 dark:bg-obsidian-muted',
  IN_PROGRESS: 'bg-info-500',
  IN_REVIEW:   'bg-warning-500',
  DONE:        'bg-success-500',
};

/**
 * The "Linked Issues" section of the task detail view. Renders five buckets
 * (Blocks / Blocked by / Related to / Duplicates / Duplicated by) and an
 * inline picker for adding new links. Clicking a linked task either opens
 * the slide-over panel (when the host provides `onLinkedTaskClick`) or
 * navigates to the full task page.
 */
export function LinkedIssuesSection({
  taskId, projectId, taskHref, onLinkedTaskClick,
}: LinkedIssuesSectionProps) {
  const { data, isLoading } = useTaskLinks(taskId);
  const createLink = useCreateTaskLink(taskId);
  const deleteLink = useDeleteTaskLink();
  const confirm = useConfirm();

  const [picker, setPicker] = useState<{ type: TaskLinkType } | null>(null);

  async function handleRemove(link: LinkedTaskSummary, groupLabel: string) {
    const ok = await confirm({
      title: 'Remove this link?',
      body: `${groupLabel} #${link.taskNumber} — “${link.title}”. This only removes the link, not the task.`,
      confirmLabel: 'Remove link',
      tone: 'danger',
    });
    if (!ok) return;
    await deleteLink.mutateAsync(link.linkId);
  }

  async function handleCreate(targetTaskId: string, type: TaskLinkType) {
    // No try/catch — the picker reads error state from `createLink.error`,
    // and rethrowing inside a try/catch just to rethrow tripped the
    // `no-useless-catch` rule. If we need post-fail cleanup beyond
    // resetting the picker, add a finally block.
    await createLink.mutateAsync({ targetTaskId, type });
    setPicker(null);
  }

  const totalLinks = data
    ? data.blocks.length + data.blockedBy.length + data.relatesTo.length
      + data.duplicates.length + data.duplicatedBy.length
      + data.spawned.length + data.spawnedFrom.length
    : 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-[10px] font-semibold uppercase tracking-[0.08em] text-gray-500 dark:text-obsidian-muted flex items-center gap-1.5">
          <Link2 size={11} />
          Linked Issues
          {totalLinks > 0 && (
            <span className="text-gray-400 dark:text-obsidian-faded font-normal">· {totalLinks}</span>
          )}
        </label>
        <Can permissions={['task.edit_any', 'task.edit_own']}>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPicker({ type: 'BLOCKS' })}
              className={cn(
                'text-[11px] font-medium px-2 py-0.5 rounded-md flex items-center gap-1',
                'border border-gray-200 dark:border-obsidian-border',
                'text-gray-600 dark:text-obsidian-muted',
                'hover:border-brand-500/50 hover:text-brand-700 dark:hover:text-brand-300',
                'transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
              )}
              aria-label="Add a link"
            >
              <Plus size={11} /> Link
            </button>
          </div>
        </Can>
      </div>

      {/* Picker — inline so it shares the section's vertical rhythm */}
      {picker && (
        <LinkPicker
          projectId={projectId}
          excludeTaskId={taskId}
          initialType={picker.type}
          onCancel={() => setPicker(null)}
          onCreate={handleCreate}
          isPending={createLink.isPending}
        />
      )}

      {isLoading ? (
        <div className="space-y-1.5 mt-2">
          <div className="h-7 rounded-md bg-gray-100 dark:bg-obsidian-raised/40 animate-pulse" />
          <div className="h-7 rounded-md bg-gray-100 dark:bg-obsidian-raised/40 animate-pulse" />
        </div>
      ) : !data || totalLinks === 0 ? (
        !picker && (
          <p className="text-[12px] italic text-gray-400 dark:text-obsidian-faded mt-2">
            No linked issues yet.
          </p>
        )
      ) : (
        <div className="space-y-3 mt-2">
          {GROUP_DEFS.map((g) => {
            const list = (data[g.key] ?? []) as LinkedTaskSummary[];
            if (list.length === 0) return null;
            return (
              <div key={g.key}>
                <p className={cn('inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.08em] font-semibold mb-1.5 px-1.5 py-0.5 rounded', TONE_CHIP[g.tone])}>
                  {g.icon}
                  {g.label}
                </p>
                <ul className="space-y-1" role="list">
                  {list.map((link) => (
                    <LinkRow
                      key={link.linkId}
                      link={link}
                      taskHref={taskHref}
                      onClick={onLinkedTaskClick}
                      onRemove={() => handleRemove(link, g.label)}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LinkRow({
  link, taskHref, onClick, onRemove,
}: {
  link: LinkedTaskSummary;
  taskHref: (id: string) => string;
  onClick?: (id: string) => void;
  onRemove: () => void;
}) {
  return (
    <li className="group flex items-center gap-2 px-1.5 py-1 -mx-1.5 rounded-md hover:bg-gray-50 dark:hover:bg-obsidian-raised/40 transition-colors">
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', STATUS_DOT[link.status] ?? STATUS_DOT.TODO)} aria-label={`Status ${link.status}`} />
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', PRIO_DOT[link.priority] ?? PRIO_DOT.P2)} aria-label={`Priority ${link.priority}`} />
      <code className="text-[10px] font-mono tabular-nums text-gray-400 dark:text-obsidian-faded shrink-0">
        #{link.taskNumber}
      </code>
      {onClick ? (
        <button
          type="button"
          onClick={() => onClick(link.taskId)}
          className="flex-1 min-w-0 text-left text-[12.5px] text-gray-800 dark:text-obsidian-fg truncate hover:text-brand-700 dark:hover:text-brand-300"
        >
          {link.title}
        </button>
      ) : (
        <a
          href={taskHref(link.taskId)}
          className="flex-1 min-w-0 text-[12.5px] text-gray-800 dark:text-obsidian-fg truncate hover:text-brand-700 dark:hover:text-brand-300"
        >
          {link.title}
        </a>
      )}
      {link.isBlocked && (
        <span className="shrink-0 inline-flex items-center text-[9px] font-medium px-1 py-0.5 rounded bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/20">
          blocked
        </span>
      )}
      <Can permissions={['task.edit_any', 'task.edit_own']}>
        <button
          type="button"
          onClick={onRemove}
          className="p-1 rounded text-gray-400 dark:text-obsidian-faded hover:bg-rose-500/15 hover:text-rose-600 dark:hover:text-rose-400 opacity-0 group-hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40 transition-opacity shrink-0"
          aria-label="Remove link"
          title="Remove link"
        >
          <X size={11} />
        </button>
      </Can>
    </li>
  );
}

interface LinkPickerProps {
  projectId: string;
  excludeTaskId: string;
  initialType: TaskLinkType;
  onCancel: () => void;
  onCreate: (targetTaskId: string, type: TaskLinkType) => Promise<void>;
  isPending: boolean;
}

function LinkPicker({
  projectId, excludeTaskId, initialType, onCancel, onCreate, isPending,
}: LinkPickerProps) {
  const [type, setType] = useState<TaskLinkType>(initialType);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TaskLinkSearchResult[]>([]);
  const [highlighted, setHighlighted] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Debounced search
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await searchTasksForLinking(projectId, query, excludeTaskId);
        if (!cancelled) {
          setResults(r);
          setHighlighted(0);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [projectId, excludeTaskId, query]);

  async function handlePick(target: TaskLinkSearchResult) {
    setError(null);
    try {
      await onCreate(target.id, type);
    } catch (err: any) {
      setError(err?.response?.data?.error?.message ?? 'Failed to create link.');
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); return; }
    if (e.key === 'Enter')   { e.preventDefault(); if (results[highlighted]) handlePick(results[highlighted]); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted((i) => Math.min(i + 1, results.length - 1)); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlighted((i) => Math.max(i - 1, 0)); return; }
  }

  return (
    <div className="rounded-lg border border-brand-500/30 bg-brand-500/[0.04] dark:bg-brand-500/[0.06] p-3 mt-2 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase tracking-[0.08em] font-semibold text-brand-700 dark:text-brand-300">
          New link
        </span>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as TaskLinkType)}
          className="text-[12px] px-2 py-1 rounded bg-white dark:bg-obsidian-bg border border-gray-200 dark:border-obsidian-border text-gray-800 dark:text-obsidian-fg focus:outline-none focus:ring-2 focus:ring-brand-500/40"
        >
          <option value="BLOCKS">Blocks</option>
          <option value="RELATES_TO">Relates to</option>
          <option value="DUPLICATES">Duplicates</option>
        </select>
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto p-1 rounded text-gray-400 dark:text-obsidian-faded hover:bg-gray-200 dark:hover:bg-obsidian-border hover:text-gray-700 dark:hover:text-obsidian-fg"
          aria-label="Cancel adding link"
        >
          <X size={12} />
        </button>
      </div>

      <div className="relative">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 dark:text-obsidian-faded pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search by task # or title…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          className="w-full bg-white dark:bg-obsidian-bg border border-gray-200 dark:border-obsidian-border rounded pl-7 pr-2 py-1.5 text-[12.5px] text-gray-800 dark:text-obsidian-fg placeholder:text-gray-400 dark:placeholder:text-obsidian-faded focus:outline-none focus:ring-2 focus:ring-brand-500/40"
          aria-label="Search tasks to link"
        />
        {searching && (
          <Loader2 size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
        )}
      </div>

      {results.length > 0 && (
        <ul role="listbox" className="rounded-md border border-gray-200 dark:border-obsidian-border bg-white dark:bg-obsidian-bg max-h-56 overflow-y-auto">
          {results.map((r, idx) => {
            const active = idx === highlighted;
            return (
              <li
                key={r.id}
                role="option"
                aria-selected={active}
                onMouseEnter={() => setHighlighted(idx)}
                onClick={() => handlePick(r)}
                className={cn(
                  'flex items-center gap-2 px-2 py-1.5 cursor-pointer text-[12px]',
                  active && 'bg-brand-500/10',
                )}
              >
                <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', PRIO_DOT[r.priority] ?? PRIO_DOT.P2)} />
                <code className="font-mono tabular-nums text-gray-400 dark:text-obsidian-faded shrink-0">#{r.taskNumber}</code>
                <span className="flex-1 truncate text-gray-800 dark:text-obsidian-fg">{r.title}</span>
                <span className="text-[10px] text-gray-400 dark:text-obsidian-faded shrink-0">{r.status}</span>
              </li>
            );
          })}
        </ul>
      )}

      {!searching && results.length === 0 && query.trim().length > 0 && (
        <p className="text-[11px] text-gray-500 dark:text-obsidian-muted italic px-1">No matches in this project.</p>
      )}

      {error && (
        <p role="alert" className="text-[11px] text-rose-600 dark:text-rose-400 px-1">{error}</p>
      )}

      {isPending && (
        <p className="text-[11px] text-gray-500 dark:text-obsidian-muted italic px-1">Creating link…</p>
      )}
    </div>
  );
}
