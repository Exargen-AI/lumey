import api from './client';

export async function getDeliverables(projectId: string) {
  const { data } = await api.get(`/projects/${projectId}/deliverables`);
  return data.data;
}

export async function createDeliverable(projectId: string, payload: any) {
  const { data } = await api.post(`/projects/${projectId}/deliverables`, payload);
  return data.data;
}

export async function updateDeliverable(deliverableId: string, payload: any) {
  const { data } = await api.put(`/deliverables/${deliverableId}`, payload);
  return data.data;
}

export async function deleteDeliverable(deliverableId: string) {
  const { data } = await api.delete(`/deliverables/${deliverableId}`);
  return data.data;
}

export async function markDelivered(deliverableId: string) {
  const { data } = await api.post(`/deliverables/${deliverableId}/mark-delivered`);
  return data.data;
}

export async function signOffDeliverable(deliverableId: string) {
  const { data } = await api.post(`/deliverables/${deliverableId}/sign-off`);
  return data.data;
}

export async function rejectDeliverable(deliverableId: string, note: string) {
  const { data } = await api.post(`/deliverables/${deliverableId}/reject`, { note });
  return data.data;
}
