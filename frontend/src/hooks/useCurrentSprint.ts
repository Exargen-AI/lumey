import { useQuery } from '@tanstack/react-query';
import { getCurrentSprint } from '@/api/currentSprint';

/**
 * Active sprint snapshot for a project. 2-min staleTime — sprint stats
 * (tasks done, story points done) change as the team works, but no need
 * for sub-minute refetching on a client-facing page.
 */
export function useCurrentSprint(projectId: string) {
  return useQuery({
    queryKey: ['current-sprint', projectId],
    queryFn: () => getCurrentSprint(projectId),
    enabled: !!projectId,
    staleTime: 2 * 60 * 1000,
  });
}
