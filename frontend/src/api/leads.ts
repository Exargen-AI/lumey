import apiClient from './client';

export type Lead = {
  id: string;
  projectId: string;
  website?: string | null;
  formType: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  message?: string | null;
  sourcePage?: string | null;
  metadata?: Record<string, unknown> | null;
  status: 'NEW' | 'CONTACTED' | 'CLOSED';
  createdAt: string;
  updatedAt?: string;
};

export const listLeads = (
  projectId: string,
  page = 1,
  limit = 25,
  status?: 'NEW' | 'CONTACTED' | 'CLOSED'
) =>
  apiClient
    .get<{ data: { items: Lead[]; total: number } }>(`/leads`, {
      params: { projectId, page, limit, ...(status ? { status } : {}) },
    })
    .then((r) => r.data.data);

export const getLead = (id: string) => apiClient.get<{ data: Lead }>(`/leads/${id}`).then((r) => r.data.data);

export const updateLeadStatus = (id: string, status: string) =>
  apiClient.put<{ data: Lead }>(`/leads/${id}/status`, { status }).then((r) => r.data.data);
