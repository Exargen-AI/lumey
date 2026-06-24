import api from './client';

export async function getProjectSprints(projectId: string) {
  const { data } = await api.get(`/projects/${projectId}/sprints`);
  return data.data;
}

export async function createSprint(projectId: string, input: { name: string; goal?: string; startDate: string; endDate: string }) {
  const { data } = await api.post(`/projects/${projectId}/sprints`, input);
  return data.data;
}

export async function getSprintDetail(sprintId: string) {
  const { data } = await api.get(`/sprints/${sprintId}`);
  return data.data;
}

export async function getActiveSprint(projectId: string) {
  const { data } = await api.get(`/projects/${projectId}/sprints/active`);
  return data.data;
}

export async function updateSprint(sprintId: string, input: any) {
  const { data } = await api.put(`/sprints/${sprintId}`, input);
  return data.data;
}

export async function startSprint(projectId: string, sprintId: string) {
  const { data } = await api.post(`/projects/${projectId}/sprints/${sprintId}/start`);
  return data.data;
}

export interface CompleteSprintInput {
  retro?: { wentWell?: string; didntGoWell?: string; actionItems?: string };
  carryOver?: 'all' | 'none' | 'selected';
  carryOverTaskIds?: string[];
  carryOverToSprintId?: string | null;
}

/**
 * Delete a sprint. Backend refuses if the sprint is ACTIVE or COMPLETED
 * (use completeSprint with carryOver: 'all' to drain ACTIVE first).
 * Returns `{ unparkedTasks: number }` — how many tasks the deletion sent
 * back to the backlog.
 */
export async function deleteSprint(sprintId: string): Promise<{ message: string; unparkedTasks: number }> {
  const { data } = await api.delete(`/sprints/${sprintId}`);
  return data.data;
}

export async function completeSprint(sprintId: string, input: CompleteSprintInput | boolean = true) {
  // Legacy callers pass a boolean (moveToBacklog). Translate to the v2 shape
  // so we can keep them working until they migrate.
  const body: any = typeof input === 'boolean'
    ? { moveToBacklog: input }
    : input;
  const { data } = await api.post(`/sprints/${sprintId}/complete`, body);
  return data.data;
}

export interface SprintBurnup {
  sprintId: string;
  sprintName: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  totalScope: number;
  series: Array<{
    date: string;
    completedPoints: number;
    remainingPoints: number;
    scopePoints: number;
    idealRemaining: number;
  }>;
}

export async function getSprintBurnup(sprintId: string): Promise<SprintBurnup> {
  const { data } = await api.get(`/sprints/${sprintId}/burnup`);
  return data.data;
}

export async function getBacklog(projectId: string) {
  const { data } = await api.get(`/projects/${projectId}/backlog`);
  return data.data;
}

export async function assignTaskToSprint(taskId: string, sprintId: string | null) {
  const { data } = await api.patch(`/tasks/${taskId}/sprint`, { sprintId });
  return data.data;
}

export async function getProjectEpics(projectId: string) {
  const { data } = await api.get(`/projects/${projectId}/epics`);
  return data.data;
}

export async function createEpic(projectId: string, input: { title: string; description?: string; color?: string }) {
  const { data } = await api.post(`/projects/${projectId}/epics`, input);
  return data.data;
}

export async function updateEpic(epicId: string, input: any) {
  const { data } = await api.put(`/epics/${epicId}`, input);
  return data.data;
}

export async function deleteEpic(epicId: string) {
  const { data } = await api.delete(`/epics/${epicId}`);
  return data.data;
}

export interface EpicSummary {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  color: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'DONE';
  createdAt: string;
  updatedAt: string;
  totalTasks: number;
  doneTasks: number;
  totalPoints: number;
  donePoints: number;
  progressPct: number;
}

export interface EpicDetail extends EpicSummary {
  tasks: Array<{
    id: string;
    taskNumber: number;
    title: string;
    status: 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE';
    priority: 'P0' | 'P1' | 'P2' | 'P3';
    storyPoints: number | null;
    isBlocked: boolean;
    assignee: { id: string; name: string } | null;
    sprint: { id: string; name: string; status: string } | null;
  }>;
}

export async function getEpicDetail(epicId: string): Promise<EpicDetail> {
  const { data } = await api.get(`/epics/${epicId}`);
  return data.data;
}
