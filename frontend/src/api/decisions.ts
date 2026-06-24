import api from './client';

export async function getDecisions(projectId: string, params?: Record<string, string>) {
  const { data } = await api.get(`/projects/${projectId}/decisions`, { params });
  return data.data;
}

export async function createDecision(projectId: string, input: any) {
  const { data } = await api.post(`/projects/${projectId}/decisions`, input);
  return data.data;
}

export async function updateDecision(id: string, input: any) {
  const { data } = await api.put(`/decisions/${id}`, input);
  return data.data;
}

export async function deleteDecision(id: string) {
  const { data } = await api.delete(`/decisions/${id}`);
  return data.data;
}
