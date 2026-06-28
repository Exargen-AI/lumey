import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as runApi from '@/api/agentRuns';

export function useTaskRuns(taskId: string) {
  return useQuery({
    queryKey: ['task-runs', taskId],
    queryFn: () => runApi.listTaskRuns(taskId),
    enabled: !!taskId,
  });
}

export function useTaskRun(taskId: string, runId: string | null) {
  return useQuery({
    queryKey: ['task-run', taskId, runId],
    queryFn: () => runApi.getTaskRun(taskId, runId as string),
    enabled: !!taskId && !!runId,
  });
}

export function useStartTaskRun(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => runApi.startTaskRun(taskId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task-runs', taskId] }),
  });
}

export function useCancelTaskRun(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => runApi.cancelTaskRun(taskId, runId),
    onSuccess: (_data, runId) => {
      qc.invalidateQueries({ queryKey: ['task-runs', taskId] });
      qc.invalidateQueries({ queryKey: ['task-run', taskId, runId] });
    },
  });
}

export function usePauseTaskRun(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => runApi.pauseTaskRun(taskId, runId),
    onSuccess: (_data, runId) => {
      qc.invalidateQueries({ queryKey: ['task-runs', taskId] });
      qc.invalidateQueries({ queryKey: ['task-run', taskId, runId] });
    },
  });
}

export function useResumeTaskRun(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => runApi.resumeTaskRun(taskId, runId),
    onSuccess: (_data, runId) => {
      qc.invalidateQueries({ queryKey: ['task-runs', taskId] });
      qc.invalidateQueries({ queryKey: ['task-run', taskId, runId] });
    },
  });
}
