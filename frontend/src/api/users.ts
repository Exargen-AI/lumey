import api from './client';

export async function getUsers(params?: Record<string, string>) {
  const { data } = await api.get('/users', { params });
  return data.data;
}

export async function getUser(id: string) {
  const { data } = await api.get(`/users/${id}`);
  return data.data;
}

export async function createUser(input: any) {
  const { data } = await api.post('/users', input);
  return data.data;
}

export async function updateUser(id: string, input: any) {
  const { data } = await api.put(`/users/${id}`, input);
  return data.data;
}

export async function resetUserPassword(id: string, newPassword: string) {
  const { data } = await api.put(`/users/${id}/reset-password`, { newPassword });
  return data.data;
}

export async function deactivateUser(id: string) {
  const { data } = await api.delete(`/users/${id}`);
  return data.data;
}

/**
 * Replace the agent-visibility allowlist in one shot (SUPER_ADMIN only).
 * `userIds` is the complete set of users who should be able to see AI
 * agents; everyone else is revoked.
 */
export async function setAgentViewers(userIds: string[]) {
  const { data } = await api.put('/users/agent-viewers', { userIds });
  return data.data as { granted: number; revoked: number };
}
