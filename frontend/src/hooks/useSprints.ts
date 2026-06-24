import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as sprintApi from '@/api/sprints';

// Sprint hooks
export function useProjectSprints(projectId: string) {
  return useQuery({ queryKey: ['sprints', projectId], queryFn: () => sprintApi.getProjectSprints(projectId), enabled: !!projectId });
}

export function useSprintDetail(sprintId: string) {
  return useQuery({ queryKey: ['sprint', sprintId], queryFn: () => sprintApi.getSprintDetail(sprintId), enabled: !!sprintId });
}

export function useActiveSprint(projectId: string) {
  return useQuery({ queryKey: ['active-sprint', projectId], queryFn: () => sprintApi.getActiveSprint(projectId), enabled: !!projectId });
}

export function useBacklog(projectId: string) {
  return useQuery({ queryKey: ['backlog', projectId], queryFn: () => sprintApi.getBacklog(projectId), enabled: !!projectId });
}

export function useCreateSprint(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; goal?: string; startDate: string; endDate: string }) => sprintApi.createSprint(projectId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sprints', projectId] }),
  });
}

export function useUpdateSprint(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => sprintApi.updateSprint(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sprints', projectId] });
      qc.invalidateQueries({ queryKey: ['sprint'] });
      qc.invalidateQueries({ queryKey: ['active-sprint', projectId] });
    },
  });
}

export function useStartSprint(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sprintId: string) => sprintApi.startSprint(projectId, sprintId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sprints', projectId] });
      qc.invalidateQueries({ queryKey: ['active-sprint', projectId] });
    },
  });
}

export function useCompleteSprint(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sprintId, input }: { sprintId: string; input?: sprintApi.CompleteSprintInput }) =>
      sprintApi.completeSprint(sprintId, input ?? { carryOver: 'all' }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['sprints', projectId] });
      qc.invalidateQueries({ queryKey: ['active-sprint', projectId] });
      qc.invalidateQueries({ queryKey: ['backlog', projectId] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['sprint-burnup', vars.sprintId] });
    },
  });
}

export function useSprintBurnup(sprintId: string | null | undefined) {
  return useQuery({
    queryKey: ['sprint-burnup', sprintId],
    queryFn: () => sprintApi.getSprintBurnup(sprintId!),
    enabled: !!sprintId,
  });
}

export function useAssignTaskToSprint(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, sprintId }: { taskId: string; sprintId: string | null }) => sprintApi.assignTaskToSprint(taskId, sprintId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sprints', projectId] });
      qc.invalidateQueries({ queryKey: ['sprint'] });
      qc.invalidateQueries({ queryKey: ['backlog', projectId] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });
}

// Epic hooks
export function useProjectEpics(projectId: string) {
  return useQuery({ queryKey: ['epics', projectId], queryFn: () => sprintApi.getProjectEpics(projectId), enabled: !!projectId });
}

export function useCreateEpic(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { title: string; description?: string; color?: string }) => sprintApi.createEpic(projectId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['epics', projectId] }),
  });
}

export function useUpdateEpic(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => sprintApi.updateEpic(id, data),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['epics', projectId] });
      qc.invalidateQueries({ queryKey: ['epic', variables.id] });
    },
  });
}

export function useDeleteEpic(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sprintApi.deleteEpic(id),
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ['epics', projectId] });
      qc.removeQueries({ queryKey: ['epic', id] });
      // Tasks may have been orphaned (epicId set to null) — refresh task lists.
      qc.invalidateQueries({ queryKey: ['tasks', projectId] });
    },
  });
}

export function useEpicDetail(epicId: string | null | undefined) {
  return useQuery({
    queryKey: ['epic', epicId],
    queryFn: () => sprintApi.getEpicDetail(epicId!),
    enabled: !!epicId,
  });
}
