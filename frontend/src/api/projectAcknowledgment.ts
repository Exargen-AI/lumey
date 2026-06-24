import api from './client';

export async function getMyAcknowledgment(projectId: string) {
  const { data } = await api.get(`/projects/${projectId}/my-acknowledgment`);
  return data.data as { acknowledged: boolean; acknowledgedAt: string | null; text: string };
}

export async function acknowledgeProject(projectId: string) {
  const { data } = await api.post(`/projects/${projectId}/acknowledge`);
  return data.data as { acknowledged: boolean; acknowledgedAt: string };
}

export interface AcknowledgmentRecord {
  id: string;
  acknowledgedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  user: { id: string; name: string; email: string; role: string };
}

/** Admin audit list — every user × this-project acknowledgment.
 *  Owners (SUPER_ADMIN) are intentionally never in this list since the
 *  gate exempts them. */
export async function listProjectAcknowledgments(projectId: string) {
  const { data } = await api.get(`/projects/${projectId}/acknowledgments`);
  return data.data as AcknowledgmentRecord[];
}
