import { useQuery } from '@tanstack/react-query';
import { getRecentProgress } from '@/api/recentProgress';

/**
 * "Shipped this week" — top-N client-visible tasks recently completed.
 * 5-minute staleTime — the underlying window is "last 7 days" so the
 * data only meaningfully changes when a task transitions to DONE; no
 * need to refetch on every tab focus.
 */
export function useRecentProgress(
  projectId: string,
  opts?: { days?: number; limit?: number },
) {
  const days = opts?.days ?? 7;
  const limit = opts?.limit ?? 3;
  return useQuery({
    queryKey: ['recent-progress', projectId, days, limit],
    queryFn: () => getRecentProgress(projectId, { days, limit }),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  });
}
