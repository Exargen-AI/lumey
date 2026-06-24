import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { X, Pencil, ExternalLink, AlertOctagon, ChevronRight, Layers } from 'lucide-react';
import { useEpicDetail } from '@/hooks/useSprints';
import type { EpicDetail, EpicSummary } from '@/api/sprints';
import { Badge, Button } from '@/components/ui';
import { Can } from '@/components/auth/Can';
import { MarkdownView } from '@/components/editor/MarkdownView';
import { pluralize, pluralWord } from '@/lib/plural';
import { formatDate } from '@/lib/formatters';
import { cn } from '@/lib/cn';

interface EpicDetailPanelProps {
  epicId: string | null;
  onClose: () => void;
  /**
   * Called when the user clicks Edit in the panel header. Parent decides
   * whether to swap to an EpicFormModal or navigate.
   */
  onEdit?: (epic: EpicSummary) => void;
}

const STATUS_LABELS: Record<EpicDetail['status'], string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  DONE: 'Done',
};
const STATUS_TONE: Record<EpicDetail['status'], 'neutral' | 'info' | 'success'> = {
  OPEN: 'neutral',
  IN_PROGRESS: 'info',
  DONE: 'success',
};

const TASK_STATUS_LABELS: Record<string, string> = {
  BACKLOG: 'Backlog',
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  IN_REVIEW: 'In Review',
  DONE: 'Done',
};
const TASK_STATUS_DOT: Record<string, string> = {
  BACKLOG:     'bg-gray-400 dark:bg-obsidian-faded',
  TODO:        'bg-gray-500 dark:bg-obsidian-muted',
  IN_PROGRESS: 'bg-info-500',
  IN_REVIEW:   'bg-warning-500',
  DONE:        'bg-success-500',
};
const PRIO_DOT: Record<string, string> = {
  P0: 'bg-rose-500',
  P1: 'bg-orange-500',
  P2: 'bg-blue-500',
  P3: 'bg-gray-400',
};

/**
 * Slide-over panel showing the full epic — its rollup metrics and the list
 * of all tasks currently assigned to it. Same interaction model as the task
 * slide-over: Esc to close, click outside to close, click a task to navigate
 * to its detail.
 */
export function EpicDetailPanel({ epicId, onClose, onEdit }: EpicDetailPanelProps) {
  const open = !!epicId;
  const { data: epic, isLoading } = useEpicDetail(epicId);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [open, onClose]);

  // Close on click outside the panel (but not inside child dialogs).
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (!panelRef.current) return;
      const target = e.target as Element | null;
      if (panelRef.current.contains(target as Node)) return;
      if (target?.closest('[role="dialog"]')) return;
      onClose();
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open, onClose]);

  if (!open) return null;

  // Group tasks by status for the panel's task list — keeps related work
  // visually adjacent.
  const tasksByStatus = epic
    ? ['IN_PROGRESS', 'IN_REVIEW', 'TODO', 'BACKLOG', 'DONE'].reduce<Record<string, EpicDetail['tasks']>>(
        (acc, s) => {
          acc[s] = epic.tasks.filter((t) => t.status === s);
          return acc;
        },
        {},
      )
    : null;

  return (
    <div className="fixed inset-0 z-50 pointer-events-none" role="dialog" aria-modal="true" aria-label="Epic detail">
      {/* Backdrop — subtle, not full black, so the page is still visible behind */}
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60 pointer-events-auto animate-fade-in" />
      {/* Panel */}
      <div
        ref={panelRef}
        className={cn(
          'absolute top-0 right-0 h-full w-full max-w-[560px] pointer-events-auto',
          'bg-white border-l border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
          'shadow-[0_0_60px_-15px_rgba(0,0,0,0.6)] flex flex-col animate-slide-in-right',
        )}
      >
        {isLoading || !epic ? (
          <PanelSkeleton onClose={onClose} />
        ) : (
          <>
            {/* Header */}
            <div className="px-5 pt-5 pb-4 border-b border-gray-100 dark:border-obsidian-border/60">
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: `${epic.color}20` }}
                  >
                    <Layers size={15} style={{ color: epic.color }} strokeWidth={2.25} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] uppercase tracking-[0.12em] text-gray-400 dark:text-obsidian-faded mb-0.5">
                      Epic
                    </p>
                    <h2 className="text-[18px] font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg leading-snug">
                      {epic.title}
                    </h2>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {onEdit && (
                    <Can permission="project.edit">
                      <button
                        type="button"
                        onClick={() => onEdit(epic)}
                        className="p-1.5 rounded-md text-gray-500 dark:text-obsidian-muted hover:bg-gray-100 dark:hover:bg-obsidian-raised hover:text-gray-900 dark:hover:text-obsidian-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                        aria-label="Edit epic"
                        title="Edit"
                      >
                        <Pencil size={14} />
                      </button>
                    </Can>
                  )}
                  <button
                    type="button"
                    onClick={onClose}
                    className="p-1.5 rounded-md text-gray-500 dark:text-obsidian-muted hover:bg-gray-100 dark:hover:bg-obsidian-raised hover:text-gray-900 dark:hover:text-obsidian-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                    aria-label="Close panel"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              {/* Status + meta */}
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={STATUS_TONE[epic.status]} size="sm">
                  {STATUS_LABELS[epic.status]}
                </Badge>
                <span className="text-[11px] text-gray-500 dark:text-obsidian-muted">
                  Created {formatDate(epic.createdAt)}
                </span>
                {epic.updatedAt && epic.updatedAt !== epic.createdAt && (
                  <>
                    <span className="text-gray-300 dark:text-obsidian-faded">·</span>
                    <span className="text-[11px] text-gray-500 dark:text-obsidian-muted">
                      Updated {formatDate(epic.updatedAt)}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto">
              {/* Description */}
              {epic.description && (
                <section className="px-5 py-4 border-b border-gray-100 dark:border-obsidian-border/60">
                  <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted mb-2">
                    Description
                  </h3>
                  <MarkdownView content={epic.description} compact />
                </section>
              )}

              {/* Progress rollup */}
              <section className="px-5 py-4 border-b border-gray-100 dark:border-obsidian-border/60">
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted mb-3">
                  Progress
                </h3>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <Stat label="Tasks" value={`${epic.doneTasks}/${epic.totalTasks}`} />
                  <Stat label="Points" value={`${epic.donePoints}/${epic.totalPoints}`} />
                  <Stat label="% complete" value={`${epic.progressPct}%`} accent={epic.color} />
                </div>
                <div className="h-2 rounded-full bg-gray-200 dark:bg-obsidian-border overflow-hidden">
                  <div
                    className="h-full rounded-full transition-[width] duration-700"
                    style={{ width: `${epic.progressPct}%`, background: epic.color }}
                  />
                </div>
              </section>

              {/* Tasks list */}
              <section className="px-5 py-4">
                <div className="flex items-baseline justify-between mb-3">
                  <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500 dark:text-obsidian-muted">
                    Tasks <span className="text-gray-400 dark:text-obsidian-faded font-normal">· {epic.totalTasks}</span>
                  </h3>
                </div>

                {epic.tasks.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-200 dark:border-obsidian-border p-6 text-center text-[12px] text-gray-500 dark:text-obsidian-muted">
                    No tasks have been assigned to this epic yet. Open any task and pick this epic from the dropdown to thread it in.
                  </div>
                ) : (
                  <div className="space-y-4">
                    {(['IN_PROGRESS', 'IN_REVIEW', 'TODO', 'BACKLOG', 'DONE'] as const).map((status) => {
                      const list = tasksByStatus?.[status] ?? [];
                      if (list.length === 0) return null;
                      return (
                        <div key={status}>
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className={cn('w-1.5 h-1.5 rounded-full', TASK_STATUS_DOT[status])} aria-hidden />
                            <span className="text-[10px] uppercase tracking-[0.1em] font-semibold text-gray-500 dark:text-obsidian-muted">
                              {TASK_STATUS_LABELS[status]}
                            </span>
                            <span className="text-[10px] tabular-nums text-gray-400 dark:text-obsidian-faded">
                              {list.length} {pluralWord(list.length, 'task')}
                            </span>
                          </div>
                          <ul className="rounded-lg border border-gray-100 dark:border-obsidian-border/60 overflow-hidden divide-y divide-gray-100 dark:divide-obsidian-border/50">
                            {list.map((t) => (
                              <li key={t.id}>
                                <Link
                                  to={`/projects/${epic.projectId}/tasks/${t.id}`}
                                  className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 dark:hover:bg-obsidian-raised/60 transition-colors group"
                                >
                                  <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', PRIO_DOT[t.priority])} aria-label={`Priority ${t.priority}`} />
                                  <code className="text-[10px] font-mono tabular-nums text-gray-400 dark:text-obsidian-faded shrink-0">
                                    #{t.taskNumber}
                                  </code>
                                  <span className="flex-1 min-w-0 truncate text-[12.5px] text-gray-800 dark:text-obsidian-fg group-hover:text-brand-700 dark:group-hover:text-brand-200">
                                    {t.title}
                                  </span>
                                  {t.isBlocked && (
                                    <span className="shrink-0 inline-flex items-center gap-0.5 text-[9px] font-medium px-1 py-0.5 rounded bg-rose-500/10 text-rose-700 dark:text-rose-300 ring-1 ring-rose-500/20">
                                      <AlertOctagon size={9} strokeWidth={2.5} /> blocked
                                    </span>
                                  )}
                                  {t.storyPoints != null && (
                                    <span className="shrink-0 text-[10px] font-mono tabular-nums text-gray-400 dark:text-obsidian-faded">
                                      {t.storyPoints}pt
                                    </span>
                                  )}
                                  {t.assignee && (
                                    <span
                                      className="shrink-0 w-5 h-5 rounded-full bg-brand-500/15 ring-1 ring-brand-500/25 flex items-center justify-center text-[8px] font-semibold text-brand-700 dark:text-brand-300"
                                      title={t.assignee.name}
                                    >
                                      {t.assignee.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                                    </span>
                                  )}
                                  <ChevronRight size={12} className="text-gray-300 dark:text-obsidian-faded opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                                </Link>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>

            {/* Footer — link to filter board by this epic (placeholder for now) */}
            <div className="px-5 py-3 border-t border-gray-100 dark:border-obsidian-border/60 bg-gray-50/40 dark:bg-obsidian-sunken/30">
              <Button variant="ghost" size="sm" className="w-full justify-center" onClick={onClose} leadingIcon={<ExternalLink size={13} />}>
                Close panel
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-md bg-gray-50 dark:bg-obsidian-sunken/40 ring-1 ring-gray-100 dark:ring-obsidian-border/40 px-2.5 py-2">
      <div className="text-[9px] font-medium uppercase tracking-[0.08em] text-gray-500 dark:text-obsidian-faded">
        {label}
      </div>
      <div
        className="text-[15px] font-semibold tabular-nums"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </div>
    </div>
  );
}

function PanelSkeleton({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div className="px-5 pt-5 pb-4 border-b border-gray-100 dark:border-obsidian-border/60 flex items-center justify-between">
        <div className="space-y-2 flex-1">
          <div className="skeleton h-4 w-24 rounded" />
          <div className="skeleton h-6 w-3/4 rounded" />
        </div>
        <button onClick={onClose} className="p-1.5 rounded-md text-gray-500 hover:text-gray-900" aria-label="Close">
          <X size={16} />
        </button>
      </div>
      <div className="flex-1 p-5 space-y-3">
        <div className="skeleton h-20 rounded-lg" />
        <div className="skeleton h-32 rounded-lg" />
      </div>
    </>
  );
}
