import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import * as taskApi from '@/api/tasks';

export function useTasks(projectId: string, params?: Record<string, string>) {
  return useQuery({ queryKey: ['tasks', projectId, params], queryFn: () => taskApi.getTasks(projectId, params), enabled: !!projectId });
}

/**
 * Paginated task list for the kanban board. Backend has no hard cap on
 * project size, so for projects with hundreds-to-thousands of tasks we
 * fetch in pages of `pageSize` (default 200) and let react-query stitch
 * them together via `useInfiniteQuery`. The kanban renders the flattened
 * list exactly like before — only the loading behaviour changes.
 *
 * A page that returns fewer rows than requested is treated as the last
 * page (cursor goes null), so the "Load more" affordance disappears once
 * the whole project has been pulled in.
 *
 * The query key intentionally includes `params` so a productId scope or
 * search filter gets its own paginated stream — switching filters
 * resets the cursor instead of mixing pages across filters.
 */
export function useTasksInfinite(
  projectId: string,
  params?: Record<string, string>,
  pageSize: number = 200,
) {
  return useInfiniteQuery({
    queryKey: ['tasks-infinite', projectId, params, pageSize],
    enabled: !!projectId,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      taskApi.getTasks(projectId, {
        ...(params ?? {}),
        limit: String(pageSize),
        offset: String(pageParam ?? 0),
      }),
    getNextPageParam: (lastPage: any[], allPages) => {
      // If the last page came back short, we're done — no next cursor.
      if (!Array.isArray(lastPage) || lastPage.length < pageSize) return undefined;
      return allPages.reduce((acc, p) => acc + (p?.length ?? 0), 0);
    },
  });
}

/**
 * Per-status totals (across all pages). Cheap groupBy on the server —
 * one round trip even on huge projects. Used by the kanban column
 * header pill ("BACKLOG 423") and the BoardPage status strip so the
 * counts reflect reality, not just what's been paged into the UI.
 */
export function useTaskCounts(projectId: string, params?: Record<string, string>) {
  return useQuery({
    queryKey: ['task-counts', projectId, params],
    queryFn: () => taskApi.getTaskCounts(projectId, params),
    enabled: !!projectId,
  });
}

/**
 * Lazy id-list for "Select all in column" — fired only when the user
 * actually clicks the column-header checkbox. We want the affordance to
 * cover every task in the column, including ones the user hasn't paged
 * to yet, so this returns the flat id list straight from the server.
 *
 * Disabled by default; the caller passes `enabled: true` when the user
 * triggers select-all, then feeds the result into the selection store.
 */
export function useColumnTaskIds(
  projectId: string,
  status: string,
  params: Record<string, string> | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['task-ids', projectId, status, params],
    queryFn: () => taskApi.getTaskIds(projectId, { ...(params ?? {}), status }),
    enabled: !!projectId && !!status && enabled,
    staleTime: 5_000, // brief — long enough to batch a click, short enough that a moved task isn't stale
  });
}

export function useTask(id: string) {
  return useQuery({
    queryKey: ['task', id],
    queryFn: () => taskApi.getTask(id),
    enabled: !!id,
    // Don't retry 401/403/404 — those are deterministic ("not allowed",
    // "doesn't exist"), retrying delays the UI showing the right error
    // state. Retry once on 5xx since those CAN be transient.
    retry: (failureCount, err: any) => {
      const status = err?.response?.status;
      if (status === 401 || status === 403 || status === 404) return false;
      return failureCount < 1;
    },
  });
}

export function useCreateTask(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => taskApi.createTask(projectId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks', projectId] });
      qc.invalidateQueries({ queryKey: ['tasks-infinite', projectId] });
      qc.invalidateQueries({ queryKey: ['task-counts', projectId] });
    },
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => taskApi.updateTask(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['tasks-infinite'] });
      qc.invalidateQueries({ queryKey: ['task-counts'] });
      qc.invalidateQueries({ queryKey: ['task'] });
    },
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: taskApi.deleteTask,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['tasks-infinite'] });
      qc.invalidateQueries({ queryKey: ['task-counts'] });
    },
  });
}

export function useMoveTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, sortOrder, expectedUpdatedAt }: { id: string; status: string; sortOrder?: number; expectedUpdatedAt?: string }) =>
      taskApi.moveTask(id, status, sortOrder, expectedUpdatedAt),
    // Optimistic update: patch every cached `tasks` query so the card jumps
    // to its new column the moment the user drops, not after the server
    // roundtrip + refetch (which on a 360-task board adds 200-700ms of lag
    // and "snapback" before the card lands in the right place). Mirrors
    // React Query's documented optimistic-mutation pattern.
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ['tasks'] });
      await qc.cancelQueries({ queryKey: ['tasks-infinite'] });
      const snapshot = qc.getQueriesData<any[]>({ queryKey: ['tasks'] });
      const infiniteSnapshot = qc.getQueriesData<any>({ queryKey: ['tasks-infinite'] });
      qc.setQueriesData<any[]>({ queryKey: ['tasks'] }, (old) => {
        if (!Array.isArray(old)) return old;
        return old.map((t: any) =>
          t?.id === vars.id
            ? { ...t, status: vars.status, sortOrder: vars.sortOrder ?? t.sortOrder }
            : t,
        );
      });
      // Same patch into the kanban's `useInfiniteQuery` cache — the shape is
      // `{ pages: any[][], pageParams: any[] }`, so we map across pages.
      qc.setQueriesData<any>({ queryKey: ['tasks-infinite'] }, (old: any) => {
        if (!old || !Array.isArray(old.pages)) return old;
        return {
          ...old,
          pages: old.pages.map((page: any[]) =>
            Array.isArray(page)
              ? page.map((t: any) =>
                  t?.id === vars.id
                    ? { ...t, status: vars.status, sortOrder: vars.sortOrder ?? t.sortOrder }
                    : t,
                )
              : page,
          ),
        };
      });
      return { snapshot, infiniteSnapshot };
    },
    onError: (_err, _vars, ctx) => {
      // Server rejected the move — roll back every cache we patched so the
      // card returns to its old column rather than getting stuck in limbo.
      if (ctx?.snapshot) {
        for (const [key, data] of ctx.snapshot) qc.setQueryData(key, data);
      }
      if (ctx?.infiniteSnapshot) {
        for (const [key, data] of ctx.infiniteSnapshot) qc.setQueryData(key, data);
      }
    },
    // Always reconcile with the server's truth after the move settles — the
    // optimistic patch only adjusts status/sortOrder, but server-side moves
    // can also bump updatedAt, recompute aggregates on the parent sprint,
    // etc. Skip refetching active queries while a fresh drag is in flight
    // to avoid the cancellation-flicker pattern.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['tasks-infinite'] });
      // Status totals shift on every move, so invalidate the counts cache
      // too — the column header pill and the BoardPage strip both read it.
      qc.invalidateQueries({ queryKey: ['task-counts'] });
    },
  });
}

export function useMyTasks() {
  return useQuery({ queryKey: ['my-tasks'], queryFn: taskApi.getMyTasks });
}

export function useUpdateSubtasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, items }: { taskId: string; items: taskApi.ChecklistItem[] }) =>
      taskApi.updateSubtasks(taskId, items),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['task', vars.taskId] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

export function useUpdateAcceptanceCriteria() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, items }: { taskId: string; items: taskApi.ChecklistItem[] }) =>
      taskApi.updateAcceptanceCriteria(taskId, items),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['task', vars.taskId] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

/* ─── Review workflow ───────────────────────────────────────────────
 *
 * Both mutations invalidate the same query set as moveTask — the task
 * detail (re-render the slide-over with the new reviewer panel) plus
 * the board (so the kanban card moves between columns + picks up the
 * reviewer badge). My-tasks gets invalidated too because an Approve
 * may have ticked one of the user's assigned tasks off into Done.
 */
export function useRequestReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, reviewerId, note }: { taskId: string; reviewerId: string; note?: string }) =>
      taskApi.requestReview(taskId, reviewerId, note),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['task', vars.taskId] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['my-tasks'] });
      qc.invalidateQueries({ queryKey: ['comments'] });
    },
  });
}

export function useDecideReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, decision, comment }: { taskId: string; decision: taskApi.ReviewDecision; comment?: string }) =>
      taskApi.decideReview(taskId, decision, comment),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['task', vars.taskId] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['my-tasks'] });
      qc.invalidateQueries({ queryKey: ['today'] });   // Approve → Done counts toward "done today"
      qc.invalidateQueries({ queryKey: ['comments'] });
    },
  });
}
