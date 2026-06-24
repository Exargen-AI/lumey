import api from './client';

export type RunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'AWAITING_REVIEW'
  | 'AWAITING_INPUT'
  | 'BLOCKED'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED';

export interface AgentRunSummary {
  id: string;
  taskId: string;
  agentId: string;
  status: RunStatus;
  model: string | null;
  summary: string | null;
  error: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

export interface RunStep {
  id: string;
  seq: number;
  type: string;
  status: string;
  title: string;
  detail: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface RunEvent {
  id: string;
  seq: number;
  type: string;
  payload: unknown;
  at: string;
}

export interface AgentRunDetail extends AgentRunSummary {
  steps: RunStep[];
  events: RunEvent[];
}

export async function listTaskRuns(taskId: string): Promise<AgentRunSummary[]> {
  const { data } = await api.get(`/tasks/${taskId}/runs`);
  return data.data;
}

export async function getTaskRun(taskId: string, runId: string): Promise<AgentRunDetail> {
  const { data } = await api.get(`/tasks/${taskId}/runs/${runId}`);
  return data.data;
}

export async function startTaskRun(taskId: string): Promise<AgentRunSummary> {
  const { data } = await api.post(`/tasks/${taskId}/runs`, {});
  return data.data;
}

export async function cancelTaskRun(taskId: string, runId: string): Promise<{ id: string }> {
  const { data } = await api.post(`/tasks/${taskId}/runs/${runId}/cancel`, {});
  return data.data;
}
