import { useQuery } from '@tanstack/react-query';
import { getFleetOverview, listFleetRuns } from '@/api/fleet';
import type { RunStatus } from '@/api/agentRuns';

/** Fleet rollup, polled so the console stays roughly live without SSE. */
export function useFleetOverview() {
  return useQuery({ queryKey: ['fleet-overview'], queryFn: getFleetOverview, refetchInterval: 10_000 });
}

export function useFleetRuns(status?: RunStatus) {
  return useQuery({ queryKey: ['fleet-runs', status ?? 'all'], queryFn: () => listFleetRuns(status), refetchInterval: 10_000 });
}
