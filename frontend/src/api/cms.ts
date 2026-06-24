import apiClient from './client';
import { CmsContentBlock, TemplateField, TemplateType } from '@exargen/shared';

const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });

const apiOrigin = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

const normalizeMediaUrl = (url?: string) => {
  if (!url) return url;
  if (/^https?:\/\//i.test(url) || url.startsWith('data:') || url.startsWith('blob:')) {
    return url;
  }
  if (!apiOrigin) {
    return url;
  }
  return `${apiOrigin}${url.startsWith('/') ? url : `/${url}`}`;
};

const normalizeMediaAsset = <T extends { url?: string }>(asset: T): T => ({
  ...asset,
  url: normalizeMediaUrl(asset.url),
});

const normalizeTemplateStructure = (structure: any) => {
  if (Array.isArray(structure)) {
    return structure;
  }

  if (structure && typeof structure === 'object' && Array.isArray(structure.blocks)) {
    return structure.blocks;
  }

  return [];
};

const normalizeTemplate = <T extends { thumbnail?: string }>(template: T): T => ({
  ...template,
  thumbnail: normalizeMediaUrl(template.thumbnail),
  structure: normalizeTemplateStructure((template as any).structure),
  fields: Array.isArray((template as any).fields) ? (template as any).fields : [],
  isDefault: Boolean((template as any).isDefault),
});

const normalizeBlog = <T extends Record<string, any>>(blog: T): T => ({
  ...blog,
  featuredImage: blog.featuredImage ? normalizeMediaAsset(blog.featuredImage) : blog.featuredImage,
});

const mapResponseData = <T>(response: any, mapper: (value: T) => T) => {
  const payload = response?.data;
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return {
      ...response,
      data: {
        ...payload,
        data: mapper(payload.data),
      },
    };
  }

  return response;
};

export interface CmsContentProject {
  id: string;
  name: string;
  slug: string;
  description?: string;
  apiKey: string;
  apiKeyScopes?: string[];
  domain?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: {
    blogs: number;
    templates: number;
  };
}

export interface CmsTemplate {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  type: TemplateType;
  description?: string;
  thumbnail?: string;
  structure: CmsContentBlock[];
  fields: TemplateField[];
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  project?: CmsContentProject;
  _count?: {
    blogs: number;
  };
}

export interface CmsBlog {
  id: string;
  projectId: string;
  templateId?: string;
  title: string;
  slug: string;
  excerpt?: string;
  content: any;
  featuredImage?: any;
  seo?: any;
  tags: string[];
  categories: string[];
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  authorId: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
  author?: {
    id: string;
    name: string;
    email: string;
  };
  template?: CmsTemplate;
  project?: CmsContentProject;
}

export interface CmsMediaAsset {
  id: string;
  projectId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  altText?: string;
  caption?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// Content Projects
export const cmsApi = {
  // Content Projects
  createContentProject: (data: {
    name: string;
    description?: string;
    domain?: string;
  }) => apiClient.post<CmsContentProject>('/cms/projects', data),

  getContentProjects: () => apiClient.get<CmsContentProject[]>('/cms/projects'),

  getContentProject: (id: string) =>
    apiClient.get<CmsContentProject>(`/cms/projects/${id}`).then((response) =>
      mapResponseData<any>(response, (project) => ({
        ...project,
        blogs: Array.isArray(project?.blogs) ? project.blogs.map(normalizeBlog) : project?.blogs,
        mediaAssets: Array.isArray(project?.mediaAssets)
          ? project.mediaAssets.map(normalizeMediaAsset)
          : project?.mediaAssets,
      }))
    ),

  updateContentProject: (id: string, data: {
    name?: string;
    description?: string;
    domain?: string;
    isActive?: boolean;
    apiKeyScopes?: string[];
  }) => apiClient.put<CmsContentProject>(`/cms/projects/${id}`, data),

  deleteContentProject: (id: string) => apiClient.delete(`/cms/projects/${id}`),

  regenerateApiKey: (id: string) => apiClient.post<CmsContentProject>(`/cms/projects/${id}/regenerate-api-key`),

  // Templates
  createTemplate: (data: {
    projectId: string;
    name: string;
    type: CmsTemplate['type'];
    description?: string;
    structure: CmsContentBlock[];
  }) => apiClient.post<CmsTemplate>(`/cms/projects/${data.projectId}/templates`, data),

  getTemplates: (projectId: string) =>
    apiClient.get<CmsTemplate[]>(`/cms/projects/${projectId}/templates`).then((response) =>
      mapResponseData<CmsTemplate[]>(response, (templates) => templates.map(normalizeTemplate))
    ),

  getTemplate: (id: string) =>
    apiClient.get<CmsTemplate>(`/cms/templates/${id}`).then((response) =>
      mapResponseData<CmsTemplate>(response, normalizeTemplate)
    ),

  updateTemplate: (id: string, data: {
    name?: string;
    type?: CmsTemplate['type'];
    description?: string;
    structure?: CmsContentBlock[];
    isActive?: boolean;
  }) => apiClient.put<CmsTemplate>(`/cms/templates/${id}`, data),

  deleteTemplate: (id: string) => apiClient.delete(`/cms/templates/${id}`),

  // Blogs
  createBlog: (data: {
    projectId: string;
    templateId?: string;
    title: string;
    slug?: string;
    excerpt?: string;
    content: any;
    featuredImage?: any;
    seo?: any;
    tags?: string[];
    categories?: string[];
    status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
    publishedAt?: string;
  }) => apiClient.post<CmsBlog>(`/cms/projects/${data.projectId}/blogs`, data).then((response) =>
    mapResponseData<CmsBlog>(response, normalizeBlog)
  ),

  getBlogs: (projectId: string, status?: string) => 
    apiClient.get<CmsBlog[]>(`/cms/projects/${projectId}/blogs${status ? `?status=${status}` : ''}`).then((response) =>
      mapResponseData<CmsBlog[]>(response, (blogs) => blogs.map(normalizeBlog))
    ),

  getBlog: (id: string) =>
    apiClient.get<CmsBlog>(`/cms/blogs/${id}`).then((response) =>
      mapResponseData<CmsBlog>(response, normalizeBlog)
    ),

  updateBlog: (id: string, data: {
    title?: string;
    slug?: string;
    excerpt?: string;
    content?: any;
    templateId?: string | null;
    featuredImage?: any;
    seo?: any;
    tags?: string[];
    categories?: string[];
    status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
    publishedAt?: string | null;
  }) => apiClient.put<CmsBlog>(`/cms/blogs/${id}`, data).then((response) =>
    mapResponseData<CmsBlog>(response, normalizeBlog)
  ),

  deleteBlog: (id: string) => apiClient.delete(`/cms/blogs/${id}`),

  // Media Assets
  getMediaAssets: (projectId: string) =>
    apiClient.get<CmsMediaAsset[]>(`/cms/projects/${projectId}/media`).then((response) =>
      mapResponseData<CmsMediaAsset[]>(response, (assets) => assets.map(normalizeMediaAsset))
    ),

  uploadMedia: async (projectId: string, files: File[]) => {
    const payload = {
      files: await Promise.all(
        files.map(async (file) => ({
          originalName: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          contentBase64: await fileToBase64(file),
        }))
      ),
    };

    return apiClient.post<CmsMediaAsset[]>(`/cms/projects/${projectId}/media/upload`, payload).then((response) =>
      mapResponseData<CmsMediaAsset[]>(response, (assets) => assets.map(normalizeMediaAsset))
    );
  },

  deleteMedia: (projectId: string, assetId: string) => apiClient.delete(`/cms/projects/${projectId}/media/${assetId}`),

  // Public API (for external websites)
  getPublicBlogs: (apiKey: string) =>
    apiClient.get<CmsBlog[]>(`/cms/public/blogs?apiKey=${apiKey}`).then((response) =>
      mapResponseData<CmsBlog[]>(response, (blogs) => blogs.map(normalizeBlog))
    ),

  getPublicBlog: (apiKey: string, slug: string) =>
    apiClient.get<CmsBlog>(`/cms/public/${apiKey}/blogs/${slug}`).then((response) =>
      mapResponseData<CmsBlog>(response, normalizeBlog)
    ),
};
