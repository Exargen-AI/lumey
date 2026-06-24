import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '@/api/githubIntegration';

export function useTaskExternalLinks(taskId: string | undefined) {
  return useQuery({
    queryKey: ['task-external-links', taskId],
    queryFn: () => api.getTaskExternalLinks(taskId!),
    enabled: !!taskId,
    // Refresh on focus so a newly-merged PR shows up when the user
    // tabs back from GitHub. 30s staleness is fine — webhook delivery
    // takes a few seconds at most.
    staleTime: 30 * 1000,
  });
}

export function useGitHubIntegration(projectId: string | undefined) {
  return useQuery({
    queryKey: ['github-integration', projectId],
    queryFn: () => api.getGitHubIntegration(projectId!),
    enabled: !!projectId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useConnectGitHub(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { repoOwner: string; repoName: string; autoCloseOnMerge?: boolean }) =>
      api.connectGitHub(projectId, payload),
    onSuccess: () => {
      // Invalidate so the settings page refetches the public config (the
      // mutation response carries the secret, which we keep in local state).
      qc.invalidateQueries({ queryKey: ['github-integration', projectId] });
    },
  });
}

export function useDisconnectGitHub(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.disconnectGitHub(projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['github-integration', projectId] });
    },
  });
}
