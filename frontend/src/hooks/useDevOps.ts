import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/api/client';

// ─── REPOSITORIES ───

export function useRepositories(projectId: string) {
  return useQuery({
    queryKey: ['devops', 'repositories', projectId],
    queryFn: () => api.get(`/projects/${projectId}/devops/repositories`),
    enabled: !!projectId,
  });
}

export function useRepository(repositoryId: string) {
  return useQuery({
    queryKey: ['devops', 'repository', repositoryId],
    queryFn: () => api.get(`/devops/repositories/${repositoryId}`),
    enabled: !!repositoryId,
  });
}

export function useCreateRepository(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.post(`/projects/${projectId}/devops/repositories`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devops', 'repositories', projectId] });
      queryClient.invalidateQueries({ queryKey: ['devops', 'overview', projectId] });
    },
  });
}

export function useUpdateRepository(repositoryId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.patch(`/devops/repositories/${repositoryId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devops', 'repository', repositoryId] });
    },
  });
}

export function useDeleteRepository(repositoryId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete(`/devops/repositories/${repositoryId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devops', 'repositories'] });
      queryClient.invalidateQueries({ queryKey: ['devops', 'overview'] });
    },
  });
}

// ─── ACTIVITIES ───

export function useActivities(repositoryId: string, options?: { type?: string }) {
  return useQuery({
    queryKey: ['devops', 'activities', repositoryId, options?.type],
    queryFn: () => {
      const params = new URLSearchParams();
      if (options?.type) params.append('type', options.type);
      return api.get(`/devops/repositories/${repositoryId}/activities?${params.toString()}`);
    },
    enabled: !!repositoryId,
  });
}

export function useProjectActivities(projectId: string) {
  return useQuery({
    queryKey: ['devops', 'project-activities', projectId],
    queryFn: () => api.get(`/projects/${projectId}/devops/activities`),
    enabled: !!projectId,
  });
}

export function useSyncActivities(repositoryId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`/devops/repositories/${repositoryId}/sync`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devops', 'activities', repositoryId] });
      queryClient.invalidateQueries({ queryKey: ['devops', 'project-activities'] });
      queryClient.invalidateQueries({ queryKey: ['devops', 'repositories'] });
      queryClient.invalidateQueries({ queryKey: ['devops', 'overview'] });
    },
  });
}

export function useLinkActivityToTask(activityId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      api.post(`/devops/activities/${activityId}/link-task`, { taskId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devops', 'activities'] });
      queryClient.invalidateQueries({ queryKey: ['devops', 'project-activities'] });
    },
  });
}

// ─── ENVIRONMENTS ───

export function useEnvironments(projectId: string) {
  return useQuery({
    queryKey: ['devops', 'environments', projectId],
    queryFn: () => api.get(`/projects/${projectId}/devops/environments`),
    enabled: !!projectId,
  });
}

export function useEnvironmentsWithStatus(projectId: string) {
  return useQuery({
    queryKey: ['devops', 'environments-with-status', projectId],
    queryFn: () => api.get(`/projects/${projectId}/devops/environments/with-status`),
    enabled: !!projectId,
  });
}

export function useCreateEnvironment(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.post(`/projects/${projectId}/devops/environments`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devops', 'environments', projectId] });
      queryClient.invalidateQueries({ queryKey: ['devops', 'environments-with-status', projectId] });
    },
  });
}

export function useUpdateEnvironment(environmentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.patch(`/devops/environments/${environmentId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devops', 'environments'] });
      queryClient.invalidateQueries({ queryKey: ['devops', 'environments-with-status'] });
    },
  });
}

// ─── DEPLOYMENTS ───

export function useDeployments(environmentId: string) {
  return useQuery({
    queryKey: ['devops', 'deployments', environmentId],
    queryFn: () => api.get(`/devops/environments/${environmentId}/deployments`),
    enabled: !!environmentId,
  });
}

export function useProjectDeployments(projectId: string) {
  return useQuery({
    queryKey: ['devops', 'project-deployments', projectId],
    queryFn: () => api.get(`/projects/${projectId}/devops/deployments`),
    enabled: !!projectId,
  });
}

export function useCreateDeployment(projectId: string, repositoryId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) =>
      api.post(`/projects/${projectId}/devops/repositories/${repositoryId}/deployments`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devops', 'deployments'] });
      queryClient.invalidateQueries({ queryKey: ['devops', 'project-deployments', projectId] });
    },
  });
}

export function useUpdateDeploymentStatus(deploymentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.patch(`/devops/deployments/${deploymentId}/status`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devops', 'deployments'] });
      queryClient.invalidateQueries({ queryKey: ['devops', 'project-deployments'] });
    },
  });
}

// ─── PIPELINES ───

export function usePipelines(repositoryId: string) {
  return useQuery({
    queryKey: ['devops', 'pipelines', repositoryId],
    queryFn: () => api.get(`/devops/repositories/${repositoryId}/pipelines`),
    enabled: !!repositoryId,
  });
}

export function usePipelineRuns(pipelineId: string) {
  return useQuery({
    queryKey: ['devops', 'pipeline-runs', pipelineId],
    queryFn: () => api.get(`/devops/pipelines/${pipelineId}/runs`),
    enabled: !!pipelineId,
  });
}

export function useLatestPipelineRun(pipelineId: string) {
  return useQuery({
    queryKey: ['devops', 'latest-pipeline-run', pipelineId],
    queryFn: () => api.get(`/devops/pipelines/${pipelineId}/latest-run`),
    enabled: !!pipelineId,
  });
}

export function useCreatePipelineRun(pipelineId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.post(`/devops/pipelines/${pipelineId}/runs`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devops', 'pipeline-runs', pipelineId] });
      queryClient.invalidateQueries({ queryKey: ['devops', 'latest-pipeline-run', pipelineId] });
    },
  });
}

// ─── RELEASES ───

export function useReleases(repositoryId: string) {
  return useQuery({
    queryKey: ['devops', 'releases', repositoryId],
    queryFn: () => api.get(`/devops/repositories/${repositoryId}/releases`),
    enabled: !!repositoryId,
  });
}

export function useLatestReleases(projectId: string) {
  return useQuery({
    queryKey: ['devops', 'latest-releases', projectId],
    queryFn: () => api.get(`/projects/${projectId}/devops/latest-releases`),
    enabled: !!projectId,
  });
}

export function useCreateRelease(repositoryId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.post(`/devops/repositories/${repositoryId}/releases`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['devops', 'releases', repositoryId] });
      queryClient.invalidateQueries({ queryKey: ['devops', 'latest-releases'] });
    },
  });
}

// ─── OVERVIEW ───

export function useDevOpsOverview(projectId: string) {
  return useQuery({
    queryKey: ['devops', 'overview', projectId],
    queryFn: () => api.get(`/projects/${projectId}/devops/overview`),
    enabled: !!projectId,
  });
}
