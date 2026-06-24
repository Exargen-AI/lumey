import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as taskApi from '@/api/tasks';

/**
 * Hooks for the CC subscriptions / nudge features shipped in
 * backend PR #130. Each hook invalidates the right query keys so
 * the UI converges after a mutation without manual refetches.
 *
 * Convention: `['task-subscribers', taskId]` is the query key for
 * the subscribers list — kept distinct from `['task', taskId]` so
 * a task fetch doesn't piggy-back the subscribers (the subscribers
 * panel is opt-in on the FE).
 */

export function useTaskSubscribers(taskId: string | null) {
  return useQuery({
    queryKey: ['task-subscribers', taskId],
    queryFn: () => taskApi.listTaskSubscribers(taskId!),
    enabled: !!taskId,
  });
}

export function useSubscribeToTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => taskApi.subscribeToTask(taskId),
    onSuccess: (_d, taskId) => {
      qc.invalidateQueries({ queryKey: ['task-subscribers', taskId] });
    },
  });
}

export function useUnsubscribeFromTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => taskApi.unsubscribeFromTask(taskId),
    onSuccess: (_d, taskId) => {
      qc.invalidateQueries({ queryKey: ['task-subscribers', taskId] });
    },
  });
}

/**
 * Send a nudge to the task's assignee. Backend enforces a 24h
 * cooldown per (task, sender); a 409 response carries the human-
 * readable "try again in N hours" message in the error body.
 * Callers should surface that to the user.
 */
export function useNudgeTask() {
  return useMutation({
    mutationFn: ({ taskId, message }: { taskId: string; message?: string }) =>
      taskApi.nudgeTask(taskId, message),
  });
}
