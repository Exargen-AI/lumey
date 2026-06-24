import prisma from '../config/database';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../utils/errors';
import { slugify } from '../utils/helpers';
import { CMS_TAXONOMY_SCAN_CAP } from '../constants/listLimits';

type PublicAsset = {
  id: string | null;
  url: string;
  alt: string | null;
  caption: string | null;
  width: number | null;
  height: number | null;
  mimeType: string | null;
};

type PublicBlogListFilters = {
  apiKey: string;
  page: number;
  limit: number;
  tag?: string;
  category?: string;
  author?: string;
  search?: string;
  sort?: 'publishedAt:desc' | 'publishedAt:asc';
};

const isRecord = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizePublicUrl = (baseUrl: string, value?: string | null) => {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const normalizedBase = baseUrl.replace(/\/$/, '');
  return `${normalizedBase}${value.startsWith('/') ? value : `/${value}`}`;
};

const toTagObject = (value: string, kind: 'tag' | 'category') => {
  const slug = slugify(value);
  return {
    id: `${kind}:${slug}`,
    name: value,
    slug,
  };
};

const getMetadataNumber = (metadata: unknown, key: string) => {
  if (!isRecord(metadata) || typeof metadata[key] !== 'number') {
    return null;
  }

  return metadata[key] as number;
};

const getMetadataString = (metadata: unknown, key: string) => {
  if (!isRecord(metadata) || typeof metadata[key] !== 'string') {
    return null;
  }

  return metadata[key] as string;
};

export class CmsPublicService {
  private static async getActiveProjectByApiKey(apiKey: string) {
    // Soft-deleted projects (QA finding #33) refuse public reads. Pairs with
    // CmsService.deleteContentProject which sets isActive=false too, but the
    // explicit deletedAt filter belt-and-suspenders against any future code
    // that sets deletedAt without flipping isActive.
    const project = await prisma.cmsContentProject.findFirst({
      where: { apiKey, isActive: true, deletedAt: null },
    });

    if (!project) {
      throw new AppError(404, 'CMS_PROJECT_NOT_FOUND', 'Public CMS project not found');
    }

    return project;
  }

  private static buildPublishedWhere(projectId: string, filters?: Omit<PublicBlogListFilters, 'apiKey' | 'page' | 'limit'>) {
    const andConditions: Record<string, unknown>[] = [
      { projectId },
      { status: 'PUBLISHED' },
      {
        OR: [
          { publishedAt: null },
          { publishedAt: { lte: new Date() } },
        ],
      },
    ];

    if (filters?.tag) {
      andConditions.push({ tags: { has: filters.tag } });
    }

    if (filters?.category) {
      andConditions.push({ categories: { has: filters.category } });
    }

    if (filters?.author) {
      andConditions.push({
        OR: [
          { authorId: filters.author },
          { author: { name: { contains: filters.author, mode: 'insensitive' } } },
        ],
      });
    }

    if (filters?.search) {
      andConditions.push({
        OR: [
          { title: { contains: filters.search, mode: 'insensitive' } },
          { excerpt: { contains: filters.search, mode: 'insensitive' } },
        ],
      });
    }

    return { AND: andConditions };
  }

  private static collectAssetIdsFromValue(value: unknown, assetIds: Set<string>) {
    if (!value) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => CmsPublicService.collectAssetIdsFromValue(item, assetIds));
      return;
    }

    if (!isRecord(value)) {
      return;
    }

    const directIdCandidates = [value.id, value.assetId, value.thumbnailAssetId, value.backgroundAssetId, value.imageAssetId];
    directIdCandidates.forEach((candidate) => {
      if (typeof candidate === 'string' && candidate.trim()) {
        assetIds.add(candidate);
      }
    });

    Object.values(value).forEach((child) => CmsPublicService.collectAssetIdsFromValue(child, assetIds));
  }

  private static async getAssetMapForBlogs(projectId: string, blogs: Array<Record<string, any>>) {
    const assetIds = new Set<string>();
    blogs.forEach((blog) => {
      CmsPublicService.collectAssetIdsFromValue(blog.featuredImage, assetIds);
      CmsPublicService.collectAssetIdsFromValue(blog.seo, assetIds);
      CmsPublicService.collectAssetIdsFromValue(blog.content, assetIds);
    });

    if (assetIds.size === 0) {
      return new Map<string, any>();
    }

    const assets = await prisma.cmsMediaAsset.findMany({
      where: {
        projectId,
        id: { in: Array.from(assetIds) },
      },
    });

    return new Map(assets.map((asset) => [asset.id, asset]));
  }

  private static toPublicAsset(asset: any, baseUrl: string, fallback?: Record<string, any>): PublicAsset {
    const metadata = isRecord(asset?.metadata) ? asset.metadata : {};
    const fallbackMetadata = isRecord(fallback?.metadata) ? fallback?.metadata : {};

    return {
      id: typeof asset?.id === 'string' ? asset.id : typeof fallback?.id === 'string' ? fallback.id : null,
      url: normalizePublicUrl(baseUrl, asset?.url ?? fallback?.url) || '',
      alt:
        (typeof fallback?.alt === 'string' && fallback.alt) ||
        (typeof fallback?.altText === 'string' && fallback.altText) ||
        (typeof asset?.altText === 'string' && asset.altText) ||
        getMetadataString(metadata, 'alt') ||
        null,
      caption:
        (typeof fallback?.caption === 'string' && fallback.caption) ||
        (typeof asset?.caption === 'string' && asset.caption) ||
        null,
      width: getMetadataNumber(metadata, 'width') ?? getMetadataNumber(fallbackMetadata, 'width') ?? null,
      height: getMetadataNumber(metadata, 'height') ?? getMetadataNumber(fallbackMetadata, 'height') ?? null,
      mimeType:
        (typeof asset?.mimeType === 'string' && asset.mimeType) ||
        (typeof fallback?.mimeType === 'string' && fallback.mimeType) ||
        getMetadataString(metadata, 'mimeType') ||
        null,
    };
  }

  private static resolveAssetReference(reference: unknown, assetMap: Map<string, any>, baseUrl: string) {
    if (!reference) {
      return null;
    }

    if (typeof reference === 'string') {
      if (assetMap.has(reference)) {
        return CmsPublicService.toPublicAsset(assetMap.get(reference), baseUrl);
      }

      const url = normalizePublicUrl(baseUrl, reference);
      return url
        ? {
            id: null,
            url,
            alt: null,
            caption: null,
            width: null,
            height: null,
            mimeType: null,
          }
        : null;
    }

    if (!isRecord(reference)) {
      return null;
    }

    const candidateId =
      typeof reference.id === 'string' && assetMap.has(reference.id)
        ? reference.id
        : typeof reference.assetId === 'string' && assetMap.has(reference.assetId)
          ? reference.assetId
          : typeof reference.imageAssetId === 'string' && assetMap.has(reference.imageAssetId)
            ? reference.imageAssetId
            : typeof reference.backgroundAssetId === 'string' && assetMap.has(reference.backgroundAssetId)
              ? reference.backgroundAssetId
              : typeof reference.thumbnailAssetId === 'string' && assetMap.has(reference.thumbnailAssetId)
                ? reference.thumbnailAssetId
                : null;

    if (candidateId) {
      return CmsPublicService.toPublicAsset(assetMap.get(candidateId), baseUrl, reference);
    }

    if (typeof reference.url === 'string' && reference.url) {
      return CmsPublicService.toPublicAsset(
        {
          id: typeof reference.id === 'string' ? reference.id : null,
          url: reference.url,
          altText: reference.alt ?? reference.altText ?? null,
          caption: reference.caption ?? null,
          mimeType: reference.mimeType ?? null,
          metadata: {
            width: typeof reference.width === 'number' ? reference.width : null,
            height: typeof reference.height === 'number' ? reference.height : null,
          },
        },
        baseUrl
      );
    }

    return null;
  }

  private static normalizeMediaStringUrl(value: unknown, baseUrl: string) {
    if (typeof value !== 'string') {
      return value;
    }

    if (value.startsWith('/uploads/') || /^https?:\/\//i.test(value)) {
      return normalizePublicUrl(baseUrl, value);
    }

    return value;
  }

  private static normalizeBlock(block: Record<string, any>, assetMap: Map<string, any>, baseUrl: string) {
    const data = isRecord(block.data) ? { ...block.data } : {};

    switch (block.type) {
      case 'image': {
        const asset = CmsPublicService.resolveAssetReference(data.asset ?? data.assetId ?? data.url, assetMap, baseUrl);
        return {
          id: block.id,
          type: block.type,
          data: {
            ...data,
            asset,
            url: asset?.url ?? CmsPublicService.normalizeMediaStringUrl(data.url, baseUrl),
            alt: data.alt ?? asset?.alt ?? null,
            caption: data.caption ?? asset?.caption ?? null,
          },
        };
      }
      case 'video': {
        const asset = CmsPublicService.resolveAssetReference(data.asset ?? data.assetId ?? data.url, assetMap, baseUrl);
        return {
          id: block.id,
          type: block.type,
          data: {
            ...data,
            asset,
            url: asset?.url ?? CmsPublicService.normalizeMediaStringUrl(data.url, baseUrl),
            poster: CmsPublicService.resolveAssetReference(data.poster ?? data.thumbnailAssetId, assetMap, baseUrl),
          },
        };
      }
      case 'gallery': {
        const images = Array.isArray(data.images)
          ? data.images.map((image: unknown) => {
              const asset = CmsPublicService.resolveAssetReference(image, assetMap, baseUrl);
              const imageRecord = isRecord(image) ? image : {};
              return {
                ...imageRecord,
                asset,
                url: asset?.url ?? CmsPublicService.normalizeMediaStringUrl(imageRecord.url, baseUrl),
                alt: imageRecord.alt ?? asset?.alt ?? null,
                caption: imageRecord.caption ?? asset?.caption ?? null,
              };
            })
          : [];

        return {
          id: block.id,
          type: block.type,
          data: {
            ...data,
            images,
          },
        };
      }
      case 'hero': {
        const backgroundAsset = CmsPublicService.resolveAssetReference(
          data.backgroundAsset ?? data.backgroundAssetId ?? data.assetId ?? data.backgroundImage,
          assetMap,
          baseUrl
        );
        return {
          id: block.id,
          type: block.type,
          data: {
            ...data,
            backgroundAsset,
            backgroundImage: backgroundAsset?.url ?? CmsPublicService.normalizeMediaStringUrl(data.backgroundImage, baseUrl),
          },
        };
      }
      case 'team': {
        const members = Array.isArray(data.members)
          ? data.members.map((member: unknown) => {
              const memberRecord = isRecord(member) ? member : {};
              const imageAsset = CmsPublicService.resolveAssetReference(
                memberRecord.imageAsset ?? memberRecord.imageAssetId ?? memberRecord.image,
                assetMap,
                baseUrl
              );
              return {
                ...memberRecord,
                image: imageAsset?.url ?? CmsPublicService.normalizeMediaStringUrl(memberRecord.image, baseUrl),
                imageAsset,
              };
            })
          : [];

        return {
          id: block.id,
          type: block.type,
          data: {
            ...data,
            members,
          },
        };
      }
      case 'embed': {
        const previewAsset = CmsPublicService.resolveAssetReference(
          data.previewAsset ?? data.thumbnailAssetId,
          assetMap,
          baseUrl
        );
        return {
          id: block.id,
          type: block.type,
          data: {
            ...data,
            previewAsset,
          },
        };
      }
      default:
        return {
          id: block.id,
          type: block.type,
          data: Object.fromEntries(
            Object.entries(data).map(([key, value]) => [key, CmsPublicService.normalizeMediaStringUrl(value, baseUrl)])
          ),
        };
    }
  }

  private static normalizeSeo(seo: unknown, assetMap: Map<string, any>, baseUrl: string) {
    if (!isRecord(seo)) {
      return {
        title: null,
        description: null,
        keywords: [],
        ogImage: null,
        canonicalUrl: null,
      };
    }

    return {
      title: typeof seo.title === 'string' ? seo.title : null,
      description: typeof seo.description === 'string' ? seo.description : null,
      keywords: Array.isArray(seo.keywords) ? seo.keywords.filter((keyword): keyword is string => typeof keyword === 'string') : [],
      ogImage: CmsPublicService.resolveAssetReference(seo.ogImage, assetMap, baseUrl),
      canonicalUrl: typeof seo.canonicalUrl === 'string' ? seo.canonicalUrl : null,
    };
  }

  private static normalizePublicBlog(blog: Record<string, any>, assetMap: Map<string, any>, baseUrl: string) {
    const featuredImage = CmsPublicService.resolveAssetReference(blog.featuredImage, assetMap, baseUrl);
    return {
      id: blog.id,
      title: blog.title,
      slug: blog.slug,
      excerpt: blog.excerpt ?? null,
      publishedAt: blog.publishedAt ?? null,
      status: blog.status,
      author: blog.author
        ? {
            id: blog.author.id,
            name: blog.author.name,
          }
        : null,
      tags: Array.isArray(blog.tags) ? blog.tags.map((tag: string) => toTagObject(tag, 'tag')) : [],
      categories: Array.isArray(blog.categories)
        ? blog.categories.map((category: string) => toTagObject(category, 'category'))
        : [],
      featuredImage,
      seo: CmsPublicService.normalizeSeo(blog.seo, assetMap, baseUrl),
      content: Array.isArray(blog.content)
        ? blog.content.map((block: unknown) =>
            isRecord(block)
              ? CmsPublicService.normalizeBlock(block, assetMap, baseUrl)
              : {
                  id: `block-${Math.random().toString(36).slice(2)}`,
                  type: 'unknown',
                  data: {},
                }
          )
        : [],
    };
  }

  private static async getPublicBlogModels(projectId: string, filters: Omit<PublicBlogListFilters, 'apiKey'>) {
    const where = CmsPublicService.buildPublishedWhere(projectId, filters);
    const skip = (filters.page - 1) * filters.limit;
    const orderBy = filters.sort === 'publishedAt:asc'
      ? [{ publishedAt: 'asc' as const }, { createdAt: 'asc' as const }]
      : [{ publishedAt: 'desc' as const }, { createdAt: 'desc' as const }];

    const [total, blogs] = await Promise.all([
      prisma.cmsBlog.count({ where }),
      prisma.cmsBlog.findMany({
        where,
        skip,
        take: filters.limit,
        include: {
          author: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy,
      }),
    ]);

    return { total, blogs };
  }

  static async getPublicBlogs(filters: PublicBlogListFilters, baseUrl: string) {
    const project = await CmsPublicService.getActiveProjectByApiKey(filters.apiKey);
    const { total, blogs } = await CmsPublicService.getPublicBlogModels(project.id, filters);
    const assetMap = await CmsPublicService.getAssetMapForBlogs(project.id, blogs as unknown as Array<Record<string, any>>);
    const normalizedBlogs = blogs.map((blog) =>
      CmsPublicService.normalizePublicBlog(blog as unknown as Record<string, any>, assetMap, baseUrl)
    );

    return {
      data: normalizedBlogs,
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / filters.limit)),
      },
    };
  }

  static async getPublicBlogBySlug(apiKey: string, slug: string, baseUrl: string) {
    const project = await CmsPublicService.getActiveProjectByApiKey(apiKey);
    const matchedBlog = await prisma.cmsBlog.findFirst({
      where: {
        AND: [...(CmsPublicService.buildPublishedWhere(project.id, {}).AND as Record<string, unknown>[]), { slug }],
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!matchedBlog) {
      throw new AppError(404, 'BLOG_NOT_FOUND', 'Blog not found');
    }

    const assetMap = await CmsPublicService.getAssetMapForBlogs(project.id, [matchedBlog as unknown as Record<string, any>]);
    return CmsPublicService.normalizePublicBlog(matchedBlog as unknown as Record<string, any>, assetMap, baseUrl);
  }

  static async getPublicBlogById(apiKey: string, id: string, baseUrl: string) {
    const project = await CmsPublicService.getActiveProjectByApiKey(apiKey);
    const blog = await prisma.cmsBlog.findFirst({
      where: {
        AND: [...(CmsPublicService.buildPublishedWhere(project.id, {}).AND as Record<string, unknown>[]), { id }],
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!blog) {
      throw new AppError(404, 'BLOG_NOT_FOUND', 'Blog not found');
    }

    const assetMap = await CmsPublicService.getAssetMapForBlogs(project.id, [blog as unknown as Record<string, any>]);
    return CmsPublicService.normalizePublicBlog(blog as unknown as Record<string, any>, assetMap, baseUrl);
  }

  static async getPublicAsset(id: string, baseUrl: string, apiKey?: string) {
    const asset = await prisma.cmsMediaAsset.findFirst({
      where: { id },
      include: {
        project: true,
      },
    });

    if (!asset || !asset.project.isActive) {
      throw new AppError(404, 'ASSET_NOT_FOUND', 'Asset not found');
    }

    if (apiKey && asset.project.apiKey !== apiKey) {
      throw new AppError(404, 'ASSET_NOT_FOUND', 'Asset not found');
    }

    return CmsPublicService.toPublicAsset(asset, baseUrl);
  }

  static async getPublicTaxonomy(apiKey: string, kind: 'tags' | 'categories' | 'authors') {
    const project = await CmsPublicService.getActiveProjectByApiKey(apiKey);
    const blogs = await prisma.cmsBlog.findMany({
      where: CmsPublicService.buildPublishedWhere(project.id, {}),
      select: {
        tags: true,
        categories: true,
        author: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      // 2026-06-01 hardening — bound this public (API-key) scan. Aggregate
      // the tag/category/author facets over the most-recent N published
      // posts rather than the entire (unbounded, attacker-influenceable)
      // history. Accurate for any realistic content volume; caps memory.
      orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      take: CMS_TAXONOMY_SCAN_CAP,
    });

    if (kind === 'authors') {
      const authorMap = new Map<string, { id: string; name: string; count: number }>();
      blogs.forEach((blog) => {
        if (!blog.author) return;
        const existing = authorMap.get(blog.author.id);
        authorMap.set(blog.author.id, {
          id: blog.author.id,
          name: blog.author.name,
          count: (existing?.count ?? 0) + 1,
        });
      });
      return Array.from(authorMap.values());
    }

    const values = new Map<string, { id: string; name: string; slug: string; count: number }>();
    blogs.forEach((blog) => {
      const items = kind === 'tags' ? blog.tags : blog.categories;
      items.forEach((value) => {
        const slug = slugify(value);
        const key = `${kind}:${slug}`;
        const existing = values.get(key);
        values.set(key, {
          id: key,
          name: value,
          slug,
          count: (existing?.count ?? 0) + 1,
        });
      });
    });

    return Array.from(values.values());
  }

  static async assertUniqueBlogSlug(projectId: string, slug: string, excludeId?: string) {
    const existing = await prisma.cmsBlog.findFirst({
      where: {
        projectId,
        slug,
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictError('Slug already exists for this project');
    }
  }

  static validateContentBlocks(content: unknown) {
    const supportedBlocks = new Set([
      'header',
      'paragraph',
      'image',
      'video',
      'quote',
      'list',
      'code',
      'embed',
      'button',
      'gallery',
      'hero',
      'stats',
      'pricing',
      'team',
      'contact',
    ]);

    if (!Array.isArray(content)) {
      throw new ValidationError('Content must be an array of blocks');
    }

    content.forEach((block, index) => {
      if (!isRecord(block)) {
        throw new ValidationError(`Content block ${index + 1} is invalid`);
      }

      if (typeof block.id !== 'string' || !block.id.trim()) {
        throw new ValidationError(`Content block ${index + 1} must include an id`);
      }

      if (typeof block.type !== 'string' || !supportedBlocks.has(block.type)) {
        throw new ValidationError(`Content block ${index + 1} has unsupported type`);
      }

      if (!isRecord(block.data)) {
        throw new ValidationError(`Content block ${index + 1} must include block data`);
      }
    });
  }

  static validatePublishableBlog(data: {
    title?: string;
    slug?: string;
    excerpt?: string;
    content?: unknown;
    featuredImage?: unknown;
  }) {
    if (!data.title?.trim()) {
      throw new ValidationError('Title is required before publishing');
    }

    if (!data.slug?.trim()) {
      throw new ValidationError('Slug is required before publishing');
    }

    if (data.excerpt && data.excerpt.length > 320) {
      throw new ValidationError('Excerpt must be 320 characters or less');
    }

    CmsPublicService.validateContentBlocks(data.content ?? []);
  }
}
