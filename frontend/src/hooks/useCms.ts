import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cmsApi } from '../api/cms';

// Backend wraps responses as { success: true, data: ... }. Most CMS endpoints
// return that envelope, so unwrap once here rather than at every call site.
// Returns `any` deliberately — the cmsApi types are loose and downstream
// consumers do their own narrowing. Tightening this would cascade into
// every page that touches CMS data.
const unwrap = (res: any): any => res.data?.data;

// ─── Content Projects ──────────────────────────────────────────────────────

export const useContentProjects = () => useQuery({
  queryKey: ['cms', 'projects'],
  queryFn: () => cmsApi.getContentProjects().then((res) => unwrap(res) || []),
});

export const useContentProject = (id: string) => useQuery({
  queryKey: ['cms', 'projects', id],
  queryFn: () => cmsApi.getContentProject(id).then(unwrap),
  enabled: !!id,
});

export const useCreateContentProject = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; description?: string; domain?: string }) =>
      cmsApi.createContentProject(data).then(unwrap),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cms', 'projects'] });
    },
  });
};

export const useUpdateContentProject = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      cmsApi.updateContentProject(id, data).then((res) => res.data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['cms', 'projects'] });
      qc.invalidateQueries({ queryKey: ['cms', 'projects', id] });
    },
  });
};

export const useDeleteContentProject = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cmsApi.deleteContentProject(id).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cms', 'projects'] });
    },
  });
};

export const useRegenerateApiKey = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cmsApi.regenerateApiKey(id).then(unwrap),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['cms', 'projects'] });
      qc.invalidateQueries({ queryKey: ['cms', 'projects', id] });
    },
  });
};

// ─── Templates ─────────────────────────────────────────────────────────────

export const useTemplates = (projectId: string) => useQuery({
  queryKey: ['cms', 'templates', projectId],
  queryFn: () => cmsApi.getTemplates(projectId).then((res) => unwrap(res) || []),
  enabled: !!projectId,
});

export const useTemplate = (id: string) => useQuery({
  queryKey: ['cms', 'templates', id],
  queryFn: () => cmsApi.getTemplate(id).then((res) => res.data),
  enabled: !!id,
});

export const useCreateTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      projectId: string;
      name: string;
      type: 'ARTICLE' | 'TUTORIAL' | 'NEWS' | 'CASE_STUDY' | 'ANNOUNCEMENT';
      description?: string;
      structure: any;
    }) => cmsApi.createTemplate(data).then(unwrap),
    onSuccess: (_, { projectId }) => {
      qc.invalidateQueries({ queryKey: ['cms', 'templates', projectId] });
    },
  });
};

export const useUpdateTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      cmsApi.updateTemplate(id, data).then(unwrap),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['cms', 'templates'] });
      qc.invalidateQueries({ queryKey: ['cms', 'templates', id] });
    },
  });
};

export const useDeleteTemplate = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cmsApi.deleteTemplate(id).then(unwrap),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cms', 'templates'] });
    },
  });
};

// ─── Blogs ─────────────────────────────────────────────────────────────────

export const useBlogs = (projectId: string, status?: string) => useQuery({
  queryKey: ['cms', 'blogs', projectId, status],
  queryFn: () => cmsApi.getBlogs(projectId, status).then((res) => unwrap(res) || []),
  enabled: !!projectId,
});

export const useBlog = (id: string) => useQuery({
  queryKey: ['cms', 'blogs', id],
  queryFn: () => cmsApi.getBlog(id).then(unwrap),
  enabled: !!id,
});

export const useCreateBlog = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      projectId: string;
      templateId?: string;
      title: string;
      excerpt?: string;
      content: any;
    }) => cmsApi.createBlog(data).then(unwrap),
    onSuccess: (_, { projectId }) => {
      qc.invalidateQueries({ queryKey: ['cms', 'blogs', projectId] });
      qc.invalidateQueries({ queryKey: ['cms', 'projects', projectId] });
    },
  });
};

export const useUpdateBlog = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      cmsApi.updateBlog(id, data).then(unwrap),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['cms', 'blogs'] });
      qc.invalidateQueries({ queryKey: ['cms', 'blogs', id] });
    },
  });
};

export const useDeleteBlog = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cmsApi.deleteBlog(id).then((res) => res.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cms', 'blogs'] });
    },
  });
};

// ─── Public API (for external websites consuming via API key) ──────────────

export const usePublicBlogs = (apiKey: string) => useQuery({
  queryKey: ['cms', 'public', 'blogs', apiKey],
  queryFn: () => cmsApi.getPublicBlogs(apiKey).then((res) => res.data),
  enabled: !!apiKey,
});

export const usePublicBlog = (apiKey: string, slug: string) => useQuery({
  queryKey: ['cms', 'public', 'blogs', apiKey, slug],
  queryFn: () => cmsApi.getPublicBlog(apiKey, slug).then((res) => res.data),
  enabled: !!apiKey && !!slug,
});

// ─── Media Assets ──────────────────────────────────────────────────────────

export const useMediaAssets = (projectId: string) => useQuery({
  queryKey: ['cms', 'media', projectId],
  queryFn: () => cmsApi.getMediaAssets(projectId).then((res) => unwrap(res) || []),
  enabled: !!projectId,
});

export const useUploadMedia = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, files }: { projectId: string; files: File[] }) =>
      cmsApi.uploadMedia(projectId, files).then((res) => unwrap(res) || []),
    onSuccess: (_, { projectId }) => {
      qc.invalidateQueries({ queryKey: ['cms', 'media', projectId] });
    },
  });
};

export const useDeleteMedia = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, assetId }: { projectId: string; assetId: string }) =>
      cmsApi.deleteMedia(projectId, assetId).then(unwrap),
    onSuccess: (_, { projectId }) => {
      qc.invalidateQueries({ queryKey: ['cms', 'media', projectId] });
    },
  });
};
