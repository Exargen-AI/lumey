import { useRef, useEffect } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { UnifiedTaskCard } from '@/components/tasks/UnifiedTaskCard';
import { useKanbanSelection } from '@/stores/kanbanSelectionStore';

interface SortableTaskCardProps {
  task: any;
  onClick?: () => void;
  canMove?: boolean;
  /** When true, this card is the keyboard-focus target — render a ring + scroll into view. */
  isFocused?: boolean;
  /**
   * Visible task ids in render order. Passed by the board so shift-click
   * range selection can fill the anchor → click range correctly.
   */
  visibleOrder?: string[];
  /**
   * Visual style — defaults to compact (current dense card). 'sticky' applies
   * the column-tinted "wall of stickies" treatment. Threaded down from the
   * board's view-mode toggle.
   */
  cardStyle?: 'compact' | 'sticky' | 'dense';
}

export function SortableTaskCard({ task, onClick, canMove = true, isFocused = false, visibleOrder = [], cardStyle = 'compact' }: SortableTaskCardProps) {
  // Dense mode hides the bulk-selection checkbox + aging dot so the
  // row stays one line. The checkbox would either push the title or
  // overlap it; the aging dot's "drama" is wasted at 12px tall.
  const isDense = cardStyle === 'dense';
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { type: 'task', task },
    disabled: !canMove,
  });
  const wasDragging = useRef(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Selection store. We subscribe to just the boolean for this card to keep
  // re-renders narrow — toggling another card doesn't re-render this one.
  const isSelected = useKanbanSelection((s) => s.selected.has(task.id));
  const hasAnySelection = useKanbanSelection((s) => s.selected.size > 0);
  const toggle = useKanbanSelection((s) => s.toggle);
  const toggleRange = useKanbanSelection((s) => s.toggleRange);

  if (isDragging) wasDragging.current = true;

  const handleClick = (e: React.MouseEvent) => {
    if (wasDragging.current) { wasDragging.current = false; return; }
    // Cmd/Ctrl-click: toggle selection without opening the detail panel.
    // Shift-click: fill the range from anchor to here.
    // Plain click: open detail panel (existing behavior).
    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      e.stopPropagation();
      toggle(task.id);
      return;
    }
    if (e.shiftKey && hasAnySelection) {
      e.preventDefault();
      e.stopPropagation();
      toggleRange(task.id, visibleOrder);
      return;
    }
    onClick?.();
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    // Stop the drag-listener from claiming the click (prevents starting a
    // drag when the user really meant to toggle). Same reason for explicit
    // `onClick` rather than relying on label-for.
    e.preventDefault();
    e.stopPropagation();
    if (e.shiftKey && hasAnySelection) {
      toggleRange(task.id, visibleOrder);
    } else {
      toggle(task.id);
    }
  };

  // Block dnd-kit from claiming pointer events on the checkbox itself —
  // otherwise mousedown on the checkbox starts a drag instead of toggling.
  const swallowPointer = (e: React.PointerEvent | React.MouseEvent) => {
    e.stopPropagation();
  };

  // Keep the focused card in view as J/K nav walks through long columns.
  useEffect(() => {
    if (isFocused && wrapperRef.current) {
      wrapperRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [isFocused]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // Aging dot — visible on TODO / IN_PROGRESS / IN_REVIEW only. Muted gold at
  // 3-5 days, rose at 5+ days. We don't surface a number to keep the card calm.
  const age = typeof task.currentStatusAgeDays === 'number' ? task.currentStatusAgeDays : null;
  const showAging =
    age != null &&
    age >= 3 &&
    (task.status === 'TODO' || task.status === 'IN_PROGRESS' || task.status === 'IN_REVIEW');
  const agingTone = age != null && age >= 5 ? 'rose' : 'amber';

  return (
    <div
      ref={(el) => { setNodeRef(el); wrapperRef.current = el; }}
      style={style}
      {...attributes}
      {...listeners}
      onClick={handleClick}
      data-task-id={task.id}
      data-task-status={task.status}
      data-selected={isSelected || undefined}
      className={cn(
        'group relative',
        canMove ? 'cursor-grab active:cursor-grabbing select-none' : 'cursor-pointer',
        // While dragging the in-place ghost dims out — the floating DragOverlay
        // is what the user actually follows.
        isDragging && 'opacity-40',
        // Keyboard focus ring — drawn just outside the card so it doesn't
        // change card layout.
        isFocused && 'rounded-xl ring-2 ring-brand-500 dark:ring-brand-400 ring-offset-2 ring-offset-gray-50 dark:ring-offset-obsidian-bg',
      )}
    >
      <UnifiedTaskCard
        task={task}
        variant="kanban"
        cardStyle={cardStyle}
        showProject={false}
        className={cn(
          'transition-all',
          !isFocused && cardStyle !== 'sticky' && 'hover:border-brand-300 dark:hover:border-brand-500/40 hover:shadow-lift dark:hover:shadow-lift-dark',
          // Selected state — brand-tinted ring + slight tint so it's
          // distinguishable from focus.
          isSelected && 'ring-2 ring-brand-500 ring-offset-1 ring-offset-gray-50 dark:ring-offset-obsidian-bg bg-brand-50/40 dark:bg-brand-500/[0.06]',
        )}
      />
      {/* Selection checkbox + aging dot are HIDDEN in dense mode — the
          row is too short to host them without breaking the one-line
          rhythm. Multi-select + aging signals still work; they're just
          surfaced in compact/sticky modes. */}
      {!isDense && (
        <>
          {/* Selection checkbox — appears on hover, locks visible while
              something is selected so the user has a clear way to deselect.
              `data-no-dnd` tells the custom PointerSensor in KanbanBoard to
              ignore pointer events originating here, so a click-and-wiggle on
              the checkbox can never start a drag (kanban follow-up #17). */}
          <button
            type="button"
            role="checkbox"
            data-no-dnd
            aria-checked={isSelected}
            aria-label={isSelected ? 'Deselect task' : 'Select task'}
            onClick={handleCheckboxClick}
            onPointerDown={swallowPointer}
            onMouseDown={swallowPointer}
            className={cn(
              'absolute top-2 left-2 w-4 h-4 rounded border flex items-center justify-center transition-all',
              isSelected
                ? 'bg-brand-600 border-brand-600 text-white opacity-100'
                : 'bg-white dark:bg-obsidian-bg border-gray-300 dark:border-obsidian-border text-transparent opacity-0 group-hover:opacity-100',
              hasAnySelection && 'opacity-100',
            )}
          >
            {isSelected && <Check size={11} strokeWidth={3} />}
          </button>
          {showAging && (
            <span
              className={cn(
                'absolute top-2 right-2 w-1.5 h-1.5 rounded-full pointer-events-none',
                agingTone === 'rose' ? 'bg-rose-500 shadow-[0_0_4px_rgba(244,63,94,0.55)]' : 'bg-amber-500 shadow-[0_0_4px_rgba(245,158,11,0.55)]',
              )}
              aria-label={`Aging — ${age} days in ${task.status}`}
              title={`In ${task.status.toLowerCase().replace('_', ' ')} for ${age} ${age === 1 ? 'day' : 'days'}`}
            />
          )}
        </>
      )}
    </div>
  );
}
