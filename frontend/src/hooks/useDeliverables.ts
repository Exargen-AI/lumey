import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '@/api/deliverables';

export function useDeliverables(projectId: string) {
  return useQuery({
    queryKey: ['deliverables', projectId],
    queryFn: () => api.getDeliverables(projectId),
    enabled: !!projectId,
  });
}

export function useCreateDeliverable(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: any) => api.createDeliverable(projectId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deliverables', projectId] });
      qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useUpdateDeliverable(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.updateDeliverable(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deliverables', projectId] });
      qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useDeleteDeliverable(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteDeliverable(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deliverables', projectId] });
      qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useMarkDelivered(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.markDelivered(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deliverables', projectId] });
      qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}

export function useSignOffDeliverable(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.signOffDeliverable(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['deliverables', projectId] });
      qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}
