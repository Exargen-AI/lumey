import api from './client';

export type LeaveType = 'CASUAL' | 'SICK' | 'EARNED' | 'UNPAID' | 'BEREAVEMENT' | 'OTHER';
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface LeaveRequest {
  id: string;
  applicantId: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  leaveType: LeaveType;
  reason: string | null;
  status: LeaveStatus;
  decidedById: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  applicant?: { id: string; name: string; email: string; role?: string };
  decidedBy?: { id: string; name: string } | null;
}

export interface ApplyLeaveInput {
  startDate: string;     // YYYY-MM-DD
  endDate: string;       // YYYY-MM-DD
  leaveType: LeaveType;
  reason?: string | null;
}

export async function applyLeave(input: ApplyLeaveInput): Promise<LeaveRequest> {
  const { data } = await api.post('/leaves', input);
  return data.data;
}

export async function getMyLeaves(): Promise<LeaveRequest[]> {
  const { data } = await api.get('/leaves/my');
  return data.data;
}

export async function listAllLeaves(status?: LeaveStatus): Promise<LeaveRequest[]> {
  const { data } = await api.get('/leaves', { params: status ? { status } : undefined });
  return data.data;
}

export async function getLeave(id: string): Promise<LeaveRequest> {
  const { data } = await api.get(`/leaves/${id}`);
  return data.data;
}

export async function approveLeave(id: string, decisionNote?: string): Promise<LeaveRequest> {
  const { data } = await api.post(`/leaves/${id}/approve`, decisionNote ? { decisionNote } : {});
  return data.data;
}

export async function rejectLeave(id: string, decisionNote?: string): Promise<LeaveRequest> {
  const { data } = await api.post(`/leaves/${id}/reject`, decisionNote ? { decisionNote } : {});
  return data.data;
}

export async function cancelLeave(id: string): Promise<LeaveRequest> {
  const { data } = await api.post(`/leaves/${id}/cancel`);
  return data.data;
}

export async function getPendingLeaveCount(): Promise<number> {
  const { data } = await api.get('/leaves/pending/count');
  return data.data.count;
}

export interface LeaveCounts {
  PENDING: number;
  APPROVED: number;
  REJECTED: number;
  CANCELLED: number;
  ALL: number;
}

export async function getLeaveCounts(): Promise<LeaveCounts> {
  const { data } = await api.get('/leaves/counts');
  return data.data;
}

export async function revokeApprovedLeave(id: string, decisionNote: string): Promise<LeaveRequest> {
  const { data } = await api.post(`/leaves/${id}/revoke`, { decisionNote });
  return data.data;
}
