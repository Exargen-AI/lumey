import { useQuery } from '@tanstack/react-query';
import { getActivityFeed, type ActivityFeedParams } from '@/api/today';

/**
 * Combined "what's happening" feed — today + this-week sections in one
 * round-trip. Refetches lightly (every 60s while the tab is active) so
 * a teammate's freshly-shipped task or a freshly-touched in-focus card
 * appears without a manual reload.
 */
export function useActivityFeed(params: ActivityFeedParams = {}) {
  return useQuery({
    queryKey: ['activity-feed', params.date ?? null, params.mine ?? false, params.projectId ?? null],
    queryFn: () => getActivityFeed(params),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

/** @deprecated alias kept for transitional imports — use `useActivityFeed`. */
export const useToday = useActivityFeed;
