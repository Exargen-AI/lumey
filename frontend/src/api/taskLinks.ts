import api from './client';

// SPAWNED_FROM is the parent/child kind used by the bug spin-off flow.
// The picker UI doesn't surface it directly — the dedicated "Spin off
// task" action creates the new task + the link in one transaction.
export type TaskLinkType = 'BLOCKS' | 'RELATES_TO' | 'DUPLICATES' | 'SPAWNED_FROM';

export interface LinkedTaskSummary {
  linkId: string;
  taskId: string;
  taskNumber: number;
  title: string;
  status: string;
  priority: string;
  isBlocked: boolean;
  project: { id: string; slug: string; name: string };
}

export interface TaskLinks {
  blocks: LinkedTaskSummary[];
  blockedBy: LinkedTaskSummary[];
  relatesTo: LinkedTaskSummary[];
  duplicates: LinkedTaskSummary[];
  duplicatedBy: LinkedTaskSummary[];
  // SPAWNED_FROM groups (PR C feature #7):
  //   - spawnedFrom: the parent this task was spun off from (typically a bug)
  //   - spawned:     the child tasks spun off from this one
  spawnedFrom: LinkedTaskSummary[];
  spawned:     LinkedTaskSummary[];
}

export interface SpawnSubtaskInput {
  title: string;
  description?: string | null;
  taskType?: 'FEATURE' | 'BUG' | 'CHORE' | 'SPIKE';
}

export async function spawnSubtask(parentTaskId: string, input: SpawnSubtaskInput) {
  const { data } = await api.post(`/tasks/${parentTaskId}/spawn`, input);
  return data.data;
}

export interface TaskLinkSearchResult {
  id: string;
  taskNumber: number;
  title: string;
  status: string;
  priority: string;
}

export async function getTaskLinks(taskId: string): Promise<TaskLinks> {
  const { data } = await api.get(`/tasks/${taskId}/links`);
  return data.data;
}

export async function createTaskLink(
  taskId: string,
  input: { targetTaskId: string; type: TaskLinkType },
) {
  const { data } = await api.post(`/tasks/${taskId}/links`, input);
  return data.data;
}

export async function deleteTaskLink(linkId: string) {
  const { data } = await api.delete(`/links/${linkId}`);
  return data.data;
}

export async function searchTasksForLinking(
  projectId: string,
  query: string,
  excludeTaskId: string,
): Promise<TaskLinkSearchResult[]> {
  const { data } = await api.get(`/projects/${projectId}/task-link-search`, {
    params: { q: query, exclude: excludeTaskId },
  });
  return data.data;
}
