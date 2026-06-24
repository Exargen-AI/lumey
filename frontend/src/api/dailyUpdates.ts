import api from './client';

export interface DailyUpdateSubmission {
  summary: string;
  mood?: 'GREAT' | 'GOOD' | 'NEUTRAL' | 'STRUGGLING' | 'BLOCKED';
  blockers?: string;
  plans?: string;
  hoursWorked?: number;
  tasks?: {
    taskId: string;
    note?: string;
    statusBefore: string;
    statusAfter: string;
  }[];
}

export async function submitDailyUpdate(data: DailyUpdateSubmission) {
  const { data: res } = await api.post('/daily-updates', data);
  return res.data;
}

export async function getMyDailyUpdates(params?: { page?: number; limit?: number }) {
  const { data } = await api.get('/daily-updates/mine', { params });
  return data.data;
}

export async function getMyStreak() {
  const { data } = await api.get('/daily-updates/mine/streak');
  return data.data;
}

export async function getMyProductivityStats(daysBack = 7) {
  const { data } = await api.get('/daily-updates/mine/stats', { params: { days: daysBack } });
  return data.data;
}

export async function getTodayStatus() {
  const { data } = await api.get('/daily-updates/mine/today');
  return data.data;
}
