import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as projectApi from '@/api/projects';

interface QueryOptions {
  enabled?: boolean;
}

export function useProjects(params?: Record<string, string>, options?: QueryOptions) {
  return useQuery({
    queryKey: ['projects', params],
    queryFn: () => projectApi.getProjects(params),
    enabled: options?.enabled ?? true,
  });
}

export function useProject(id: string, options?: QueryOptions) {
  return useQuery({ queryKey: ['project', id], queryFn: () => projectApi.getProject(id), enabled: options?.enabled ?? !!id });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: projectApi.createProject, onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }) });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => projectApi.updateProject(id, data),
    onSuccess: (_, vars) => { qc.invalidateQueries({ queryKey: ['projects'] }); qc.invalidateQueries({ queryKey: ['project', vars.id] }); },
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: projectApi.deleteProject, onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }) });
}

export function useProjectMembers(projectId: string) {
  return useQuery({ queryKey: ['project-members', projectId], queryFn: () => projectApi.getProjectMembers(projectId), enabled: !!projectId });
}

// SUPER_ADMIN-only: grant/revoke a CLIENT member's full access to a project.
export function useSetProjectMemberFullAccess(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, fullAccess }: { userId: string; fullAccess: boolean }) =>
      projectApi.setProjectMemberFullAccess(projectId, userId, fullAccess),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project-members', projectId] }),
  });
}
