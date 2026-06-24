import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { LayoutGrid, StickyNote, Rows, Maximize2, Minimize2, Plus } from 'lucide-react';
import { UnifiedTaskCard } from '@/components/tasks/UnifiedTaskCard';
import { useTasksInfinite, useTaskCounts, useCreateTask, useMoveTask, useUpdateTask } from '@/hooks/useTasks';
import * as taskApi from '@/api/tasks';
import { usePermission } from '@/hooks/usePermission';
import { useAuthStore } from '@/stores/authStore';
import { useViewport } from '@/hooks/useViewport';
import { TASK_STATUS_ORDER, TASK_STATUS_LABELS, PRIORITY_COLORS, PRIORITY_LABELS } from '@/lib/constants';
import { cn } from '@/lib/cn';
import { extractApiErrorMessage } from '@/lib/apiErrorMessage';
import { formatDate, isOverdue } from '@/lib/formatters';
import { KanbanColumn } from './KanbanColumn';
import { MoveErrorToast } from './MoveErrorToast';
import type { MoveErrorState } from './MoveErrorToast';
import { KanbanFilterChips, EMPTY_FILTERS, applyKanbanFilters, isAnyFilterActive, type KanbanFilters } from './KanbanFilterChips';
import { KeyboardShortcutsModal } from './KeyboardShortcutsModal';
import { BulkActionBar } from './BulkActionBar';
import { useKanbanSelection } from '@/stores/kanbanSelectionStore';

/**
 * Custom PointerSensor that ignores pointer events originating from any
 * element with `data-no-dnd` (or any of its ancestors). This is dnd-kit's
 * documented way to make interactive controls inside a draggable —
 * checkboxes, popover triggers, link buttons — work without accidentally
 * starting a drag (kanban follow-up #17).
 *
 * The static `activators` field replaces the default onPointerDown; we
 * re-implement the "primary button only" check the default sensor does.
 */
class NoDndPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: 'onPointerDown' as const,
      handler: ({ nativeEvent: event }: { nativeEvent: PointerEvent }) => {
        if (!event.isPrimary || event.button !== 0) return false;
        let el: HTMLElement | null = event.target as HTMLElement | null;
        while (el) {
          if (el.hasAttribute?.('data-no-dnd')) return false;
          el = el.parentElement;
        }
        return true;
      },
    },
  ];
}

interface KanbanBoardProps {
  projectId: string;
  onTaskClick?: (taskId: string) => void;
  /**
   * Hide the toolbar's quick-add / move affordances. The board itself
   * stays interactive for filters + view-mode + maximize; only the
   * mutate-the-data path is suppressed. Used by the Client portal's
   * read-only board.
   */
  readOnly?: boolean;
  /**
   * Client task-request mode: enables quick-add ONLY on the BACKLOG
   * column, disables drag-to-move, and tags every created task with
   * `clientRequested: true` so the server's safe-shape rewriter kicks
   * in (clientVisible=true, status=BACKLOG, no assignee, no sprint).
   * Mutually compatible with `readOnly` — if both are true, this wins
   * (the user is allowed to submit requests).
   */
  clientCreateMode?: boolean;
  /**
   * Scope the board to a single product (PR C). When set, the task
   * fetch is pre-filtered by productId server-side and the board
   * never shows tasks outside that product, regardless of filter chip
   * state. Used by the product detail pages on both admin + client.
   */
  productId?: string;
}

/**
 * Soft WIP limits per status — display-only, never block adds. Defaults are
 * conservative; if a team needs different numbers, we'll wire per-project
 * config in a follow-up. Backlog has no limit (always); DONE has none either
 * (you want completed work to pile up).
 */
const WIP_LIMITS: Record<string, number | undefined> = {
  BACKLOG:     undefined,
  TODO:        20,
  IN_PROGRESS: 8,
  IN_REVIEW:   5,
  DONE:        undefined,
};

/**
 * Keys that fire shortcuts only when the user isn't typing into an input.
 * Returning true means "skip this keypress, let the input have it".
 */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

const PRIORITY_FROM_KEY: Record<string, 'P0' | 'P1' | 'P2' | 'P3'> = {
  '1': 'P0', '2': 'P1', '3': 'P2', '4': 'P3',
};

export function KanbanBoard({ projectId, onTaskClick, readOnly = false, clientCreateMode = false, productId }: KanbanBoardProps) {
  // Pre-filter the task list when scoped to a product. Without this we'd
  // fetch every task in the project and filter client-side, which is
  // wasteful and pushes the kanban toward the 500-task limit on busy
  // projects.
  const taskQueryParams = productId ? { productId } : undefined;
  // Per-PR 2026-06-04: the board paginates. Backend has no hard cap, so for
  // projects with hundreds-to-thousands of tasks we pull 200 at a time and
  // stitch the pages together client-side. Everything downstream — grouping
  // by status, filters, keyboard nav, drag-and-drop — works on the flat
  // stitched list exactly like the old single-fetch path. A "Load more"
  // affordance shows below the board when there's another page to fetch.
  const PAGE_SIZE = 200;
  const tasksQuery = useTasksInfinite(projectId, taskQueryParams, PAGE_SIZE);
  const { isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = tasksQuery;
  const tasks = useMemo(
    () => (tasksQuery.data?.pages ?? []).flat(),
    [tasksQuery.data],
  );
  // Per-status totals from the cheap groupBy endpoint — independent of which
  // pages have been loaded. Powers the column header pills and the
  // "Load more" affordance's hint about what's left to fetch.
  const { data: statusTotals } = useTaskCounts(projectId, taskQueryParams);
  const totalTaskCount = useMemo(
    () => (statusTotals ? Object.values(statusTotals).reduce((a, b) => a + b, 0) : 0),
    [statusTotals],
  );
  const createTask = useCreateTask(projectId);
  const moveTask   = useMoveTask();
  const updateTask = useUpdateTask();
  const canCreatePerm  = usePermission('task.create');
  const canCreateRequestPerm = usePermission('task.create_request');
  const canMovePerm    = usePermission('task.move_status');
  const canEdit    = usePermission('task.edit_any');
  // readOnly forces every mutating affordance off, even if the underlying
  // permission would have allowed it. Used by the client portal where
  // viewing is fine but writing isn't (client users don't get task.*
  // permissions at all; this is belt-and-suspenders).
  //
  // clientCreateMode is a separate axis: it ENABLES quick-add specifically
  // for the BACKLOG column even when readOnly is on (the case for clients —
  // they can't move/edit anything, but they can submit requests). Quick-add
  // permission is satisfied by EITHER task.create OR task.create_request.
  const canCreate = (canCreatePerm || (clientCreateMode && canCreateRequestPerm)) && !readOnly;
  // Drag-to-move is disabled on mobile regardless of permission — touch DnD
  // for kanban cards is fiddly even with dnd-kit's TouchSensor, and the
  // mobile single-column view doesn't have a sensible drop target across
  // columns anyway. The status-change path on mobile is the slide-over's
  // status picker.
  const { isMobile } = useViewport();
  const canMove   = canMovePerm && !readOnly && !clientCreateMode && !isMobile;
  const userId     = useAuthStore((s) => s.user?.id ?? null);

  const [activeTask, setActiveTask] = useState<any>(null);
  const [quickAdd, setQuickAdd] = useState<{ column: string; title: string } | null>(null);
  const [quickAddError, setQuickAddError] = useState<string | null>(null);
  // 2026-05-23 Pankaj report: silent rollback on move failure was making the
  // board feel "broken" — drag a Review card to Done, nothing happens, no
  // feedback. Surface the actual server error so the user knows whether
  // it's a permission, an acceptance-criteria gate, an illegal transition,
  // or something else. Auto-dismisses after 6s.
  //
  // 2026-05-23 v2 (this PR): the toast also carries the task that failed
  // so the user can click into it directly. The most common failure is
  // "N acceptance criteria still unchecked" — the user needs to open the
  // task, tick them, then drag again. Without this button they had to
  // hunt for the card on the board, click it, find the AC section,
  // come back, drag again. Now it's one click.
  const [moveError, setMoveError] = useState<MoveErrorState | null>(null);
  const [filters, setFilters] = useState<KanbanFilters>(EMPTY_FILTERS);

  // Filters run CLIENT-SIDE over the pages that have been loaded so far. On a
  // paginated board that means a filter would only match the first page(s) —
  // e.g. "assigned to Preetham" silently misses his tasks that live on a
  // not-yet-loaded page (the exact bug Pankaj hit). So whenever a filter is
  // active and there's another page, pull the rest in until the whole project
  // is loaded — then the client-side filter sees every matching task. With no
  // filter we leave pagination alone (light initial load via "Load more").
  useEffect(() => {
    if (isAnyFilterActive(filters) && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [filters, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Mobile single-column mode: which status the user is currently
  // viewing. Defaults to IN_PROGRESS (the "what's the team doing right
  // now?" answer most people open the board for) — falls back to
  // BACKLOG when empty so a freshly-spun-up project doesn't open on a
  // blank column. Switching tabs is a pure client-side affair; nothing
  // server-side cares about which mobile tab is selected.
  const [mobileStatus, setMobileStatus] = useState<string>('IN_PROGRESS');
  // View mode: compact (dense card) vs sticky (column-tinted "wall of
  // stickies" look — the canonical board aesthetic and now the default
  // per May 2026 feedback). Persisted per-PROJECT in localStorage so an
  // admin can prefer sticky on a marketing project's kanban while
  // keeping engineering projects compact (QA K-M2: previously a single
  // `kanban.view` key shared across every project on every tab — toggling
  // in one unexpectedly flipped the others).
  //
  // Falls back to a global `kanban.view` if the per-project key isn't
  // set, so an existing user's preference still applies on a new
  // project. Wrapped in try/catch to survive Safari private mode
  // QuotaExceededError (QA K-L4).
  const viewKey = `kanban.view.${projectId}`;
  const [view, setView] = useState<'compact' | 'sticky' | 'dense'>(() => {
    if (typeof window === 'undefined') return 'sticky';
    try {
      const projectScoped = window.localStorage.getItem(viewKey);
      if (projectScoped === 'sticky' || projectScoped === 'compact' || projectScoped === 'dense') {
        return projectScoped;
      }
      const global = window.localStorage.getItem('kanban.view');
      if (global === 'compact' || global === 'dense') return global;
      // Default → sticky. The compact + dense views stay available
      // behind the toggle for users who prefer information density.
      return 'sticky';
    } catch {
      return 'sticky';
    }
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { window.localStorage.setItem(viewKey, view); } catch { /* private mode etc. */ }
  }, [view, viewKey]);

  // ─── Collapsed columns (2026-05-21 Pankaj feedback) ─────────────────
  //
  // Per-project Set of collapsed column ids. Persisted in localStorage so
  // a user who folds Done + Backlog once doesn't have to re-fold on
  // every visit. Try/catch survives Safari private mode (same pattern as
  // the view-mode key above).
  //
  // Key choice: `kanban.collapsed.{projectId}` so the preference is
  // per-project, like the view mode. Folding Done in an engineering
  // project shouldn't fold it in a CMS project.
  const collapsedKey = `kanban.collapsed.${projectId}`;
  const [collapsedColumns, setCollapsedColumns] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = window.localStorage.getItem(collapsedKey);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.filter((s: unknown) => typeof s === 'string'));
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(collapsedKey, JSON.stringify(Array.from(collapsedColumns)));
    } catch { /* private mode etc. */ }
  }, [collapsedColumns, collapsedKey]);
  const toggleCollapsed = (status: string) => {
    setCollapsedColumns((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  // Expanded / focus mode: when true, the board takes over the viewport in
  // a fixed overlay so the user can work the kanban without sidebar +
  // page chrome competing for width. Default behaviour is compact-fit —
  // every column shares the available width and the board fits on one
  // screen without horizontal scroll. Esc exits.
  const [expanded, setExpanded] = useState(false);
  // Lock body scroll while the overlay is up so the page underneath
  // doesn't bleed scroll into the kanban.
  useEffect(() => {
    if (!expanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [expanded]);
  const boardRef = useRef<HTMLDivElement | null>(null);

  const sensors = useSensors(
    // Custom sensor: skip pointer events that originated inside (or
    // descend from) any element marked `data-no-dnd`. Without this,
    // clicking the per-card selection checkbox + a 9px wiggle (i.e.
    // exceeding the activation distance) starts a drag instead of a
    // toggle (kanban follow-up #17). The selection checkbox + every
    // BulkActionBar trigger carry the data-no-dnd attribute.
    useSensor(NoDndPointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // ─── Group tasks by status, applying filters ───
  // We keep two maps — one for display (filtered) and one for raw counts so
  // WIP-limit pills don't lie about column load when filters are active.
  const { tasksByStatus, unfilteredCounts, filterCounts } = useMemo(() => {
    const filtered: Record<string, any[]> = {};
    const counts: Record<string, number> = {};
    let mine = 0, unassigned = 0, p0 = 0, p1 = 0, blocked = 0;
    TASK_STATUS_ORDER.forEach((s) => { filtered[s] = []; counts[s] = 0; });
    (tasks ?? []).forEach((t: any) => {
      counts[t.status] = (counts[t.status] ?? 0) + 1;
      if (applyKanbanFilters(t, filters, userId)) {
        if (filtered[t.status]) filtered[t.status].push(t);
      }
      // Counts for the chips themselves — show how many tasks each chip would
      // produce if it were the only filter on. Cheap to compute here.
      if (t.assigneeId === userId) mine++;
      if (t.assigneeId == null) unassigned++;
      if (t.priority === 'P0') p0++;
      if (t.priority === 'P1') p1++;
      if (t.isBlocked) blocked++;
    });
    return {
      tasksByStatus: filtered,
      unfilteredCounts: counts,
      filterCounts: { mine, unassigned, p0, p1, blocked },
    };
  }, [tasks, filters, userId]);

  // Flat ordered list of currently-visible tasks — used by keyboard nav so
  // J/K walks the board left-to-right, top-to-bottom. On mobile only the
  // currently-selected status column is on-screen, so we constrain the
  // list — otherwise an attached keyboard could "focus" a task the user
  // can't see.
  const flatVisible = useMemo(() => {
    const out: any[] = [];
    const statuses = isMobile ? [mobileStatus] : TASK_STATUS_ORDER;
    for (const status of statuses) {
      for (const t of tasksByStatus[status] ?? []) out.push(t);
    }
    return out;
  }, [tasksByStatus, isMobile, mobileStatus]);

  // Drop the focus when the focused task is no longer visible (e.g. filter
  // change hid it). Avoids invisible focus rings + stale ↑↓ targets.
  useEffect(() => {
    if (focusedTaskId && !flatVisible.some((t) => t.id === focusedTaskId)) {
      setFocusedTaskId(null);
    }
  }, [flatVisible, focusedTaskId]);

  // ─── Selection store wiring ───
  // Reset selection when the user navigates between projects so a stale
  // task id from elsewhere can't sneak into a bulk PATCH (defense in depth
  // — the backend rejects it too).
  const setSelectionScope = useKanbanSelection((s) => s.setProjectScope);
  const toggleSelection = useKanbanSelection((s) => s.toggle);
  const setAllSelection = useKanbanSelection((s) => s.setAll);
  const selectMany = useKanbanSelection((s) => s.selectMany);
  const deselectMany = useKanbanSelection((s) => s.deselectMany);
  const clearSelection = useKanbanSelection((s) => s.clear);
  const clearAnchor = useKanbanSelection((s) => s.clearAnchor);
  const pruneStale = useKanbanSelection((s) => s.pruneStale);

  // "Select all in column" needs to cover tasks that haven't been paged in
  // yet — otherwise on a 1,000-task project you'd only ever be able to bulk-
  // act on the first 200. We fetch the flat id list for the column on demand
  // (server-side filter + visibility identical to the listing) and feed it
  // into the selection store. Per-column in-flight state hides the click
  // briefly so a slow request doesn't look like a no-op.
  const [selectingColumn, setSelectingColumn] = useState<string | null>(null);
  const handleColumnSelectAll = async (status: string, currentlyAllSelected: boolean) => {
    if (currentlyAllSelected) {
      // Deselect is cheap — we already know every loaded id, and any
      // unloaded id can't be selected, so loaded == selected for this column.
      const loadedIds = (tasksByStatus[status] ?? []).map((t: any) => t.id);
      deselectMany(loadedIds);
      return;
    }
    try {
      setSelectingColumn(status);
      const params: Record<string, string> = { status };
      if (productId) params.productId = productId;
      const ids = await taskApi.getTaskIds(projectId, params);
      selectMany(ids);
    } catch {
      // Fall back to the loaded slice so the click isn't a complete no-op.
      const loadedIds = (tasksByStatus[status] ?? []).map((t: any) => t.id);
      selectMany(loadedIds);
    } finally {
      setSelectingColumn(null);
    }
  };
  useEffect(() => { setSelectionScope(projectId); }, [projectId, setSelectionScope]);
  // After every refetch (which is what react-query triggers on a bulk
  // mutation invalidate), prune ids that are no longer in the live list.
  // Without this, a deleted task lingers in the selection set, the count
  // badge lies, and the next bulk action quietly errors per stale id
  // (kanban follow-up #24).
  useEffect(() => {
    if (!tasks) return;
    pruneStale(tasks.map((t: any) => t.id));
  }, [tasks, pruneStale]);
  // Memoize the visible-id list once per render — used for shift-click range
  // selection in SortableTaskCard.
  const visibleIds = useMemo(() => flatVisible.map((t) => t.id), [flatVisible]);

  // ─── Keyboard handler ───
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip when the user is typing in an input or modifier keys are held.
      if (isTypingTarget(e.target)) return;
      // Cmd/Ctrl-A → select all visible. We DO listen for the modifier here
      // because the existing rule ("ignore modifiers") would block it.
      if ((e.key === 'a' || e.key === 'A') && (e.metaKey || e.ctrlKey)) {
        if (flatVisible.length === 0) return;
        e.preventDefault();
        setAllSelection(visibleIds);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // Help — works anywhere on the board.
      if (e.key === '?' || (e.shiftKey && e.key === '/')) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
        return;
      }

      // Quick add — anchors to the focused task's column or first non-empty.
      if ((e.key === 'c' || e.key === 'C') && canCreate) {
        e.preventDefault();
        const focused = flatVisible.find((t) => t.id === focusedTaskId);
        const column = focused?.status ?? 'TODO';
        setQuickAdd({ column, title: '' });
        return;
      }

      // Esc — close panels first, then drop focus, then clear selection,
      // then exit expanded mode last. Order matters: a user expanding the
      // board to focus on tasks expects Esc to close the help panel first,
      // not exit the focus mode unexpectedly.
      // BulkActionBar has its own Escape handler that fires first when a
      // popover is open; we land here only when the bar's popover is closed.
      if (e.key === 'Escape') {
        if (shortcutsOpen) { setShortcutsOpen(false); return; }
        if (quickAdd)      { setQuickAdd(null); return; }
        if (focusedTaskId) { setFocusedTaskId(null); return; }
        if (useKanbanSelection.getState().selected.size > 0) {
          clearSelection();
          return;
        }
        if (expanded) { setExpanded(false); return; }
        return;
      }

      // F — toggle full-screen / expanded board. Works anywhere; the
      // letter F is unused by the existing shortcuts.
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        setExpanded((v) => !v);
        return;
      }

      // Space → toggle selection on focused card. Doesn't depend on the
      // selection set being non-empty; first Space starts a selection.
      if ((e.key === ' ' || e.code === 'Space') && focusedTaskId) {
        e.preventDefault();
        toggleSelection(focusedTaskId);
        return;
      }

      if (flatVisible.length === 0) return;

      // Navigation. Treat ↓ + j as identical, ↑ + k as identical, and arrows
      // as a richer 2-D nav (←→ jumps columns; ↑↓ stays within column).
      const focusedIndex = focusedTaskId
        ? flatVisible.findIndex((t) => t.id === focusedTaskId)
        : -1;

      // J/K — flat list, doesn't care about column boundaries.
      if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowDown') {
        const next = focusedIndex < 0 ? 0 : Math.min(flatVisible.length - 1, focusedIndex + 1);
        if (next !== focusedIndex) {
          e.preventDefault();
          setFocusedTaskId(flatVisible[next].id);
        }
        return;
      }
      if (e.key === 'k' || e.key === 'K' || e.key === 'ArrowUp') {
        const next = focusedIndex < 0 ? 0 : Math.max(0, focusedIndex - 1);
        if (next !== focusedIndex) {
          e.preventDefault();
          setFocusedTaskId(flatVisible[next].id);
        }
        return;
      }
      // Left/right — move focus between columns, picking the first task in the target column.
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const focused = flatVisible[focusedIndex];
        const currentStatus = focused?.status ?? TASK_STATUS_ORDER[0];
        const colIdx = TASK_STATUS_ORDER.indexOf(currentStatus as any);
        const nextColIdx = e.key === 'ArrowRight'
          ? Math.min(TASK_STATUS_ORDER.length - 1, colIdx + 1)
          : Math.max(0, colIdx - 1);
        for (let i = nextColIdx; i >= 0 && i < TASK_STATUS_ORDER.length;
             i += e.key === 'ArrowRight' ? 1 : -1) {
          const candidate = (tasksByStatus[TASK_STATUS_ORDER[i]] ?? [])[0];
          if (candidate) {
            e.preventDefault();
            setFocusedTaskId(candidate.id);
            return;
          }
        }
        return;
      }

      // Enter — open the focused task.
      if (e.key === 'Enter' && focusedTaskId) {
        e.preventDefault();
        onTaskClick?.(focusedTaskId);
        return;
      }

      // 1-4 → priority on the focused task.
      const prio = PRIORITY_FROM_KEY[e.key];
      if (prio && focusedTaskId && canEdit) {
        const t = flatVisible[focusedIndex];
        if (t && t.priority !== prio) {
          e.preventDefault();
          updateTask.mutate({ id: focusedTaskId, data: { priority: prio } });
        }
        return;
      }

      // 1-5 → jump focus to that column (Pankaj 2026-05-21 feedback).
      // Repurposed digits — overloads with the priority shortcut above,
      // but only fires when NO task is focused. Predictable: digits-while-
      // focused = set priority, digits-while-unfocused = navigate.
      // Map: 1=Backlog, 2=Todo, 3=In Progress, 4=In Review, 5=Done.
      // Skips a collapsed column's empty placeholder — if the user
      // explicitly folded it, focusing it would be surprising.
      if (!focusedTaskId && /^[1-5]$/.test(e.key)) {
        const colIdx = parseInt(e.key, 10) - 1;
        const target = TASK_STATUS_ORDER[colIdx];
        if (target && !collapsedColumns.has(target)) {
          const candidate = (tasksByStatus[target] ?? [])[0];
          if (candidate) {
            e.preventDefault();
            setFocusedTaskId(candidate.id);
          }
        }
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    flatVisible, focusedTaskId, tasksByStatus, shortcutsOpen, quickAdd, expanded,
    canCreate, canEdit, onTaskClick, updateTask,
    visibleIds, setAllSelection, toggleSelection, clearSelection,
    collapsedColumns,
  ]);

  if (isLoading) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-4">
        {TASK_STATUS_ORDER.map((status) => (
          <div key={status} className="flex-shrink-0 w-72 space-y-2">
            <div className="skeleton h-5 rounded w-1/2" />
            <div className="skeleton h-24 rounded-xl" />
            <div className="skeleton h-24 rounded-xl" />
          </div>
        ))}
      </div>
    );
  }

  const handleDragStart = (event: DragStartEvent) => {
    if (!canMove) return;
    const task = event.active.data.current?.task;
    if (task) setActiveTask(task);
  };

  // Surfaces the server's rejection message into the `moveError` toast.
  // Extraction logic lives in `lib/apiErrorMessage.ts` so it's unit-tested
  // independently from this 900-line component (the test pins the
  // contract that every surface relies on for "what does the user see
  // when a mutation rejects").
  //
  // `task` is optional — when supplied, the toast renders an "Open task"
  // button that opens the task detail modal so the user can immediately
  // address the cause (tick the unchecked AC, etc.).
  const showMoveError = (
    err: unknown,
    fallback = 'Could not move that task.',
    task?: { id: string; title?: string },
  ) => {
    setMoveError({
      message: extractApiErrorMessage(err, fallback),
      taskId: task?.id,
      taskTitle: task?.title,
    });
    // 8 seconds — the original 6s was tight for multi-clause errors
    // like "Cannot mark this task Done — 3 acceptance criteria are still
    // unchecked." and most users want to click "Open task" before it
    // auto-dismisses.
    setTimeout(() => setMoveError(null), 8000);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveTask(null);
    if (!canMove) return;
    const { active, over } = event;
    if (!over) return;

    const taskId = active.id as string;
    const activeTaskData = active.data.current?.task;
    if (!activeTaskData) return;

    let targetStatus: string | undefined;
    if (over.data.current?.type === 'column') {
      targetStatus = over.data.current.status;
    } else if (over.data.current?.type === 'task') {
      targetStatus = over.data.current.task.status;
    }
    if (!targetStatus || targetStatus === activeTaskData.status) return;

    // QA K-H3: if the dragged card is part of an active multi-selection,
    // move the WHOLE selection to the target column. Power users select
    // 8 cards then drag one expecting all 8 to follow (Linear/Asana
    // behaviour). Limited to selection cards in the same source status
    // — dragging a TODO card doesn't sweep selected DONE cards along.
    const selectedIds = useKanbanSelection.getState().selected;
    const draggedIsSelected = selectedIds.has(taskId);
    if (draggedIsSelected && selectedIds.size > 1) {
      const movable = (tasks ?? [])
        .filter((t: any) => selectedIds.has(t.id) && t.status === activeTaskData.status)
        .map((t: any) => ({ id: t.id, expectedUpdatedAt: t.updatedAt }));
      // Fire each move sequentially via mutateAsync so we can surface a
      // single combined error if anything fails. The optimistic-update +
      // rollback inside the hook still runs per-task; the await here
      // gives us the error to display. Each move carries its own
      // expectedUpdatedAt so a card someone else just moved 409s instead
      // of getting clobbered.
      const failures: string[] = [];
      for (const { id, expectedUpdatedAt } of movable) {
        try {
          await moveTask.mutateAsync({ id, status: targetStatus, expectedUpdatedAt });
        } catch (err) {
          failures.push(extractApiErrorMessage(err, 'Move failed'));
        }
      }
      if (failures.length > 0) {
        // Dedupe identical failure messages so the toast doesn't read like
        // "Cannot transition to Done. Cannot transition to Done. Cannot…"
        const unique = Array.from(new Set(failures));
        const summary =
          failures.length === movable.length
            ? `Couldn't move ${failures.length} task${failures.length === 1 ? '' : 's'}: ${unique.join(' · ')}`
            : `${failures.length} of ${movable.length} moves failed: ${unique.join(' · ')}`;
        // Bulk failures don't get a single "Open task" target — multiple
        // cards failed, picking one to focus would be arbitrary.
        showMoveError(new Error(summary), summary);
      }
      return;
    }

    try {
      await moveTask.mutateAsync({
        id: taskId,
        status: targetStatus,
        // Optimistic-lock guard: the value the dragging client last saw.
        // If someone else moved this card first, the server 409s and the
        // catch below rolls back + surfaces the conflict.
        expectedUpdatedAt: activeTaskData?.updatedAt,
      });
    } catch (err) {
      // Server rejected the move. The optimistic-update rollback inside
      // useMoveTask's onError has already returned the card to its source
      // column — without this toast the user would see no signal at all
      // and assume drag is broken. Quote the exact server message
      // (acceptance-criteria gate, permission gate, illegal transition,
      // etc.) so the user knows what to fix, AND pass the task so the
      // toast can offer a one-click "Open task" affordance.
      showMoveError(err, undefined, {
        id: taskId,
        title: activeTaskData?.title,
      });
    }
  };

  const handleQuickAdd = async (status: string) => {
    if (!quickAdd?.title.trim()) { setQuickAdd(null); setQuickAddError(null); return; }
    setQuickAddError(null);
    try {
      // In client-request mode, force BACKLOG (defense in depth on top of the
      // server) and flag the task as a client request so the server's
      // safe-shape rewriter kicks in. Internal users take the unchanged path.
      // When the board is product-scoped, every newly-created task inherits
      // that product — auto-scoping is what the user expects when they
      // click + on a product detail kanban.
      const basePayload = clientCreateMode
        ? { title: quickAdd.title, status: 'BACKLOG', clientRequested: true, clientVisible: true }
        : { title: quickAdd.title, status };
      const payload = productId ? { ...basePayload, productId } : basePayload;
      await createTask.mutateAsync(payload);
      setQuickAdd(null);
    } catch (err: any) {
      setQuickAddError(err?.response?.data?.error?.message || 'Could not create task. Try again?');
    }
  };

  const filterActive = isAnyFilterActive(filters);

  // Layout decisions for the columns.
  //  - Default (not expanded): all 5 columns share the available width
  //    via flex-1 + min-w. On a 13" laptop this gives ~190px each, which
  //    is enough for sticky tiles but tight for the compact card. Users
  //    who want more breathing room hit the maximize button.
  //  - Expanded: fixed 18rem columns, horizontal scroll if the viewport
  //    can't fit all of them. This is the "give me the whole screen, I
  //    want to read tasks" mode.
  const colWrapperClass = expanded
    ? 'shrink-0 w-72'
    : 'flex-1 basis-0 min-w-[176px] max-w-[20rem]';
  const rowClass = expanded
    ? 'flex gap-4 overflow-x-auto pb-4 -mx-1 px-1 transition-colors'
    : 'flex gap-3 pb-2 -mx-1 px-1 transition-colors';

  const boardCore = (
    <div ref={boardRef} className={cn(expanded && 'h-full flex flex-col min-h-0')}>
      {/* Move-error toast. Sits above the toolbar so it's the first thing
          the user sees when a drag silently snaps back. Pulled out of the
          DndContext so re-rendering on dismiss doesn't disturb in-flight
          drags. The text is the actual server error (acceptance-criteria
          gate, permission gate, illegal transition, etc.) so the user
          knows what to fix instead of staring at a board that "feels
          broken". */}
      <MoveErrorToast
        error={moveError}
        onDismiss={() => setMoveError(null)}
        onOpenTask={onTaskClick}
      />

      {/* Toolbar — filter chips + view-mode toggle + maximize + help hint */}
      <div className={cn(
        'flex items-center justify-between gap-3 flex-wrap',
        expanded ? 'mb-4 px-1' : 'mb-3',
      )}>
        <KanbanFilterChips
          filters={filters}
          onChange={(next) => {
            // Invalidate the shift-click anchor when filters change so
            // the next shift-click doesn't fill a stale range across
            // cards the user can no longer see (QA K-M1).
            setFilters(next);
            clearAnchor();
          }}
          counts={filterCounts}
          projectId={projectId}
          clientView={clientCreateMode}
        />
        {/* Desktop-only toolbar controls. The view toggle, focus mode, and
            keyboard-shortcuts hint don't apply on mobile (no keyboard, no
            multi-column layout that benefits from focus mode), so we
            hide them rather than try to squeeze them onto a 390px row. */}
        <div className="hidden lg:flex items-center gap-3">
          {/* View toggle — three modes, in order of decreasing visual
              richness:
                Sticky  — wall of color-tinted Post-its, slight rotation,
                          paper-on-cork shadow (default; classic kanban)
                Compact — neutral cards with multi-line content
                          (the "professional" mode)
                Dense   — single-line rows (~32px each), status dot ·
                          title · priority · avatar. Designed for boards
                          with 25+ tasks per column where you want every
                          item visible without scrolling. Pankaj
                          2026-05-22 ask.
              Choice persists per project via localStorage. */}
          <div className="inline-flex items-center gap-0.5 p-0.5 rounded-md bg-gray-100 dark:bg-obsidian-raised">
            <ViewToggleButton
              active={view === 'sticky'}
              onClick={() => setView('sticky')}
              icon={<StickyNote size={13} />}
              label="Sticky"
            />
            <ViewToggleButton
              active={view === 'compact'}
              onClick={() => setView('compact')}
              icon={<LayoutGrid size={13} />}
              label="Compact"
            />
            <ViewToggleButton
              active={view === 'dense'}
              onClick={() => setView('dense')}
              icon={<Rows size={13} />}
              label="Dense"
            />
          </div>
          {/* Maximize / Minimize — toggles the focus-mode overlay. */}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className={cn(
              'inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-colors',
              'border border-gray-200 dark:border-obsidian-border',
              'bg-white dark:bg-obsidian-raised',
              'text-gray-600 dark:text-obsidian-muted',
              'hover:text-gray-900 dark:hover:text-obsidian-fg',
              'hover:border-brand-300 dark:hover:border-brand-500/40',
            )}
            title={expanded ? 'Exit full screen (Esc or F)' : 'Full screen (F)'}
            aria-pressed={expanded}
          >
            {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            <span>{expanded ? 'Exit' : 'Focus'}</span>
          </button>
          <button
            type="button"
            onClick={() => setShortcutsOpen(true)}
            className="inline-flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-obsidian-faded hover:text-gray-800 dark:hover:text-obsidian-fg transition-colors"
            title="Keyboard shortcuts"
          >
            <kbd className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded text-[10px] font-mono border border-gray-200 dark:border-obsidian-border bg-gray-100 dark:bg-obsidian-raised">
              ?
            </kbd>
            shortcuts
          </button>
        </div>
      </div>

      {/* ─── Mobile status tab strip ───────────────────────────────────
          Below the filter chips, above the column. Horizontally
          scrollable pills, one per status. Active pill is brand-tinted;
          the count badge mirrors what the desktop column header shows
          (filtered count when filters are active, raw otherwise).
          Quickly tappable + one-finger-scrollable, so the lack of a
          full kanban view doesn't feel like a downgrade.

          The strip hides at lg+ because the desktop layout already
          shows every column at once. */}
      <div className="lg:hidden mb-3 -mx-1 px-1 overflow-x-auto">
        <div className="flex items-center gap-1.5 min-w-min">
          {TASK_STATUS_ORDER.map((status) => {
            const count = (tasksByStatus[status] ?? []).length;
            const unfiltered = unfilteredCounts[status] ?? 0;
            const isActive = mobileStatus === status;
            return (
              <button
                key={status}
                type="button"
                onClick={() => { setMobileStatus(status); setQuickAdd(null); }}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 h-9 rounded-full',
                  'text-[12px] font-medium transition-colors whitespace-nowrap shrink-0',
                  'min-h-[44px]',
                  isActive
                    ? 'bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-200'
                    : 'bg-gray-100 text-gray-600 dark:bg-obsidian-raised dark:text-obsidian-muted hover:bg-gray-200 dark:hover:bg-obsidian-panel',
                )}
                aria-pressed={isActive}
              >
                <span>{TASK_STATUS_LABELS[status]}</span>
                <span className={cn(
                  'text-[10px] font-bold rounded-full px-1.5 py-0.5 tabular-nums',
                  isActive
                    ? 'bg-brand-200 text-brand-800 dark:bg-brand-500/30 dark:text-brand-100'
                    : 'bg-white dark:bg-obsidian-bg text-gray-500 dark:text-obsidian-fg',
                )}>
                  {filterActive ? `${count}/${unfiltered}` : count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className={cn(
          // Mobile: single-column. Stack vertically full-width.
          // Desktop: existing flex row of 5 columns.
          isMobile
            ? 'flex flex-col gap-3 pb-2'
            : rowClass,
          // The expanded mode owns its own scroll; let the column row
          // grow to fill the overlay's remaining height. min-h-0 is
          // required for the inner overflow-y on columns to work in
          // a flex parent (flexbug 4). Expanded mode only matters on
          // desktop — mobile already has the column filling the screen.
          !isMobile && expanded && 'flex-1 min-h-0',
          // Sticky mode wraps the columns in a darker panel reminiscent of
          // a physical kanban — gives the cards a "pinned to a board"
          // feel rather than floating in the page background.
          view === 'sticky' && cn(
            'rounded-2xl p-3 sm:p-4',
            'bg-slate-100 dark:bg-[#0f0f14]',
            'ring-1 ring-slate-200 dark:ring-brand-500/15',
            'shadow-soft dark:shadow-soft-dark',
          ),
        )}>
          {/* On mobile we render only the currently-selected status; on
              desktop we render all five. Same column component either way
              so quick-add, sticky vs compact card style, and aging-dot
              behavior all carry over without per-mode branching. */}
          {(isMobile ? [mobileStatus] : TASK_STATUS_ORDER).map((status) => (
            <div key={status} className={cn(
              isMobile ? 'w-full' : colWrapperClass,
              'flex flex-col min-w-0',
            )}>
              {/* Inline quick-add — appears above the column when triggered (C key or + button) */}
              {quickAdd?.column === status && (
                <div className="w-full mb-2 animate-fade-in-down">
                  <div className={cn(
                    'rounded-lg p-3',
                    'bg-white border border-brand-400 dark:bg-obsidian-raised dark:border-brand-500/50',
                    'shadow-lift dark:shadow-lift-dark',
                  )}>
                    <input
                      autoFocus
                      value={quickAdd.title}
                      onChange={(e) => setQuickAdd({ ...quickAdd, title: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); handleQuickAdd(status); }
                        if (e.key === 'Escape') { e.preventDefault(); setQuickAdd(null); }
                      }}
                      onBlur={() => handleQuickAdd(status)}
                      placeholder={clientCreateMode ? 'What do you need? Briefly…' : 'Task title…'}
                      className="w-full text-sm bg-transparent border-0 outline-none p-0 text-gray-900 dark:text-obsidian-fg placeholder:text-gray-400 dark:placeholder:text-obsidian-faded focus:ring-0"
                      style={{ boxShadow: 'none' }}
                    />
                    <p className="mt-2 text-[10px] text-gray-400 dark:text-obsidian-faded">
                      <kbd className="px-1 py-0.5 rounded bg-gray-100 dark:bg-obsidian-panel text-gray-600 dark:text-obsidian-muted font-mono">↵</kbd> {clientCreateMode ? 'send to team' : 'add'}
                      <span className="mx-1.5">·</span>
                      <kbd className="px-1 py-0.5 rounded bg-gray-100 dark:bg-obsidian-panel text-gray-600 dark:text-obsidian-muted font-mono">Esc</kbd> cancel
                    </p>
                    {quickAddError && quickAdd?.column === status && (
                      <p className="mt-2 text-[11px] text-rose-600 dark:text-rose-400 leading-snug">
                        {quickAddError}
                      </p>
                    )}
                  </div>
                </div>
              )}

              <KanbanColumn
                id={status}
                title={TASK_STATUS_LABELS[status]}
                tasks={tasksByStatus[status]}
                // Server-truth total for this column — header pill shows the
                // real number across all pages, not "how many have I scrolled
                // in". When the filter chips are active and would trim the
                // count, we still display the unfiltered total so the WIP
                // signal stays honest.
                totalCount={statusTotals?.[status]}
                onSelectAllInColumn={(currentlyAll) => handleColumnSelectAll(status, currentlyAll)}
                selectAllPending={selectingColumn === status}
                onTaskClick={onTaskClick}
                // In clientCreateMode the + button only appears on BACKLOG —
                // the team triages from there, so other columns are not a
                // legal entry point for a client request. Internal users
                // (canCreate without clientCreateMode) get the + on every
                // column as before.
                canCreate={clientCreateMode ? (canCreate && status === 'BACKLOG') : canCreate}
                canMove={canMove}
                quickAddLabel={clientCreateMode ? 'Submit a request' : undefined}
                onQuickAdd={() => setQuickAdd({ column: status, title: '' })}
                wipLimit={WIP_LIMITS[status]}
                unfilteredCount={filterActive ? (statusTotals?.[status] ?? unfilteredCounts[status]) : undefined}
                focusedTaskId={focusedTaskId}
                visibleOrder={visibleIds}
                cardStyle={view}
                fit={expanded ? 'fixed' : 'fluid'}
                // Collapse is desktop-only — on mobile we already render
                // a single column at a time via mobileStatus, so folding
                // it would leave the page blank.
                collapsed={!isMobile && collapsedColumns.has(status)}
                onToggleCollapse={isMobile ? undefined : () => toggleCollapsed(status)}
              />
            </div>
          ))}
        </div>

        {/* Load-more affordance for projects too big to fit in the initial
            page. We don't auto-fetch on scroll — the kanban has independent
            inner-scroll per column, so a unified "you scrolled to the
            bottom" signal doesn't translate. An explicit button under the
            board lets the user pull the next page when they want it; the
            counts hint at how much is left. Disappears once everything is
            loaded. */}
        {hasNextPage && (
          <div className="flex items-center justify-center pt-3 pb-1">
            <button
              type="button"
              onClick={() => { void fetchNextPage(); }}
              disabled={isFetchingNextPage}
              className={cn(
                'inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors',
                'border border-gray-200 dark:border-obsidian-border',
                'bg-white dark:bg-obsidian-raised',
                'text-gray-700 dark:text-obsidian-fg',
                'hover:border-brand-300 dark:hover:border-brand-500/40',
                'disabled:opacity-60 disabled:cursor-not-allowed',
              )}
            >
              <Plus size={13} />
              {isFetchingNextPage
                ? 'Loading more tasks…'
                : totalTaskCount > 0
                  ? `Load more (${tasks.length} of ${totalTaskCount} loaded)`
                  : 'Load more tasks'}
            </button>
          </div>
        )}

        {/* Drag overlay — shown while a card is being dragged. Uses the
            current view mode so the ghost matches the board (QA K-H2:
            in sticky mode the overlay was always the white compact
            card, which looked jarring while dragging a coloured sticky). */}
        <DragOverlay>
          {activeTask && canMove ? <DragOverlayCard task={activeTask} cardStyle={view} /> : null}
        </DragOverlay>
      </DndContext>

      <KeyboardShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <BulkActionBar projectId={projectId} />
    </div>
  );

  if (!expanded) return boardCore;

  // Expanded overlay — fixed-position viewport-fill so the kanban can
  // breathe without the AppShell sidebar + page chrome stealing
  // horizontal real estate. Mouse and keyboard still target the same
  // React tree, so all the existing handlers (filters, dnd-kit sensors,
  // selection state, shortcuts) keep working unchanged.
  return (
    <>
      {/* Keep the spot in the page so the layout doesn't jump on exit. */}
      <div className="rounded-2xl border border-dashed border-gray-200 dark:border-obsidian-border bg-gray-50/40 dark:bg-obsidian-panel/30 py-10 text-center text-[12px] text-gray-400 dark:text-obsidian-faded">
        Board is in focus mode — press <kbd className="mx-1 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-obsidian-raised font-mono">Esc</kbd> or click <span className="font-medium text-gray-600 dark:text-obsidian-muted">Exit</span> to return.
      </div>
      <div
        className="fixed inset-0 z-[55] bg-gray-50 dark:bg-obsidian-bg overflow-hidden p-5 flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label="Project board — full screen"
      >
        {boardCore}
      </div>
    </>
  );
}

// ─── Drag overlay (the "ghost" card following the cursor) ───
//
// In sticky mode we reuse `UnifiedTaskCard` so the overlay carries the
// same column tint, gradient, and rotation as the in-place card. In
// compact mode we keep the more pronounced "lifted brand-ringed paper"
// styling that hints at active drag intent. (QA K-H2.)
function DragOverlayCard({ task, cardStyle }: { task: any; cardStyle: 'compact' | 'sticky' | 'dense' }) {
  if (cardStyle === 'sticky') {
    return (
      <div className="w-72">
        <UnifiedTaskCard task={task} variant="kanban" cardStyle="sticky" showProject={false} className="ring-2 ring-brand-400/40 shadow-pop dark:shadow-pop-dark" />
      </div>
    );
  }
  const priorityColor = PRIORITY_COLORS[task.priority as keyof typeof PRIORITY_COLORS];
  return (
    <div className={cn(
      'w-72 rounded-xl p-3 rotate-2',
      'bg-white border-2 dark:bg-obsidian-raised',
      'shadow-pop dark:shadow-pop-dark',
      'ring-2 ring-brand-400/60 dark:ring-brand-400/50',
      task.isBlocked
        ? 'border-rose-300 dark:border-rose-500/40'
        : 'border-brand-300 dark:border-brand-500/40',
    )}>
      <h4 className="text-[13px] font-medium text-gray-900 dark:text-obsidian-fg line-clamp-2 mb-2">{task.title}</h4>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded"
          style={{ backgroundColor: priorityColor + '20', color: priorityColor }}>
          {PRIORITY_LABELS[task.priority as keyof typeof PRIORITY_LABELS]}
        </span>
        {task.isBlocked && (
          <span className="px-1.5 py-0.5 text-[10px] font-semibold rounded bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-300">
            Blocked
          </span>
        )}
        {task.dueDate && (
          <span className={cn(
            'text-[10px]',
            isOverdue(task.dueDate) ? 'text-rose-600 dark:text-rose-400 font-medium' : 'text-gray-400 dark:text-obsidian-faded',
          )}>
            {formatDate(task.dueDate)}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── View-mode toggle button ───
function ViewToggleButton({
  active, onClick, icon, label,
}: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium transition-colors',
        active
          ? 'bg-white dark:bg-obsidian-bg text-gray-900 dark:text-obsidian-fg shadow-sm'
          : 'text-gray-500 dark:text-obsidian-muted hover:text-gray-700 dark:hover:text-obsidian-fg',
      )}
      aria-pressed={active}
      title={`${label} view`}
    >
      {icon}
      {label}
    </button>
  );
}
