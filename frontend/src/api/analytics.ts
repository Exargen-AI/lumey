import api from './client';

export async function getPortfolioAnalytics() {
  const { data } = await api.get('/analytics/portfolio');
  return data.data;
}

export async function getProjectAnalytics(id: string) {
  const { data } = await api.get(`/analytics/projects/${id}`);
  return data.data;
}

export async function getTeamUtilization() {
  const { data } = await api.get('/analytics/team');
  return data.data;
}

export async function getVelocityData(weeks?: number) {
  const { data } = await api.get('/analytics/velocity', { params: { weeks } });
  return data.data;
}

export async function getBlockerAging() {
  const { data } = await api.get('/analytics/blockers');
  return data.data;
}

export async function getTaskDistribution() {
  const { data } = await api.get('/analytics/task-distribution');
  return data.data;
}

/* ─────────────────────────────────────────────────────────────────────────────
   Studio Portfolio Home — fetchers for the four bands on /dashboard.
   ───────────────────────────────────────────────────────────────────────────── */

export interface ProductHealthCard {
  id: string;
  name: string;
  slug: string;
  category: string;
  phase: string;
  healthStatus: 'GREEN' | 'YELLOW' | 'RED';
  lead: { id: string; name: string } | null;
  currentSprint: {
    id: string; name: string; number: number; goal: string | null;
    startDate: string; endDate: string;
    tasksTotal: number; tasksDone: number; tasksInProgress: number;
    pointsTotal: number; pointsDone: number;
  } | null;
  blockedCount: number;
  velocity: number[];
}

export interface ActiveStreamTask {
  id: string;
  taskNumber: number;
  title: string;
  status: 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW';
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  isBlocked: boolean;
  storyPoints: number | null;
  project: { id: string; name: string; slug: string; category: string };
  sprint: { id: string; name: string; goal: string | null } | null;
  assignee: { id: string; name: string } | null;
}

export interface CapacitySnapshot {
  perProject: Array<{
    projectId: string; projectName: string; category: string; sprintName: string;
    plannedPoints: number; completedPoints: number;
  }>;
  totalPlanned: number;
  totalCompleted: number;
}

export type AttentionKind =
  | 'BLOCKED_AGING'
  | 'UNASSIGNED_IN_SPRINT'
  | 'MISSING_EOD'
  | 'RECENT_BUG'
  | 'EPIC_LESS_IN_SPRINT';

export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  severity: 'high' | 'medium' | 'low';
  message: string;
  context: Record<string, unknown>;
  action: { label: string; href?: string };
}

export async function getPortfolioGrid(): Promise<ProductHealthCard[]> {
  const { data } = await api.get('/analytics/portfolio-grid');
  return data.data;
}

export async function getActiveSprintStream(): Promise<ActiveStreamTask[]> {
  const { data } = await api.get('/analytics/active-stream');
  return data.data;
}

export async function getCapacitySnapshot(): Promise<CapacitySnapshot> {
  const { data } = await api.get('/analytics/capacity');
  return data.data;
}

export async function getAttentionItems(): Promise<AttentionItem[]> {
  const { data } = await api.get('/analytics/attention');
  return data.data;
}
