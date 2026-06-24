import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '@/api/projectAcknowledgment';

export function useMyAcknowledgment(projectId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['project-acknowledgment', projectId],
    queryFn: () => api.getMyAcknowledgment(projectId!),
    // SUPER_ADMIN bypasses the gate entirely (they're the owner — see
    // ProjectAcknowledgmentGate), so the caller passes enabled=false and
    // we skip the network round-trip.
    enabled: !!projectId && enabled,
    // Once we know the answer, no need to re-fetch on focus — acknowledgment status
    // doesn't change without a user action that we already invalidate on.
    staleTime: 5 * 60 * 1000,
  });
}

export function useAcknowledgeProject(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.acknowledgeProject(projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-acknowledgment', projectId] });
      qc.invalidateQueries({ queryKey: ['activities'] });
    },
  });
}
