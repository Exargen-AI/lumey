import api from './client';

export async function clearSeedData() {
  const { data } = await api.post('/admin/clear-seed-data');
  return data.data;
}

export async function getSystemStats() {
  const { data } = await api.get('/admin/system-stats');
  return data.data;
}

export async function exportData() {
  const { data } = await api.post('/admin/export');
  return data.data;
}
