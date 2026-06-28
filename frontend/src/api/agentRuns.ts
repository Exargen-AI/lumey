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

export type ClarificationStatus = 'PENDING' | 'ANSWERED' | 'CANCELLED';

/** A question the agent raised mid-run for a human to answer (HITL). */
export interface RunClarification {
  id: string;
  runId: string;
  question: string;
  answer: string | null;
  status: ClarificationStatus;
  askedAt: string;
  answeredAt: string | null;
  answeredById: string | null;
}

/** The agent's questions on a run (oldest first). */
export async function listRunClarifications(taskId: string, runId: string): Promise<RunClarification[]> {
  const { data } = await api.get(`/tasks/${taskId}/runs/${runId}/clarifications`);
  return data.data;
}

/** Answer an agent's question; the parked run resumes with it. */
export async function answerClarification(
  taskId: string,
  runId: string,
  clarificationId: string,
  answer: string,
): Promise<{ id: string }> {
  const { data } = await api.post(
    `/tasks/${taskId}/runs/${runId}/clarifications/${clarificationId}/answer`,
    { answer },
  );
  return data.data;
}

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

/** A human checkpoint the agent must clear before a high-risk action (HITL). */
export interface RunApproval {
  id: string;
  runId: string;
  action: string;
  summary: string;
  detail: string | null;
  status: ApprovalStatus;
  reason: string | null;
  requestedAt: string;
  decidedAt: string | null;
  decidedById: string | null;
}

/** The agent's approval checkpoints on a run (oldest first). */
export async function listRunApprovals(taskId: string, runId: string): Promise<RunApproval[]> {
  const { data } = await api.get(`/tasks/${taskId}/runs/${runId}/approvals`);
  return data.data;
}

/** Approve or reject a gated action; the parked run resumes with the decision. */
export async function decideRunApproval(
  taskId: string,
  runId: string,
  approvalId: string,
  approved: boolean,
  reason?: string,
): Promise<{ id: string }> {
  const verb = approved ? 'approve' : 'reject';
  const { data } = await api.post(
    `/tasks/${taskId}/runs/${runId}/approvals/${approvalId}/${verb}`,
    reason ? { reason } : {},
  );
  return data.data;
}

// ─── SDLC graph (commits → PR → checks) ───

export type PrState = 'OPEN' | 'MERGED' | 'CLOSED';
export type CheckStatus = 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED';
export type CheckConclusion =
  | 'SUCCESS' | 'FAILURE' | 'NEUTRAL' | 'CANCELLED' | 'TIMED_OUT' | 'ACTION_REQUIRED' | 'SKIPPED' | 'STALE';

export interface RunCommit {
  id: string;
  sha: string;
  message: string;
  branch: string;
  committedAt: string;
}

export interface RunPullRequest {
  id: string;
  externalId: string;
  number: number | null;
  url: string;
  title: string;
  branch: string;
  baseBranch: string;
  state: PrState;
  openedAt: string;
  mergedAt: string | null;
  closedAt: string | null;
}

export interface RunCheck {
  id: string;
  externalId: string;
  name: string;
  status: CheckStatus;
  conclusion: CheckConclusion | null;
  url: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface RunSdlc {
  commits: RunCommit[];
  pullRequest: RunPullRequest | null;
  checks: RunCheck[];
}

/** The run's delivery chain: the commits it made, the PR it opened, its CI checks. */
export async function getRunSdlc(taskId: string, runId: string): Promise<RunSdlc> {
  const { data } = await api.get(`/tasks/${taskId}/runs/${runId}/sdlc`);
  return data.data;
}

// ─── Run receipt (governance) ───

export interface RunReceiptContent {
  version: number;
  run: { id: string; taskId: string; agentId: string; model: string | null };
  outcome: { status: RunStatus; summary: string | null };
  timing: { startedAt: string | null; endedAt: string | null; durationMs: number | null };
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  work: {
    steps: number;
    stepTypes: Record<string, number>;
    commits: number;
    pullRequest: { externalId: string; number: number | null; url: string; state: PrState } | null;
    checks: { total: number; passed: number; failed: number };
  };
}

export interface RunReceipt {
  id: string;
  runId: string;
  digest: string;
  algo: string;
  issuedAt: string;
  /** Recomputed-digest check — false means the stored snapshot was altered. */
  verified: boolean;
  content: RunReceiptContent;
}

/** The run's tamper-evident governance record, or null until it first rests. */
export async function getRunReceipt(taskId: string, runId: string): Promise<RunReceipt | null> {
  const { data } = await api.get(`/tasks/${taskId}/runs/${runId}/receipt`);
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
