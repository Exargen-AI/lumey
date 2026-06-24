import type { StoryUpdateData } from '@exargen/shared';
import api from './client';

export async function getProjectComments(projectId: string) {
  const { data } = await api.get(`/projects/${projectId}/comments`);
  return data.data;
}

export async function getTaskComments(taskId: string) {
  const { data } = await api.get(`/tasks/${taskId}/comments`);
  return data.data;
}

export async function createProjectComment(projectId: string, input: any) {
  const { data } = await api.post(`/projects/${projectId}/comments`, input);
  return data.data;
}

export async function createTaskComment(taskId: string, input: any) {
  const { data } = await api.post(`/tasks/${taskId}/comments`, input);
  return data.data;
}

export async function updateComment(
  id: string,
  // A plain edit sends `content`; a story-update edit sends `storyData`.
  // `expectedUpdatedAt` opts into optimistic-lock conflict detection.
  input: { content?: string; storyData?: StoryUpdateData; expectedUpdatedAt?: string },
) {
  const { data } = await api.patch(`/comments/${id}`, input);
  return data.data;
}

export async function deleteComment(id: string) {
  const { data } = await api.delete(`/comments/${id}`);
  return data.data;
}
