import { useQuery } from '@tanstack/react-query';
import { getProjectForecast } from '@/api/projectForecast';

/**
 * Fetch the project's delivery forecast. The endpoint is cheap (two
 * indexed reads) so we let React Query handle caching with a 5-minute
 * stale window — long enough that a client flipping between projects
 * doesn't re-request, short enough that an in-page refresh always
 * reflects the day's data.
 */
export function useProjectForecast(projectId: string) {
  return useQuery({
    queryKey: ['project-forecast', projectId],
    queryFn: () => getProjectForecast(projectId),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  });
}
