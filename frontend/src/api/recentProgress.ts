import api from './client';

export interface RecentProgressItem {
  taskId: string;
  title: string;
  completedAt: string;
  storyPoints: number | null;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  taskType: 'FEATURE' | 'BUG' | 'CHORE' | 'SPIKE';
}

export interface RecentProgressResponse {
  items: RecentProgressItem[];
  totalThisWindow: number;
  windowDays: number;
}

export async function getRecentProgress(
  projectId: string,
  opts?: { days?: number; limit?: number },
): Promise<RecentProgressResponse> {
  const params: Record<string, string> = {};
  if (opts?.days) params.days = String(opts.days);
  if (opts?.limit) params.limit = String(opts.limit);
  const { data } = await api.get(`/projects/${projectId}/recent-progress`, { params });
  return data.data;
}
