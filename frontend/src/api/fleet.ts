import api from './client';
import type { RunStatus } from './agentRuns';

export interface FleetOverview {
  totals: { total: number; active: number; succeeded: number; failed: number };
  tokens: number;
  byStatus: { status: RunStatus; count: number }[];
  last24h: { runs: number; tokens: number };
  agents: { agentId: string; name: string; runs: number; active: number; failed: number; tokens: number }[];
}

export interface FleetRun {
  id: string;
  status: RunStatus;
  model: string | null;
  totalTokens: number;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  task: { id: string; title: string; taskNumber: number; projectId: string; projectName: string };
  agent: { id: string; name: string };
}

/** Fleet rollup: lifecycle distribution, 24h throughput, per-agent work. */
export async function getFleetOverview(): Promise<FleetOverview> {
  const { data } = await api.get('/fleet/overview');
  return data.data;
}

/** Recent runs across the visible fleet, newest first; optional status filter. */
export async function listFleetRuns(status?: RunStatus): Promise<FleetRun[]> {
  const { data } = await api.get('/fleet/runs', { params: status ? { status } : {} });
  return data.data;
}
