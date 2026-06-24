import { cn } from '@/lib/cn';

/**
 * The kanban move-rejection toast. Surfaces the actual server error after a
 * drag-to-move was silently rolled back, with a one-click "Open task"
 * affordance so the user can immediately address the cause (tick AC,
 * resolve permission, etc.).
 *
 * Extracted from `KanbanBoard.tsx` as its own component so it can be
 * unit-tested with React Testing Library independently of the 900-line
 * board. The board still owns the `moveError` state — this component is
 * a pure presentational shell.
 *
 * Render contract:
 *   - When `error` is null, renders nothing.
 *   - When `error.taskId` + `onOpenTask` are both provided, renders an
 *     "Open task →" button that calls onOpenTask(error.taskId) THEN
 *     onDismiss(). Order matters: dismissing first would unmount the
 *     button before the click handler completes (React batches, but the
 *     contract is "open, then dismiss" so the modal owner sees the open
 *     before the toast disappears).
 *   - The ✕ button always renders and fires onDismiss().
 *   - role="status" + aria-live="polite" so screen readers announce the
 *     failure without stealing focus.
 */

export interface MoveErrorState {
  message: string;
  taskId?: string;
  taskTitle?: string;
}

export interface MoveErrorToastProps {
  error: MoveErrorState | null;
  onDismiss: () => void;
  /**
   * When provided, the toast renders an "Open task →" button on rows that
   * carry a taskId. The board passes its `onTaskClick` here; the client
   * portal (read-only board) omits this so the button never renders.
   */
  onOpenTask?: (taskId: string) => void;
}

export function MoveErrorToast({ error, onDismiss, onOpenTask }: MoveErrorToastProps) {
  if (!error) return null;

  const handleOpen = () => {
    // Capture the id BEFORE we trigger the parent's dismiss — otherwise a
    // synchronous setState in the parent could clear `error` and we'd
    // lose the reference.
    const id = error.taskId;
    if (id && onOpenTask) onOpenTask(id);
    onDismiss();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="kanban-move-error-toast"
      className={cn(
        'mb-3 flex items-start gap-2 rounded-md border px-3 py-2 text-xs',
        'border-rose-300 bg-rose-50 text-rose-800',
        'dark:border-rose-700 dark:bg-rose-950/30 dark:text-rose-200',
      )}
    >
      <span className="font-semibold shrink-0">Move failed:</span>
      <span className="flex-1 leading-snug">{error.message}</span>
      {error.taskId && onOpenTask && (
        <button
          type="button"
          onClick={handleOpen}
          className={cn(
            'shrink-0 px-2 py-0.5 rounded-md font-semibold',
            'border border-rose-400 dark:border-rose-600',
            'bg-rose-100 hover:bg-rose-200',
            'dark:bg-rose-900/40 dark:hover:bg-rose-900/60',
          )}
          title={error.taskTitle ? `Open "${error.taskTitle}"` : 'Open task'}
        >
          Open task →
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 text-rose-700 hover:text-rose-900 dark:text-rose-300 dark:hover:text-rose-100"
        aria-label="Dismiss error"
      >
        ✕
      </button>
    </div>
  );
}
