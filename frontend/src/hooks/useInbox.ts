import { useQuery } from '@tanstack/react-query';
import { listInbox } from '@/api/inbox';

/**
 * The HITL inbox — every run waiting on a human across all tasks. Polls so a
 * newly-parked run shows up without a manual refresh (the per-run SSE stream
 * only covers an open task card; the inbox is the cross-task view).
 */
export function useInbox() {
  return useQuery({
    queryKey: ['inbox'],
    queryFn: listInbox,
    refetchInterval: 15_000,
  });
}
