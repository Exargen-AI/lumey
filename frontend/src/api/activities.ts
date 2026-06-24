import api from './client';

export async function getActivities(params?: Record<string, string>) {
  const { data } = await api.get('/activities', { params });
  return data.data;
}

export async function getPortfolioActivities(params?: Record<string, string>) {
  const { data } = await api.get('/activities', { params });
  return data.data;
}

export async function getProjectActivities(projectId: string) {
  const { data } = await api.get(`/projects/${projectId}/activities`);
  return data.data;
}
