import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { CmsPublicService } from '../services/cmsPublic.service';
import { CmsService } from '../services/cmsService';

const blogStatusSchema = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']);
const templateTypeSchema = z.enum(['ARTICLE', 'TUTORIAL', 'NEWS', 'CASE_STUDY', 'ANNOUNCEMENT']);

type UploadedFile = {
  filename: string;
  originalname: string;
  mimetype: string;
  size: number;
};

type UploadedFilePayload = {
  originalName: string;
  mimeType: string;
  size: number;
  contentBase64: string;
};

const parsePublishedAt = (value?: string) => {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const getPublicBaseUrl = (req: Request) => {
  if (env.CMS_PUBLIC_BASE_URL) {
    return env.CMS_PUBLIC_BASE_URL;
  }

  const forwardedProto = req.headers['x-forwarded-proto'];
  const protocol =
    typeof forwardedProto === 'string' && forwardedProto.length > 0
      ? forwardedProto.split(',')[0]
      : req.protocol;

  return `${protocol}://${req.get('host')}`;
};

export const createContentProject = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      name: z.string().trim().min(1),
      description: z.string().optional(),
      domain: z.string().optional(),
    });

    const data = schema.parse(req.body);
    const project = await CmsService.createContentProject(data);

    res.json({ success: true, data: project });
  } catch (error) {
    next(error);
  }
};

export const getContentProjects = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const projects = await CmsService.getContentProjects();
    res.json({ success: true, data: projects });
  } catch (error) {
    next(error);
  }
};

export const getContentProject = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const project = await CmsService.getContentProject(id);

    if (!project) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }

    res.json({ success: true, data: project });
  } catch (error) {
    next(error);
  }
};

export const updateContentProject = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const schema = z.object({
      name: z.string().trim().min(1).optional(),
      description: z.string().optional(),
      domain: z.string().optional(),
      isActive: z.boolean().optional(),
      apiKeyScopes: z.array(z.string()).optional(),
    });

    const data = schema.parse(req.body);
    const project = await CmsService.updateContentProject(id, data);

    res.json({ success: true, data: project });
  } catch (error) {
    next(error);
  }
};

export const deleteContentProject = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    await CmsService.deleteContentProject(id, req.user?.id);

    res.json({ success: true, message: 'Project deleted successfully' });
  } catch (error) {
    next(error);
  }
};

export const regenerateApiKey = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const project = await CmsService.regenerateApiKey(id, req.user?.id);

    res.json({ success: true, data: project });
  } catch (error) {
    next(error);
  }
};

export const createTemplate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId } = req.params;
    const schema = z.object({
      name: z.string().trim().min(1),
      type: templateTypeSchema,
      description: z.string().optional(),
      structure: z.any().optional(),
    });

    const parsedData = schema.parse(req.body);
    const template = await CmsService.createTemplate({
      ...parsedData,
      projectId,
      structure: parsedData.structure ?? [],
    });

    res.json({ success: true, data: template });
  } catch (error) {
    next(error);
  }
};

export const getTemplates = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId } = req.params;
    const templates = await CmsService.getTemplates(projectId);

    res.json({ success: true, data: templates });
  } catch (error) {
    next(error);
  }
};

export const getTemplate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const template = await CmsService.getTemplate(id);

    if (!template) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    res.json({ success: true, data: template });
  } catch (error) {
    next(error);
  }
};

export const updateTemplate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const schema = z.object({
      name: z.string().trim().min(1).optional(),
      type: templateTypeSchema.optional(),
      description: z.string().optional(),
      structure: z.any().optional(),
      isActive: z.boolean().optional(),
    });

    const data = schema.parse(req.body);
    const template = await CmsService.updateTemplate(id, data);

    res.json({ success: true, data: template });
  } catch (error) {
    next(error);
  }
};

export const deleteTemplate = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    await CmsService.deleteTemplate(id, req.user?.id);

    res.json({ success: true, message: 'Template deleted successfully' });
  } catch (error) {
    next(error);
  }
};

export const createBlog = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId } = req.params;
    const schema = z.object({
      templateId: z.string().uuid().nullable().optional(),
      title: z.string().trim().min(1),
      slug: z.string().trim().min(1).optional(),
      excerpt: z.string().max(320).optional(),
      content: z.any().optional(),
      featuredImage: z.any().optional(),
      seo: z.any().optional(),
      tags: z.array(z.string()).optional(),
      categories: z.array(z.string()).optional(),
      status: blogStatusSchema.optional(),
      publishedAt: z.string().optional(),
    });

    const parsedData = schema.parse(req.body);
    const blog = await CmsService.createBlog({
      ...parsedData,
      projectId,
      authorId: req.user!.id,
      content: parsedData.content ?? [],
      publishedAt: parsePublishedAt(parsedData.publishedAt),
    });

    res.json({ success: true, data: blog });
  } catch (error) {
    next(error);
  }
};

export const getBlogs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId } = req.params;
    const querySchema = z.object({
      status: blogStatusSchema.optional(),
    });

    const { status } = querySchema.parse(req.query);
    const blogs = await CmsService.getBlogs(projectId, status);

    res.json({ success: true, data: blogs });
  } catch (error) {
    next(error);
  }
};

export const getBlog = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const blog = await CmsService.getBlog(id);

    if (!blog) {
      return res.status(404).json({ success: false, error: 'Blog not found' });
    }

    res.json({ success: true, data: blog });
  } catch (error) {
    next(error);
  }
};

export const updateBlog = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const schema = z.object({
      title: z.string().trim().min(1).optional(),
      slug: z.string().trim().min(1).optional(),
      excerpt: z.string().max(320).optional(),
      content: z.any().optional(),
      templateId: z.string().uuid().nullable().optional(),
      featuredImage: z.any().optional(),
      seo: z.any().optional(),
      tags: z.array(z.string()).optional(),
      categories: z.array(z.string()).optional(),
      status: blogStatusSchema.optional(),
      publishedAt: z.string().nullable().optional(),
    });

    const parsedData = schema.parse(req.body);
    const blog = await CmsService.updateBlog(id, {
      ...parsedData,
      publishedAt: parsedData.publishedAt === null ? null : parsePublishedAt(parsedData.publishedAt),
    });

    res.json({ success: true, data: blog });
  } catch (error) {
    next(error);
  }
};

export const deleteBlog = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    await CmsService.deleteBlog(id, req.user?.id);

    res.json({ success: true, message: 'Blog deleted successfully' });
  } catch (error) {
    next(error);
  }
};

export const getPublicBlogs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      apiKey: z.string().trim().min(1),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(10),
      tag: z.string().trim().min(1).optional(),
      category: z.string().trim().min(1).optional(),
      author: z.string().trim().min(1).optional(),
      search: z.string().trim().min(1).optional(),
      sort: z.enum(['publishedAt:desc', 'publishedAt:asc']).default('publishedAt:desc'),
    });

    const query = schema.parse(req.query);
    const result = await CmsPublicService.getPublicBlogs(query, getPublicBaseUrl(req));
    res.json({ success: true, data: result.data, pagination: result.pagination });
  } catch (error: any) {
    res.status(error?.statusCode || 400).json({
      success: false,
      error: {
        code: error?.code || 'PUBLIC_BLOG_LIST_FAILED',
        message: error?.message || 'Failed to fetch blogs',
      },
    });
  }
};

export const getPublicBlog = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { apiKey, slug } = req.params;
    const blog = await CmsPublicService.getPublicBlogBySlug(apiKey, slug, getPublicBaseUrl(req));
    res.json({ success: true, data: blog });
  } catch (error: any) {
    res.status(error?.statusCode || 400).json({
      success: false,
      error: {
        code: error?.code || 'PUBLIC_BLOG_FETCH_FAILED',
        message: error?.message || 'Failed to fetch blog',
      },
    });
  }
};

export const getPublicBlogById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { apiKey, id } = req.params;
    const blog = await CmsPublicService.getPublicBlogById(apiKey, id, getPublicBaseUrl(req));
    res.json({ success: true, data: blog });
  } catch (error: any) {
    res.status(error?.statusCode || 400).json({
      success: false,
      error: {
        code: error?.code || 'PUBLIC_BLOG_FETCH_FAILED',
        message: error?.message || 'Failed to fetch blog',
      },
    });
  }
};

export const getPublicAuthors = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      apiKey: z.string().trim().min(1),
    });
    const { apiKey } = schema.parse(req.query);
    const authors = await CmsPublicService.getPublicTaxonomy(apiKey, 'authors');
    res.json({ success: true, data: authors });
  } catch (error: any) {
    res.status(error?.statusCode || 400).json({
      success: false,
      error: {
        code: error?.code || 'PUBLIC_AUTHORS_FETCH_FAILED',
        message: error?.message || 'Failed to fetch authors',
      },
    });
  }
};

export const getPublicTags = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      apiKey: z.string().trim().min(1),
    });
    const { apiKey } = schema.parse(req.query);
    const tags = await CmsPublicService.getPublicTaxonomy(apiKey, 'tags');
    res.json({ success: true, data: tags });
  } catch (error: any) {
    res.status(error?.statusCode || 400).json({
      success: false,
      error: {
        code: error?.code || 'PUBLIC_TAGS_FETCH_FAILED',
        message: error?.message || 'Failed to fetch tags',
      },
    });
  }
};

export const getPublicCategories = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const schema = z.object({
      apiKey: z.string().trim().min(1),
    });
    const { apiKey } = schema.parse(req.query);
    const categories = await CmsPublicService.getPublicTaxonomy(apiKey, 'categories');
    res.json({ success: true, data: categories });
  } catch (error: any) {
    res.status(error?.statusCode || 400).json({
      success: false,
      error: {
        code: error?.code || 'PUBLIC_CATEGORIES_FETCH_FAILED',
        message: error?.message || 'Failed to fetch categories',
      },
    });
  }
};

export const getPublicAsset = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const apiKey = typeof req.query.apiKey === 'string' ? req.query.apiKey : undefined;
    const asset = await CmsPublicService.getPublicAsset(id, getPublicBaseUrl(req), apiKey);
    res.json({ success: true, data: asset });
  } catch (error: any) {
    res.status(error?.statusCode || 400).json({
      success: false,
      error: {
        code: error?.code || 'PUBLIC_ASSET_FETCH_FAILED',
        message: error?.message || 'Failed to fetch asset',
      },
    });
  }
};

export const getMediaAssets = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId } = req.params;
    const assets = await CmsService.getMediaAssets(projectId);
    res.json({ success: true, data: assets });
  } catch (error) {
    next(error);
  }
};

export const uploadMedia = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId } = req.params;
    const files = (req as Request & { files?: UploadedFile[] }).files;
    const jsonSchema = z.object({
      files: z.array(
        z.object({
          originalName: z.string().min(1),
          mimeType: z.string().min(1),
          size: z.number().int().nonnegative(),
          contentBase64: z.string().min(1),
        })
      ).min(1),
    });

    if (Array.isArray((req.body as any)?.files)) {
      const payload = jsonSchema.parse(req.body);
      const assets = await CmsService.uploadMedia(projectId, payload.files as UploadedFilePayload[]);
      return res.json({ success: true, data: assets });
    }

    if (!Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files uploaded' });
    }

    const assets = await CmsService.uploadMedia(projectId, files as any);
    res.json({ success: true, data: assets });
  } catch (error) {
    next(error);
  }
};

export const deleteMedia = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { projectId, assetId } = req.params;
    await CmsService.deleteMedia(projectId, assetId);
    res.json({ success: true, message: 'Media asset deleted successfully' });
  } catch (error) {
    next(error);
  }
};
