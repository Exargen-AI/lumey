import api from './client';

export async function getProjects(params?: Record<string, string>) {
  const { data } = await api.get('/projects', { params });
  return data.data;
}

export async function getProject(id: string) {
  const { data } = await api.get(`/projects/${id}`);
  return data.data;
}

export async function createProject(input: any) {
  const { data } = await api.post('/projects', input);
  return data.data;
}

export async function updateProject(id: string, input: any) {
  const { data } = await api.put(`/projects/${id}`, input);
  return data.data;
}

export async function deleteProject(id: string) {
  const { data } = await api.delete(`/projects/${id}`);
  return data.data;
}

export async function getProjectMembers(id: string) {
  const { data } = await api.get(`/projects/${id}/members`);
  return data.data;
}

export async function addProjectMember(id: string, userId: string, role: string) {
  const { data } = await api.post(`/projects/${id}/members`, { userId, role });
  return data.data;
}

export async function removeProjectMember(projectId: string, userId: string) {
  const { data } = await api.delete(`/projects/${projectId}/members/${userId}`);
  return data.data;
}

// SUPER_ADMIN-only: grant/revoke a CLIENT member's full access to this
// project (the entire internal view — tasks, decisions, comments).
export async function setProjectMemberFullAccess(projectId: string, userId: string, fullAccess: boolean) {
  const { data } = await api.patch(`/projects/${projectId}/members/${userId}/access`, { fullAccess });
  return data.data;
}
