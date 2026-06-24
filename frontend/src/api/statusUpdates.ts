import api from './client';

export async function getStatusUpdates(projectId: string) {
  const { data } = await api.get(`/projects/${projectId}/status-updates`);
  return data.data;
}

export async function createStatusUpdate(projectId: string, input: any) {
  const { data } = await api.post(`/projects/${projectId}/status-updates`, input);
  return data.data;
}
