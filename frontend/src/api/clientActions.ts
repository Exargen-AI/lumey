import api from './client';

export type ClientActionKind = 'DELIVERABLE' | 'DECISION';

export interface ClientActionItem {
  kind: ClientActionKind;
  id: string;
  title: string;
  waitingDays: number;
  since: string;
}

export interface ClientActionsResponse {
  items: ClientActionItem[];
  count: number;
}

export async function getClientActions(projectId: string): Promise<ClientActionsResponse> {
  const { data } = await api.get(`/projects/${projectId}/client-actions`);
  return data.data;
}
