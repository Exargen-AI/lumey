import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { CreateCommentInput } from '@exargen/shared';
import * as commentApi from '@/api/comments';

export function useTaskComments(taskId: string) {
  return useQuery({
    queryKey: ['task-comments', taskId],
    queryFn: () => commentApi.getTaskComments(taskId),
    enabled: !!taskId,
  });
}

export function useCreateTaskComment(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    // Accepts a plain comment ({ content }) or a story update
    // ({ kind: 'story_update', storyData }) — the server renders the
    // content body for the latter.
    mutationFn: (data: Omit<CreateCommentInput, 'taskId'>) => commentApi.createTaskComment(taskId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task-comments', taskId] }),
  });
}

export function useUpdateTaskComment(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    // Edits a plain comment ({ id, content }) or a story update
    // ({ id, storyData }); pass expectedUpdatedAt to detect concurrent edits.
    mutationFn: ({ id, ...input }: { id: string } & Parameters<typeof commentApi.updateComment>[1]) =>
      commentApi.updateComment(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task-comments', taskId] }),
  });
}

export function useDeleteComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: commentApi.deleteComment,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task-comments'] }),
  });
}
