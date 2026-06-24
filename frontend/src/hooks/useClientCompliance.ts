import { useQuery } from '@tanstack/react-query';
import { getProjectCompliance } from '@/api/clientCompliance';

/**
 * Compliance summary for a single project — who's on the team and what
 * agreements each has signed. Used by both the client-facing section
 * page and (potentially) the admin's own per-project trust view.
 */
export function useProjectCompliance(projectId: string) {
  return useQuery({
    queryKey: ['client-compliance', projectId],
    queryFn: () => getProjectCompliance(projectId),
    enabled: !!projectId,
    // Compliance changes are rare. A 5-minute window is generous; the
    // user can always force a refetch by navigating away and back.
    staleTime: 5 * 60_000,
  });
}
