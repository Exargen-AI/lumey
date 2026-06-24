import api from './client';

export async function getPermissions() {
  const { data } = await api.get('/rbac/permissions');
  return data.data;
}

export async function getRoles() {
  const { data } = await api.get('/rbac/roles');
  return data.data;
}

export async function updateRolePermissions(role: string, permissions: { permissionId: string; granted: boolean }[]) {
  const { data } = await api.put(`/rbac/roles/${role}`, { permissions });
  return data.data;
}
