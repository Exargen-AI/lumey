import api from './client';

export type SprintPace = 'ON_PACE' | 'BEHIND' | 'OFF_PACE' | 'TOO_EARLY';

export interface CurrentSprintSnapshot {
  sprintId: string;
  name: string;
  goal: string | null;
  startDate: string;
  endDate: string;
  daysElapsed: number;
  totalDays: number;
  timeElapsedPct: number;
  isOverdue: boolean;
  tasksTotal: number;
  tasksDone: number;
  pointsTotal: number;
  pointsDone: number;
  completionPct: number;
  pace: SprintPace;
}

export interface CurrentSprintResponse {
  sprint: CurrentSprintSnapshot | null;
}

export async function getCurrentSprint(projectId: string): Promise<CurrentSprintResponse> {
  const { data } = await api.get(`/projects/${projectId}/current-sprint`);
  return data.data;
}
