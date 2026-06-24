import api from './client';

export async function logTime(data: { projectId: string; taskId?: string; date: string; hours: number; description?: string }) {
  const { data: res } = await api.post('/timesheet/log', data);
  return res.data;
}

export async function bulkLogTime(entries: { projectId: string; taskId?: string; date: string; hours: number; description?: string }[]) {
  const { data: res } = await api.post('/timesheet/bulk', { entries });
  return res.data;
}

export async function getWeeklyTimesheet(weekStart?: string) {
  const { data } = await api.get('/timesheet/weekly', { params: { weekStart } });
  return data.data;
}

export async function getTimesheetStatus(weekStart?: string) {
  const { data } = await api.get('/timesheet/status', { params: { weekStart } });
  return data.data;
}

export async function submitTimesheet(weekStart: string) {
  const { data } = await api.post('/timesheet/submit', { weekStart });
  return data.data;
}

export async function reopenTimesheet(weekStart: string) {
  const { data } = await api.post('/timesheet/reopen', { weekStart });
  return data.data;
}

export async function deleteTimeEntry(id: string) {
  const { data } = await api.delete(`/timesheet/${id}`);
  return data;
}

export type ApprovalStatusFilter = 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'ALL';

/**
 * Approvals list. The path is `/timesheet/pending` for historical reasons
 * (it began life as a pending-only queue), but the optional `status` arg
 * drives the Pending / Approved / Rejected / All tabs in the admin UI.
 *
 * Defaults to SUBMITTED on the server when the param is omitted, so any
 * caller that hasn't migrated still sees the original queue.
 */
export async function getPendingApprovals(status?: ApprovalStatusFilter) {
  const { data } = await api.get('/timesheet/pending', {
    params: status ? { status } : undefined,
  });
  return data.data;
}

export async function getApprovalCounts(): Promise<Record<'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'ALL', number>> {
  const { data } = await api.get('/timesheet/approvals/counts');
  return data.data;
}

export async function approveTimesheet(id: string) {
  const { data } = await api.patch(`/timesheet/${id}/approve`);
  return data.data;
}

export async function rejectTimesheet(id: string, reason: string) {
  const { data } = await api.patch(`/timesheet/${id}/reject`, { reason });
  return data.data;
}
