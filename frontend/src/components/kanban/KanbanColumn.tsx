import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Plus, Inbox, ChevronDown, ChevronRight, CheckSquare, Square } from 'lucide-react';
import { Tooltip } from '@/components/ui';
import { cn } from '@/lib/cn';
import { SortableTaskCard } from './SortableTaskCard';
import { useKanbanSelection } from '@/stores/kanbanSelectionStore';

interface KanbanColumnProps {
  id: string;
  title: string;
  tasks: any[];
  onTaskClick?: (taskId: string) => void;
  onQuickAdd?: () => void;
  canCreate?: boolean;
  canMove?: boolean;
  /** Soft WIP limit — display only, doesn't block adds. Omit for no limit. */
  wipLimit?: number;
  /** Whether the column count reflects a filtered view (we still show the limit
      against the unfiltered total to keep the WIP signal honest). */
  unfilteredCount?: number;
  /**
   * Server-truth total for this column across all pages. The kanban paginates
   * the task list (200 per request, no hard cap), so `tasks.length` is "what
   * scrolled in", not "what's actually there". When provided this is used for
   * the header pill and the WIP indicator so a 1,000-task BACKLOG reads as
   * "BACKLOG 1000" even before every page has been pulled in.
   */
  totalCount?: number;
  /**
   * Override for the "Select all in column" button. When supplied, clicking
   * the checkbox calls this with the current "all loaded selected" state
   * instead of running the default loaded-only path — the parent typically
   * fetches the full id list (incl. unloaded pages) so bulk ops can cover
   * the whole column on big projects.
   */
  onSelectAllInColumn?: (currentlyAllSelected: boolean) => void;
  /** While the parent is fetching the full id list, dim the checkbox so a
      slow request doesn't look like the click did nothing. */
  selectAllPending?: boolean;
  /** Tooltip on the + button — defaults to "Add task to this column".
   *  Client kanban uses "Submit a request" so the affordance reads as a
   *  request flow, not a creation flow. */
  quickAddLabel?: string;
  /** Currently keyboard-focused task id, so the column can draw a focus ring. */
  focusedTaskId?: string | null;
  /** Flat ordered list of visible task ids across the whole board — passed
      down for shift-click range selection. */
  visibleOrder?: string[];
  /** Visual treatment threaded from the board-level toggle. */
  cardStyle?: 'compact' | 'sticky' | 'dense';
  /**
   * Width strategy:
   *   - 'fixed'  → legacy 18rem column with shrink-0 (used in expanded /
   *                focus-mode overlay where horizontal scroll is fine).
   *   - 'fluid'  → fill the parent's width (the board sets that to a
   *                flex-1 share, so 5 columns split the viewport equally).
   *                This is the default — keeps the board on one screen
   *                without horizontal scroll on typical laptops.
   */
  fit?: 'fixed' | 'fluid';
  /**
   * Collapsed mode (2026-05-21 Pankaj feedback).
   * When true, render only the header — no task list. The header
   * stays clickable so the user can re-expand. The collapsed column
   * keeps its width so the row layout doesn't reflow as columns toggle.
   * Drop-targets remain active so a teammate can drop work into a
   * collapsed column (e.g. dragging to "Done" without seeing every
   * done task).
   */
  collapsed?: boolean;
  /** Toggle handler — fires from the chevron in the column header. */
  onToggleCollapse?: () => void;
}

// Status → accent colour for the column count pill. Keeps each column visually
// distinct so the eye can scan the board horizontally without reading labels.
const STATUS_TONE: Record<string, { dot: string; pill: string }> = {
  BACKLOG:     { dot: 'bg-gray-400 dark:bg-obsidian-faded', pill: 'bg-gray-100 text-gray-600 dark:bg-obsidian-raised dark:text-obsidian-muted' },
  TODO:        { dot: 'bg-blue-500',      pill: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300' },
  IN_PROGRESS: { dot: 'bg-brand-500',     pill: 'bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300' },
  IN_REVIEW:   { dot: 'bg-amber-500',     pill: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  DONE:        { dot: 'bg-emerald-500',   pill: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
};

export function KanbanColumn({
  id, title, tasks, onTaskClick, onQuickAdd, canCreate, canMove = true,
  wipLimit, unfilteredCount, totalCount, focusedTaskId, visibleOrder, cardStyle = 'compact',
  fit = 'fluid', quickAddLabel = 'Add task to this column',
  collapsed = false, onToggleCollapse,
  onSelectAllInColumn, selectAllPending = false,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id, data: { type: 'column', status: id } });
  const taskIds = tasks.map((t) => t.id);
  const selectedSet = useKanbanSelection((s) => s.selected);
  const selectMany = useKanbanSelection((s) => s.selectMany);
  const deselectMany = useKanbanSelection((s) => s.deselectMany);
  const allSelected = taskIds.length > 0 && taskIds.every((tid) => selectedSet.has(tid));
  const tone = STATUS_TONE[id] || STATUS_TONE.BACKLOG;
  // The WIP signal should reflect REAL load, not the filtered view — otherwise
  // ticking "My issues" makes a column look healthy when it's actually drowning.
  // Server-truth total takes precedence over the loaded slice on paginated
  // boards, so a 1,000-task BACKLOG shows the real number even before every
  // page has been pulled in.
  const wipCount = unfilteredCount ?? totalCount ?? tasks.length;
  const overLimit = wipLimit != null && wipCount > wipLimit;
  const atLimit   = wipLimit != null && wipCount === wipLimit;

  return (
    <div className={cn(
      'flex flex-col min-h-0',
      // 'fluid' columns inherit width from the board's flex parent. 'fixed'
      // restores the legacy 18rem width — used inside the focus-mode
      // overlay where horizontal scroll is acceptable.
      fit === 'fixed' ? 'flex-shrink-0 w-72' : 'w-full',
    )}>
      {/* Column header — colored dot + title + count pill + WIP limit + add button.
          When `onToggleCollapse` is provided, the whole left half acts as a
          toggle (chevron + dot + title + count). The +-button stays on the
          right and remains independent.
          Pankaj 2026-05-22 feedback: the chevron was too subtle to find.
          Bumped size (11 → 13), added a tooltip, and the whole header
          now gets a clear hover bg + cursor-pointer so the affordance
          reads. */}
      <div className="flex items-center justify-between mb-3 px-1">
        <button
          type="button"
          onClick={onToggleCollapse}
          disabled={!onToggleCollapse}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Expand ${title} column` : `Collapse ${title} column`}
          title={
            onToggleCollapse
              ? (collapsed ? `Show ${wipCount} ${wipCount === 1 ? 'task' : 'tasks'} in ${title}` : `Hide tasks in ${title}`)
              : undefined
          }
          className={cn(
            'group/colhdr flex items-center gap-2 min-w-0 rounded-md px-1.5 py-1 -ml-1.5 transition-colors',
            onToggleCollapse
              ? 'hover:bg-gray-100 dark:hover:bg-obsidian-raised/70 cursor-pointer active:bg-gray-200 dark:active:bg-obsidian-raised'
              : 'cursor-default',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
          )}
        >
          {onToggleCollapse && (
            <span className={cn(
              'shrink-0 transition-colors',
              // Brighter idle colour + an extra hover step so the chevron
              // shows it's interactive. Larger size (13px) makes it
              // discoverable at a glance.
              'text-gray-500 dark:text-obsidian-muted',
              'group-hover/colhdr:text-brand-600 dark:group-hover/colhdr:text-brand-300',
            )}>
              {collapsed
                ? <ChevronRight size={13} strokeWidth={2.75} />
                : <ChevronDown size={13} strokeWidth={2.75} />}
            </span>
          )}
          <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', tone.dot)} />
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-gray-700 dark:text-obsidian-muted truncate">
            {title}
          </h3>
          <span
            className={cn(
              'text-[10px] font-bold rounded-full px-1.5 py-0.5 shrink-0',
              overLimit
                ? 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300 ring-1 ring-rose-500/30'
                : atLimit
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                : tone.pill,
            )}
            title={wipLimit != null ? `${wipCount} of ${wipLimit} (WIP limit)` : `${wipCount} tasks`}
          >
            {wipCount}
            {wipLimit != null && (
              <span className="opacity-60">/{wipLimit}</span>
            )}
          </span>
        </button>
        <div className="flex items-center gap-1">
          {!collapsed && taskIds.length > 0 && (
            <Tooltip content={allSelected ? `Deselect all in ${title}` : `Select all in ${title}`} side="top">
              <button
                type="button"
                onClick={() => {
                  // Defer to the parent when supplied — it knows about the
                  // unloaded pages on a paginated board and will pull the
                  // full id list so bulk ops cover the whole column.
                  if (onSelectAllInColumn) onSelectAllInColumn(allSelected);
                  else if (allSelected) deselectMany(taskIds);
                  else selectMany(taskIds);
                }}
                disabled={selectAllPending}
                aria-label={allSelected ? `Deselect all tasks in ${title}` : `Select all tasks in ${title}`}
                aria-pressed={allSelected}
                className={cn(
                  'inline-flex items-center justify-center w-6 h-6 rounded-md transition-colors',
                  selectAllPending && 'opacity-50 cursor-wait',
                  allSelected
                    ? 'text-brand-600 hover:text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-500/10'
                    : 'text-gray-400 hover:text-brand-600 hover:bg-brand-50 dark:text-obsidian-faded dark:hover:text-brand-400 dark:hover:bg-brand-500/10',
                )}
              >
                {allSelected ? <CheckSquare size={14} /> : <Square size={14} />}
              </button>
            </Tooltip>
          )}
          {canCreate && onQuickAdd && !collapsed && (
          <Tooltip content={quickAddLabel} side="top">
            <button
              onClick={onQuickAdd}
              className={cn(
                'inline-flex items-center justify-center w-6 h-6 rounded-md transition-colors',
                'text-gray-400 hover:text-brand-600 hover:bg-brand-50',
                'dark:text-obsidian-faded dark:hover:text-brand-400 dark:hover:bg-brand-500/10',
              )}
              aria-label={quickAddLabel}
            >
              <Plus size={14} />
            </button>
          </Tooltip>
        )}
        </div>
      </div>

      {/* Column drop zone — slightly more breathing room between cards in
          sticky mode so the rotated cards don't visually clip each other.
          In fluid (default) mode the column should grow with the parent
          so the inner scroll attaches to the column, not the page.
          When collapsed the drop zone shrinks to a thin strip — drops
          still work (the column can still receive moves) but visually
          gets out of the way. */}
      <div
        ref={setNodeRef}
        className={cn(
          'rounded-xl transition-all duration-150',
          'border border-transparent',
          collapsed
            ? 'p-1 min-h-[24px] flex items-center justify-center'
            : cn(
                'p-2',
                // Dense rows want LESS vertical space between them
                // (space-y-1 = 4px) vs the breathing room sticky needs
                // (3.5 = 14px). Compact is the middle (8px).
                cardStyle === 'sticky' ? 'space-y-3.5 pt-3'
                  : cardStyle === 'dense' ? 'space-y-1'
                  : 'space-y-2',
                // Allow each column to scroll its own task list when the
                // viewport is small; floor it so an empty column still has a
                // sensible drop target.
                fit === 'fluid' ? 'flex-1 min-h-[140px] overflow-y-auto' : 'min-h-[140px]',
              ),
          canMove && isOver
            ? 'bg-brand-50 border-brand-300 dark:bg-brand-500/[0.06] dark:border-brand-500/40 ring-2 ring-brand-400/30'
            : 'bg-gray-50/40 dark:bg-obsidian-bg/40',
        )}
      >
        {collapsed ? (
          // Collapsed visual: a thin dashed strip + the count. Stays a
          // drop target so a teammate dragging to (say) Done doesn't have
          // to expand it first.
          <span className="text-[10px] text-gray-400 dark:text-obsidian-faded italic">
            {wipCount} {wipCount === 1 ? 'task' : 'tasks'} hidden — click to expand
          </span>
        ) : (
          <>
            <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
              {tasks.map((task) => (
                <SortableTaskCard
                  key={task.id}
                  task={task}
                  canMove={canMove}
                  isFocused={focusedTaskId === task.id}
                  onClick={() => onTaskClick?.(task.id)}
                  visibleOrder={visibleOrder}
                  cardStyle={cardStyle}
                />
              ))}
            </SortableContext>

            {/* Empty state — gentle prompt, not a wall of text */}
            {tasks.length === 0 && (
              <div className="py-8 flex flex-col items-center gap-1.5 text-gray-300 dark:text-obsidian-faded">
                <Inbox size={20} strokeWidth={1.5} />
                <span className="text-[10px]">No tasks</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
