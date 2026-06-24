import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '@/api/customFields';

export function useCustomFieldDefinitions(projectId: string | undefined) {
  return useQuery({
    queryKey: ['custom-fields', projectId],
    queryFn: () => api.listDefinitions(projectId!),
    enabled: !!projectId,
  });
}

export function useCreateCustomField(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: api.CreateDefinitionInput) => api.createDefinition(projectId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-fields', projectId] }),
  });
}

export function useUpdateCustomField(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<api.CreateDefinitionInput> }) =>
      api.updateDefinition(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-fields', projectId] }),
  });
}

export function useDeleteCustomField(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteDefinition(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['custom-fields', projectId] });
      // Tasks lose the value too — refresh task lists.
      qc.invalidateQueries({ queryKey: ['tasks', projectId] });
    },
  });
}

export function useReorderCustomFields(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.reorderDefinitions(projectId, ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['custom-fields', projectId] }),
  });
}
