import api from './client';

export async function getMilestones(projectId: string) {
  const { data } = await api.get(`/projects/${projectId}/milestones`);
  return data.data;
}

export async function createMilestone(projectId: string, input: any) {
  const { data } = await api.post(`/projects/${projectId}/milestones`, input);
  return data.data;
}

export async function updateMilestone(id: string, input: any) {
  const { data } = await api.put(`/milestones/${id}`, input);
  return data.data;
}

export async function deleteMilestone(id: string) {
  const { data } = await api.delete(`/milestones/${id}`);
  return data.data;
}
