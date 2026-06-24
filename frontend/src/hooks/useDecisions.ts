import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as decisionApi from '@/api/decisions';

export function useDecisions(projectId: string) {
  return useQuery({
    queryKey: ['decisions', projectId],
    queryFn: () => decisionApi.getDecisions(projectId),
    enabled: !!projectId,
    // A base client without per-project full access gets 403 here — a
    // permission error won't change on retry, so don't hammer it. Still
    // retry a transient 5xx once.
    retry: (failureCount, error: any) => {
      const status = error?.response?.status;
      if (typeof status === 'number' && status >= 400 && status < 500) return false;
      return failureCount < 1;
    },
  });
}

export function useCreateDecision(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => decisionApi.createDecision(projectId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['decisions', projectId] }),
  });
}

export function useUpdateDecision(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => decisionApi.updateDecision(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['decisions', projectId] }),
  });
}

export function useDeleteDecision(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: decisionApi.deleteDecision,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['decisions', projectId] }),
  });
}
