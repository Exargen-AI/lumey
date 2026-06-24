import { useQuery } from '@tanstack/react-query';
import { getClientActions } from '@/api/clientActions';

/**
 * Items currently waiting on the client (deliverables to sign off + open
 * decisions). 2-minute staleTime — short enough that a client who just
 * acted on something sees the callout update on their next page hop;
 * long enough that idle tabs don't refetch every render.
 */
export function useClientActions(projectId: string) {
  return useQuery({
    queryKey: ['client-actions', projectId],
    queryFn: () => getClientActions(projectId),
    enabled: !!projectId,
    staleTime: 2 * 60 * 1000,
  });
}
