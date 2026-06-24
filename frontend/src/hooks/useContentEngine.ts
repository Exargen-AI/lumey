import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { contentEngineApi } from '../api/contentEngine';

export const useContentEngineHistory = (projectId: string) =>
  useQuery({
    queryKey: ['content-engine', 'history', projectId],
    queryFn: () => contentEngineApi.getHistory(projectId),
    enabled: !!projectId,
  });

export const useAnalyzeTopic = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { topic: string; timeRange?: string; sentimentFilter?: string }) =>
      contentEngineApi.analyzeTopic(projectId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['content-engine', 'history', projectId] });
    },
  });
};

export const useGenerateBlog = (projectId: string) =>
  useMutation({
    mutationFn: (data: { analysisId: string; selectedIdea?: string }) =>
      contentEngineApi.generateBlog(projectId, data),
  });

export const useContentEngineImages = (projectId: string, query: string, enabled: boolean) =>
  useQuery({
    queryKey: ['content-engine', 'images', projectId, query],
    queryFn: () => contentEngineApi.getImages(projectId, query),
    enabled: enabled && !!query,
    staleTime: 10 * 60 * 1000, // cache 10 min — images don't change often
  });

export const useDeleteSearch = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (searchId: string) => contentEngineApi.deleteSearch(projectId, searchId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['content-engine', 'history', projectId] }),
  });
};

export const useClearSearches = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => contentEngineApi.clearSearches(projectId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['content-engine', 'history', projectId] }),
  });
};

export const useCreateCmsDraft = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      generatedDraftId: string;
      featuredImageUrl?: string;
      featuredImageAlt?: string;
      contentImages?: Array<{ url: string; altText: string }>;
    }) => contentEngineApi.createDraft(projectId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cms', 'blogs', projectId] });
    },
  });
};
