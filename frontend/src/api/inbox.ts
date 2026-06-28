import api from './client';

/** One run waiting on a human — a question to answer or an action to approve. */
export interface InboxItem {
  kind: 'clarification' | 'approval';
  id: string;
  runId: string;
  taskId: string;
  taskNumber: number;
  taskTitle: string;
  projectId: string;
  projectName: string;
  projectSlug: string;
  prompt: string;
  detail: string | null;
  action: string | null;
  waitingSince: string;
}

/** Every run awaiting the current user's decision, oldest wait first. */
export async function listInbox(): Promise<InboxItem[]> {
  const { data } = await api.get('/inbox');
  return data.data;
}
