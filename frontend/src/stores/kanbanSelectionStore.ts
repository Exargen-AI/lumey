import { create } from 'zustand';

/**
 * Kanban multi-select state. Lives in zustand so the floating action bar,
 * the cards themselves, and any keyboard handler can all read + mutate the
 * same Set without prop-drilling.
 *
 * Per-project scoping: switching projects clears the set. We trigger that
 * from `KanbanBoard` via an effect on `projectId` change so a stale id from
 * a different project never lands in a bulk PATCH.
 *
 * Shift-click range selection needs an "anchor" — the last single-clicked
 * card. The board passes the visible task order down so we can fill the
 * range correctly even when columns are visually disjoint.
 */
interface KanbanSelectionState {
  selected: Set<string>;
  /** Last toggled id — used as the anchor for shift-click range selection. */
  anchorId: string | null;
  /** Project this selection belongs to. Cleared on project change. */
  projectId: string | null;

  toggle: (taskId: string) => void;
  clear: () => void;
  /** Drop only the shift-click anchor (selection set survives). Called when
   * filters change so the next shift-click doesn't fill a stale range
   * across cards the user can no longer see (QA K-M1). */
  clearAnchor: () => void;
  setProjectScope: (projectId: string) => void;
  /** Replace the entire set (used by select-all / select-column). */
  setAll: (taskIds: string[]) => void;
  /** Add ids to the current selection — used by per-column "select all". */
  selectMany: (taskIds: string[]) => void;
  /** Remove ids from the current selection — used by per-column "deselect all". */
  deselectMany: (taskIds: string[]) => void;
  /**
   * Fill selection from `anchorId` to `taskId` along the supplied visible
   * order — the same order the kanban renders cards in. Inclusive on both
   * ends. If no anchor is set, falls back to a single-toggle.
   */
  toggleRange: (taskId: string, visibleOrder: string[]) => void;
  /**
   * Drop selection ids that are no longer in `liveIds`. Used after bulk
   * mutations to keep the set honest (kanban follow-up #24).
   */
  pruneStale: (liveIds: string[] | Set<string>) => void;
}

export const useKanbanSelection = create<KanbanSelectionState>((set, get) => ({
  selected: new Set(),
  anchorId: null,
  projectId: null,

  toggle: (taskId) => set((state) => {
    const next = new Set(state.selected);
    if (next.has(taskId)) next.delete(taskId);
    else next.add(taskId);
    return { selected: next, anchorId: taskId };
  }),

  clear: () => set({ selected: new Set(), anchorId: null }),

  clearAnchor: () => set((state) => state.anchorId == null ? state : { ...state, anchorId: null }),

  setProjectScope: (projectId) => set((state) => {
    if (state.projectId === projectId) return state;
    // Different project — wipe selection so a stale id from elsewhere can't
    // sneak into a bulk PATCH. The earlier project's anchor is irrelevant
    // too.
    return { selected: new Set(), anchorId: null, projectId };
  }),

  setAll: (taskIds) => set({ selected: new Set(taskIds), anchorId: taskIds[taskIds.length - 1] ?? null }),

  selectMany: (taskIds) => set((state) => {
    if (taskIds.length === 0) return state;
    const next = new Set(state.selected);
    for (const id of taskIds) next.add(id);
    return { selected: next, anchorId: taskIds[taskIds.length - 1] };
  }),

  deselectMany: (taskIds) => set((state) => {
    if (taskIds.length === 0 || state.selected.size === 0) return state;
    const next = new Set(state.selected);
    for (const id of taskIds) next.delete(id);
    return { selected: next, anchorId: state.anchorId && next.has(state.anchorId) ? state.anchorId : null };
  }),

  /**
   * Drop ids that are no longer in the live task list. Called by the board
   * after a bulk delete or any mutation that may have made selected ids
   * stale (kanban follow-up #24). Without this, a deleted task's id would
   * remain in the set and the next bulk action would fail with "Task not
   * found" for that id, plus the count badge would lie.
   */
  pruneStale: (liveIds) => set((state) => {
    const live = liveIds instanceof Set ? liveIds : new Set(liveIds);
    if (state.selected.size === 0 && state.anchorId == null) return state;
    let changed = false;
    const next = new Set<string>();
    for (const id of state.selected) {
      if (live.has(id)) next.add(id);
      else changed = true;
    }
    const anchorOk = state.anchorId == null || live.has(state.anchorId);
    if (!changed && anchorOk) return state;
    return { selected: next, anchorId: anchorOk ? state.anchorId : null };
  }),

  toggleRange: (taskId, visibleOrder) => {
    const state = get();
    if (!state.anchorId || !visibleOrder.includes(state.anchorId)) {
      // No anchor — degrade to single toggle. Same UX as Cmd-click.
      state.toggle(taskId);
      return;
    }
    const a = visibleOrder.indexOf(state.anchorId);
    const b = visibleOrder.indexOf(taskId);
    if (a < 0 || b < 0) {
      state.toggle(taskId);
      return;
    }
    const [from, to] = a < b ? [a, b] : [b, a];
    const next = new Set(state.selected);
    for (let i = from; i <= to; i++) next.add(visibleOrder[i]);
    set({ selected: next, anchorId: taskId });
  },
}));
