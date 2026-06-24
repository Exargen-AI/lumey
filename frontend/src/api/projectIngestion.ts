import api from './client';

export interface ParsedTask {
  hash: string;
  title: string;
  description: string | null;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  storyPoints: number | null;
  taskType: 'FEATURE' | 'BUG' | 'CHORE' | 'SPIKE';
  assigneeName: string | null;
  dueDate: string | null;
  labels: string[];
  acceptanceCriteria: { id?: string; text: string; done: boolean }[];
  subtasks: { id?: string; text: string; done: boolean }[];
}

export interface ParsedSprint {
  hash: string;
  name: string;
  goal: string | null;
  startDate: string;
  endDate: string;
  tasks: ParsedTask[];
}

export interface ParsedEpic {
  hash: string;
  title: string;
  description: string | null;
  color: string | null;
  sprints: ParsedSprint[];
  backlogTasks: ParsedTask[];
}

export interface ParsedPlan {
  projectName: string | null;
  projectDescription: string | null;
  epics: ParsedEpic[];
  rootBacklogTasks: ParsedTask[];
  warnings: string[];
}

export interface IngestionReport {
  created: { epics: number; sprints: number; tasks: number };
  skippedExisting: { epics: number; sprints: number; tasks: number };
  warnings: string[];
}

export type ParseMode = 'regex' | 'llm';

export interface ParsePlanMeta {
  mode: ParseMode;
  model?: string;
  provider?: string;
  durationMs?: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    estimatedCostUsd: number;
  };
}

export interface ParsePlanResponse {
  plan: ParsedPlan;
  meta: ParsePlanMeta;
}

export async function parsePlan(
  projectId: string,
  markdown: string,
  mode: ParseMode = 'regex',
): Promise<ParsePlanResponse> {
  const { data } = await api.post(`/projects/${projectId}/ingest/parse`, { markdown, mode });
  return { plan: data.data, meta: data.meta ?? { mode } };
}

export interface SmartParseStatus {
  enabled: boolean;
  model: string;
  provider: string;
}

export async function getSmartParseStatus(): Promise<SmartParseStatus> {
  const { data } = await api.get(`/ingest/smart-parse-status`);
  return data.data;
}

export async function commitPlan(
  projectId: string,
  plan: ParsedPlan,
  updateProjectMeta = false,
): Promise<IngestionReport> {
  const { data } = await api.post(`/projects/${projectId}/ingest/commit`, { plan, updateProjectMeta });
  return data.data;
}
