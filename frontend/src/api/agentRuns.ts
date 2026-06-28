import api from './client';

export type RunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'PAUSED'
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

/** Suspend a running run in place (transcript kept alive); resume continues it. */
export async function pauseTaskRun(taskId: string, runId: string): Promise<{ id: string }> {
  const { data } = await api.post(`/tasks/${taskId}/runs/${runId}/pause`, {});
  return data.data;
}

/** Continue a paused run from where it parked. */
export async function resumeTaskRun(taskId: string, runId: string): Promise<{ id: string }> {
  const { data } = await api.post(`/tasks/${taskId}/runs/${runId}/resume`, {});
  return data.data;
}

/**
 * Mint a single-use ticket to open the live SSE trace. A browser `EventSource`
 * can't send the Bearer header, so we authenticate here (via the axios client)
 * and hand the resulting short-lived ticket to the stream URL. See the backend
 * `runStream/` module.
 */
export async function requestRunStreamTicket(taskId: string, runId: string): Promise<{ ticket: string; expiresInMs: number }> {
  const { data } = await api.post(`/tasks/${taskId}/runs/${runId}/stream-ticket`, {});
  return data.data;
}
