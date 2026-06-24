import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as linkApi from '@/api/taskLinks';

export function useTaskLinks(taskId: string | null | undefined) {
  return useQuery({
    queryKey: ['task-links', taskId],
    queryFn: () => linkApi.getTaskLinks(taskId!),
    enabled: !!taskId,
  });
}

export function useCreateTaskLink(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { targetTaskId: string; type: linkApi.TaskLinkType }) =>
      linkApi.createTaskLink(taskId, input),
    onSuccess: (_data, vars) => {
      // Both ends of the link have a refreshed view.
      qc.invalidateQueries({ queryKey: ['task-links', taskId] });
      qc.invalidateQueries({ queryKey: ['task-links', vars.targetTaskId] });
    },
  });
}

export function useDeleteTaskLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) => linkApi.deleteTaskLink(linkId),
    onSuccess: () => {
      // We don't know which two task IDs this link touched without an extra
      // round-trip; nuke the whole bucket — cheap enough.
      qc.invalidateQueries({ queryKey: ['task-links'] });
    },
  });
}

/**
 * Spin off a child task from a parent (typically a bug). The server
 * creates the new task + SPAWNED_FROM link atomically; on success we
 * refresh both the link bucket (so the parent's "Spawned tasks" group
 * picks up the new row) and every task list so the new task appears on
 * boards immediately.
 */
export function useSpawnSubtask(parentTaskId: string, projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: linkApi.SpawnSubtaskInput) => linkApi.spawnSubtask(parentTaskId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task-links', parentTaskId] });
      qc.invalidateQueries({ queryKey: ['task', parentTaskId] });
      qc.invalidateQueries({ queryKey: ['tasks', projectId] });
      qc.invalidateQueries({ queryKey: ['products', projectId] });
    },
  });
}
