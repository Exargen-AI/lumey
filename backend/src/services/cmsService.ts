import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { writeFile } from 'fs/promises';
import path from 'path';
import prisma from '../config/database';
import { CmsPublicService } from './cmsPublic.service';
import { generateApiKey } from '../utils/crypto';
import { slugify } from '../utils/helpers';

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

const toJsonValue = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const toNullableJsonValue = (
  value: unknown
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined =>
  value === undefined ? undefined : (value as Prisma.InputJsonValue);

const isMissingCmsMediaAssetsTableError = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2021' &&
  typeof error.meta?.table === 'string' &&
  error.meta.table.includes('cms_media_assets');

const isMissingCmsBlogColumnError = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2022' &&
  typeof error.meta?.column === 'string' &&
  error.meta.column.includes('cms_blogs.');

export class CmsService {
  private static cmsMediaAssetsTableExists: boolean | null = null;
  private static cmsBlogExtendedColumnsExist: boolean | null = null;

  private static normalizeOptionalString(value?: string) {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
  }

  private static async hasCmsMediaAssetsTable() {
    if (CmsService.cmsMediaAssetsTableExists !== null) {
      return CmsService.cmsMediaAssetsTableExists;
    }

    const result = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'cms_media_assets'
      ) AS "exists"
    `;

    CmsService.cmsMediaAssetsTableExists = result[0]?.exists ?? false;
    return CmsService.cmsMediaAssetsTableExists;
  }

  private static async hasCmsBlogExtendedColumns() {
    if (CmsService.cmsBlogExtendedColumnsExist !== null) {
      return CmsService.cmsBlogExtendedColumnsExist;
    }

    const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'cms_blogs'
        AND column_name IN ('featuredImage', 'seo', 'tags', 'categories')
    `;

    CmsService.cmsBlogExtendedColumnsExist = rows.length === 4;
    return CmsService.cmsBlogExtendedColumnsExist;
  }

  private static withLegacyBlogDefaults<T extends Record<string, unknown>>(blog: T) {
    return {
      ...blog,
      featuredImage: (blog.featuredImage as unknown) ?? undefined,
      seo: (blog.seo as unknown) ?? undefined,
      tags: Array.isArray(blog.tags) ? blog.tags : [],
      categories: Array.isArray(blog.categories) ? blog.categories : [],
    };
  }

  private static legacyBlogSelect = {
    id: true,
    projectId: true,
    templateId: true,
    title: true,
    slug: true,
    excerpt: true,
    content: true,
    status: true,
    authorId: true,
    publishedAt: true,
    createdAt: true,
    updatedAt: true,
    author: {
      select: {
        id: true,
        name: true,
        email: true,
      },
    },
    template: true,
    project: true,
  } as const;

  private static sanitizeFilenamePart(value: string) {
    return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-');
  }

  private static extensionFromNameOrMime(originalName: string, mimeType: string) {
    const explicitExt = path.extname(originalName);
    if (explicitExt) {
      return explicitExt.toLowerCase();
    }

    const mimeMap: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'image/svg+xml': '.svg',
      'video/mp4': '.mp4',
      'application/pdf': '.pdf',
      'application/msword': '.doc',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
    };

    return mimeMap[mimeType] || '';
  }

  private static async persistUploadedFile(file: UploadedFile | UploadedFilePayload) {
    if ('filename' in file) {
      return {
        filename: file.filename,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
      };
    }

    const extension = CmsService.extensionFromNameOrMime(file.originalName, file.mimeType);
    const baseName = CmsService.sanitizeFilenamePart(path.basename(file.originalName, extension) || 'upload');
    const filename = `${Date.now()}-${randomUUID()}-${baseName}${extension}`;
    const outputPath = path.resolve(process.cwd(), 'uploads', 'cms', filename);
    const content = file.contentBase64.includes(',')
      ? file.contentBase64.split(',').pop() || ''
      : file.contentBase64;

    await writeFile(outputPath, Buffer.from(content, 'base64'));

    return {
      filename,
      originalName: file.originalName,
      mimeType: file.mimeType,
      size: file.size,
    };
  }

  private static async getLegacyBlogById(id: string) {
    const blog = await prisma.cmsBlog.findUnique({
      where: { id },
      select: CmsService.legacyBlogSelect,
    });

    return blog ? CmsService.withLegacyBlogDefaults(blog) : null;
  }

  private static async createLegacyBlog(data: {
    projectId: string;
    authorId: string;
    templateId?: string | null;
    title: string;
    slug: string;
    excerpt?: string;
    content: unknown;
    status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
    publishedAt?: Date | null;
  }) {
    const id = randomUUID();

    await prisma.$executeRaw`
      INSERT INTO "cms_blogs" (
        "id",
        "projectId",
        "templateId",
        "title",
        "slug",
        "excerpt",
        "content",
        "status",
        "authorId",
        "publishedAt",
        "updatedAt"
      )
      VALUES (
        ${id},
        ${data.projectId},
        ${data.templateId ?? null},
        ${data.title},
        ${data.slug},
        ${data.excerpt ?? null},
        CAST(${JSON.stringify(data.content ?? [])} AS jsonb),
        CAST(${data.status} AS "CmsBlogStatus"),
        ${data.authorId},
        ${data.publishedAt ?? null},
        ${new Date()}
      )
    `;

    return CmsService.getLegacyBlogById(id);
  }

  private static async updateLegacyBlog(
    id: string,
    data: {
      title?: string;
      slug?: string;
      excerpt?: string;
      content?: unknown;
      templateId?: string | null;
      status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
      publishedAt?: Date | null;
    }
  ) {
    const existing = await prisma.cmsBlog.findUnique({
      where: { id },
      select: {
        id: true,
        templateId: true,
        title: true,
        slug: true,
        excerpt: true,
        content: true,
        status: true,
        publishedAt: true,
      },
    });

    if (!existing) {
      throw new Error('Blog not found');
    }

    const nextTemplateId = Object.prototype.hasOwnProperty.call(data, 'templateId') ? data.templateId ?? null : existing.templateId;
    const nextTitle = data.title ?? existing.title;
    const nextSlug = data.slug ?? existing.slug;
    const nextExcerpt = Object.prototype.hasOwnProperty.call(data, 'excerpt') ? data.excerpt ?? null : existing.excerpt;
    const nextContent = Object.prototype.hasOwnProperty.call(data, 'content') ? data.content ?? existing.content : existing.content;
    const nextStatus = data.status ?? existing.status;
    const nextPublishedAt =
      Object.prototype.hasOwnProperty.call(data, 'publishedAt') || data.status
        ? data.publishedAt ?? null
        : existing.publishedAt;

    await prisma.$executeRaw`
      UPDATE "cms_blogs"
      SET
        "templateId" = ${nextTemplateId},
        "title" = ${nextTitle},
        "slug" = ${nextSlug},
        "excerpt" = ${nextExcerpt},
        "content" = CAST(${JSON.stringify(nextContent ?? [])} AS jsonb),
        "status" = CAST(${nextStatus} AS "CmsBlogStatus"),
        "publishedAt" = ${nextPublishedAt},
        "updatedAt" = ${new Date()}
      WHERE "id" = ${id}
    `;

    return CmsService.getLegacyBlogById(id);
  }

  // Best-effort uniqueness *probe* — the only race-safe contract is the DB
  // unique constraint. Pre-checking lets us return a friendly suffix
  // ("foo-2") most of the time; concurrent creates surface as P2002 inside
  // `withCmsSlugRetry`, which then bumps the suffix and retries.
  private static async generateUniqueProjectSlug(name: string, excludeId?: string) {
    const baseSlug = slugify(name) || 'cms-project';
    let slug = baseSlug;
    let suffix = 1;

    while (true) {
      const existingProject = await prisma.cmsContentProject.findFirst({
        where: {
          slug,
          ...(excludeId ? { NOT: { id: excludeId } } : {}),
        },
        select: { id: true },
      });

      if (!existingProject) {
        return slug;
      }

      suffix += 1;
      slug = `${baseSlug}-${suffix}`;
    }
  }

  private static async generateUniqueTemplateSlug(projectId: string, name: string, excludeId?: string) {
    const baseSlug = slugify(name) || 'template';
    let slug = baseSlug;
    let suffix = 1;

    while (true) {
      const existingTemplate = await prisma.cmsTemplate.findFirst({
        where: {
          projectId,
          slug,
          ...(excludeId ? { NOT: { id: excludeId } } : {}),
        },
        select: { id: true },
      });

      if (!existingTemplate) {
        return slug;
      }

      suffix += 1;
      slug = `${baseSlug}-${suffix}`;
    }
  }

  /**
   * Race-safe wrapper: runs `op(slug)` and on Prisma P2002 (unique violation)
   * bumps the slug suffix and retries up to MAX_ATTEMPTS times. Closes the
   * TOCTOU window between `generateUnique*Slug` and the actual create when
   * two concurrent calls compute the same suffix (QA findings #15, #16).
   */
  private static async withCmsSlugRetry<T>(
    initialSlug: string,
    op: (slug: string) => Promise<T>,
    targetField: 'slug' = 'slug',
  ): Promise<T> {
    const MAX_ATTEMPTS = 8;
    // We separate the base from any incumbent "-N" suffix so we keep growing
    // numerically rather than appending nested suffixes ("foo-2-2-2").
    // Input is a slug (bounded to ≤50 chars by validator), so the lazy
    // quantifier can't backtrack catastrophically.
    // eslint-disable-next-line security/detect-unsafe-regex
    const m = initialSlug.match(/^(.*?)(?:-(\d+))?$/);
    const base = m?.[1] ?? initialSlug;
    let n = m?.[2] ? Number.parseInt(m[2], 10) : 1;
    let candidate = initialSlug;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        return await op(candidate);
      } catch (err) {
        const isUnique =
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          (err.meta?.target as string[] | string | undefined) !== undefined;
        const targets = (err as any)?.meta?.target;
        const hitsSlug = Array.isArray(targets) ? targets.includes(targetField) : targets === targetField;
        if (!isUnique || !hitsSlug || attempt === MAX_ATTEMPTS - 1) {
          throw err;
        }
        n += 1;
        candidate = `${base}-${n}`;
      }
    }
    // Unreachable because the loop either returns or throws.
    throw new Error('Failed to allocate a unique CMS slug.');
  }

  /**
   * Converts a Prisma P2002 from a blog create into the same ConflictError
   * the up-front assertion throws, so the API surface stays consistent
   * whether the collision was caught at probe time or at insert time.
   */
  private static toBlogSlugConflict(err: unknown) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Lazy-import to avoid circular module init between cmsService and
      // the shared errors module. Dynamic `import()` would force this
      // function async — callers aren't ready for that change today.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { ConflictError } = require('../utils/errors');
      return new ConflictError('Slug already exists for this project');
    }
    return err;
  }

  static async createContentProject(data: {
    name: string;
    description?: string;
    domain?: string;
  }) {
    const name = data.name.trim();
    const baseSlug = await CmsService.generateUniqueProjectSlug(name);
    const apiKey = generateApiKey();

    const project = await CmsService.withCmsSlugRetry(baseSlug, (slug) =>
      prisma.cmsContentProject.create({
        data: {
          name,
          slug,
          description: CmsService.normalizeOptionalString(data.description),
          domain: CmsService.normalizeOptionalString(data.domain),
          apiKey,
        },
      }),
    );

    return {
      ...project,
      _count: {
        blogs: 0,
        templates: 0,
        mediaAssets: (await CmsService.hasCmsMediaAssetsTable()) ? 0 : 0,
      },
    };
  }

  static async getContentProjects() {
    if (!(await CmsService.hasCmsMediaAssetsTable())) {
      const projects = await prisma.cmsContentProject.findMany({
        // Filter soft-deleted (QA finding #33). All read paths exclude
        // tombstoned projects; restoration is a manual SQL touch.
        where: { deletedAt: null },
        include: {
          _count: {
            select: {
              blogs: true,
              templates: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return projects.map((project) => ({
        ...project,
        _count: {
          ...project._count,
          mediaAssets: 0,
        },
      }));
    }

    try {
      return await prisma.cmsContentProject.findMany({
        where: { deletedAt: null },
        include: {
          _count: {
            select: {
              blogs: true,
              templates: true,
              mediaAssets: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });
    } catch (error) {
      if (!isMissingCmsMediaAssetsTableError(error)) {
        throw error;
      }

      const projects = await prisma.cmsContentProject.findMany({
        where: { deletedAt: null },
        include: {
          _count: {
            select: {
              blogs: true,
              templates: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      return projects.map((project) => ({
        ...project,
        _count: {
          ...project._count,
          mediaAssets: 0,
        },
      }));
    }
  }

  static async getContentProject(id: string) {
    if (!(await CmsService.hasCmsMediaAssetsTable())) {
      // findFirst+filter rather than findUnique so soft-deleted projects
      // surface as "not found" the same way hard-deletes used to.
      const project = await prisma.cmsContentProject.findFirst({
        where: { id, deletedAt: null },
        include: {
          templates: {
            orderBy: {
              createdAt: 'desc',
            },
          },
          _count: {
            select: {
              blogs: true,
              templates: true,
            },
          },
        },
      });

      if (!project) {
        return null;
      }

      const blogs = (await CmsService.hasCmsBlogExtendedColumns())
        ? await prisma.cmsBlog.findMany({
            where: { projectId: id },
            include: {
              author: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
              template: true,
              project: true,
            },
            orderBy: {
              createdAt: 'desc',
            },
          })
        : (await prisma.cmsBlog.findMany({
            where: { projectId: id },
            select: CmsService.legacyBlogSelect,
            orderBy: {
              createdAt: 'desc',
            },
          })).map(CmsService.withLegacyBlogDefaults);

      return {
        ...project,
        blogs,
        mediaAssets: [],
        _count: {
          ...project._count,
          mediaAssets: 0,
        },
      };
    }

    try {
      return await prisma.cmsContentProject.findFirst({
        where: { id, deletedAt: null },
        include: {
          blogs: {
            include: {
              author: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
              template: true,
            },
            orderBy: {
              createdAt: 'desc',
            },
          },
          mediaAssets: {
            orderBy: {
              createdAt: 'desc',
            },
          },
          templates: {
            orderBy: {
              createdAt: 'desc',
            },
          },
          _count: {
            select: {
              blogs: true,
              templates: true,
              mediaAssets: true,
            },
          },
        },
      });
    } catch (error) {
      if (!isMissingCmsMediaAssetsTableError(error)) {
        throw error;
      }

      const project = await prisma.cmsContentProject.findFirst({
        where: { id, deletedAt: null },
        include: {
          blogs: {
            include: {
              author: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
              template: true,
            },
            orderBy: {
              createdAt: 'desc',
            },
          },
          templates: {
            orderBy: {
              createdAt: 'desc',
            },
          },
          _count: {
            select: {
              blogs: true,
              templates: true,
            },
          },
        },
      });

      if (!project) {
        return null;
      }

      return {
        ...project,
        mediaAssets: [],
        _count: {
          ...project._count,
          mediaAssets: 0,
        },
      };
    }
  }

  static async updateContentProject(
    id: string,
    data: {
      name?: string;
      description?: string;
      domain?: string;
      isActive?: boolean;
      apiKeyScopes?: string[];
    }
  ) {
    const updateData: Record<string, unknown> = { ...data };
    if (data.name) {
      updateData.name = data.name.trim();
      updateData.slug = await CmsService.generateUniqueProjectSlug(data.name, id);
    }

    if (Object.prototype.hasOwnProperty.call(data, 'description')) {
      updateData.description = CmsService.normalizeOptionalString(data.description);
    }

    if (Object.prototype.hasOwnProperty.call(data, 'domain')) {
      updateData.domain = CmsService.normalizeOptionalString(data.domain);
    }

    if (!(await CmsService.hasCmsMediaAssetsTable())) {
      const project = await prisma.cmsContentProject.update({
        where: { id },
        data: updateData,
        include: {
          _count: {
            select: {
              blogs: true,
              templates: true,
            },
          },
        },
      });

      return {
        ...project,
        _count: {
          ...project._count,
          mediaAssets: 0,
        },
      };
    }

    try {
      return await prisma.cmsContentProject.update({
        where: { id },
        data: updateData,
        include: {
          _count: {
            select: {
              blogs: true,
              templates: true,
              mediaAssets: true,
            },
          },
        },
      });
    } catch (error) {
      if (!isMissingCmsMediaAssetsTableError(error)) {
        throw error;
      }

      CmsService.cmsMediaAssetsTableExists = false;

      const project = await prisma.cmsContentProject.update({
        where: { id },
        data: updateData,
        include: {
          _count: {
            select: {
              blogs: true,
              templates: true,
            },
          },
        },
      });

      return {
        ...project,
        _count: {
          ...project._count,
          mediaAssets: 0,
        },
      };
    }
  }

  // Both destructive CMS ops audit-log so the platform-wide activity feed
  // captures who tore down a content project / rotated a public API key
  // (QA finding #28 — audit gaps).
  static async deleteContentProject(id: string, actingUserId?: string) {
    // Soft-delete (QA finding #33). Hard-delete cascaded blogs, templates,
    // and media — losing the audit chain on a single misclick. Now we set
    // deletedAt + isActive=false; list queries filter on deletedAt:null and
    // the public CMS routes refuse to serve. Restoration is a manual SQL
    // touch for now; if needs arise, add an `undeleteContentProject` op.
    const project = await prisma.cmsContentProject.findFirst({
      where: { id, deletedAt: null },
      select: { name: true, slug: true },
    });
    if (!project) {
      // Lazy-import to avoid circular module init — see toBlogSlugConflict above.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { NotFoundError } = require('../utils/errors');
      throw new NotFoundError('CMS project');
    }
    const result = await prisma.cmsContentProject.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    if (actingUserId) {
      const { logActivity } = await import('./activity.service');
      await logActivity({
        userId: actingUserId,
        action: 'deleted_cms_project',
        targetType: 'cms_project',
        targetId: id,
        details: { name: project.name, slug: project.slug, softDelete: true },
      }).catch(() => { /* non-blocking */ });
    }
    return result;
  }

  static async regenerateApiKey(id: string, actingUserId?: string) {
    const apiKey = generateApiKey();
    const result = await prisma.cmsContentProject.update({
      where: { id },
      data: { apiKey },
      select: { id: true, name: true, apiKey: true, slug: true },
    });
    if (actingUserId) {
      const { logActivity } = await import('./activity.service');
      await logActivity({
        userId: actingUserId,
        action: 'rotated_cms_api_key',
        targetType: 'cms_project',
        targetId: id,
        details: { name: result.name, slug: result.slug },
      }).catch(() => { /* non-blocking */ });
    }
    return result;
  }

  static async createTemplate(data: {
    projectId: string;
    name: string;
    type: 'ARTICLE' | 'TUTORIAL' | 'NEWS' | 'CASE_STUDY' | 'ANNOUNCEMENT';
    description?: string;
    structure: unknown;
  }) {
    const name = data.name.trim();
    const baseSlug = await CmsService.generateUniqueTemplateSlug(data.projectId, name);

    return CmsService.withCmsSlugRetry(baseSlug, (slug) =>
      prisma.cmsTemplate.create({
        data: {
          projectId: data.projectId,
          name,
          slug,
          type: data.type,
          description: CmsService.normalizeOptionalString(data.description),
          structure: toJsonValue(data.structure),
        },
        include: {
          _count: {
            select: {
              blogs: true,
            },
          },
        },
      }),
    );
  }

  static async getTemplates(projectId: string) {
    return prisma.cmsTemplate.findMany({
      where: { projectId },
      include: {
        _count: {
          select: {
            blogs: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  static async getTemplate(id: string) {
    return prisma.cmsTemplate.findUnique({
      where: { id },
      include: {
        project: true,
        _count: {
          select: {
            blogs: true,
          },
        },
      },
    });
  }

  static async updateTemplate(
    id: string,
    data: {
      name?: string;
      type?: 'ARTICLE' | 'TUTORIAL' | 'NEWS' | 'CASE_STUDY' | 'ANNOUNCEMENT';
      description?: string;
      structure?: unknown;
      isActive?: boolean;
    }
  ) {
    const updateData: Record<string, unknown> = { ...data };
    const existingTemplate = await prisma.cmsTemplate.findUnique({
      where: { id },
      select: {
        id: true,
        projectId: true,
      },
    });

    if (!existingTemplate) {
      throw new Error('Template not found');
    }

    if (data.name) {
      updateData.name = data.name.trim();
      updateData.slug = await CmsService.generateUniqueTemplateSlug(existingTemplate.projectId, data.name, id);
    }

    if (Object.prototype.hasOwnProperty.call(data, 'description')) {
      updateData.description = CmsService.normalizeOptionalString(data.description);
    }

    return prisma.cmsTemplate.update({
      where: { id },
      data: updateData,
      include: {
        _count: {
          select: {
            blogs: true,
          },
        },
      },
    });
  }

  static async deleteTemplate(id: string, actingUserId?: string) {
    const tpl = await prisma.cmsTemplate.findUnique({
      where: { id },
      select: { name: true, slug: true, projectId: true },
    });
    const result = await prisma.cmsTemplate.delete({ where: { id } });
    if (tpl && actingUserId) {
      const { logActivity } = await import('./activity.service');
      await logActivity({
        userId: actingUserId,
        action: 'deleted_cms_template',
        targetType: 'cms_template',
        targetId: id,
        details: { name: tpl.name, slug: tpl.slug, projectId: tpl.projectId },
      }).catch(() => { /* non-blocking */ });
    }
    return result;
  }

  static async createBlog(data: {
    projectId: string;
    authorId: string;
    templateId?: string | null;
    title: string;
    slug?: string;
    excerpt?: string;
    content: unknown;
    featuredImage?: unknown;
    seo?: unknown;
    tags?: string[];
    categories?: string[];
    status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
    publishedAt?: Date;
  }) {
    const status = data.status ?? 'DRAFT';
    const slug = data.slug ? slugify(data.slug) : slugify(data.title);

    if (!slug) {
      throw new Error('Slug is required');
    }

    await CmsPublicService.assertUniqueBlogSlug(data.projectId, slug);

    if (status === 'PUBLISHED') {
      CmsPublicService.validatePublishableBlog({
        title: data.title,
        slug,
        excerpt: data.excerpt,
        content: data.content,
        featuredImage: data.featuredImage,
      });
    } else {
      CmsPublicService.validateContentBlocks(data.content);
    }

    if (!(await CmsService.hasCmsBlogExtendedColumns())) {
      try {
        return await CmsService.createLegacyBlog({
          projectId: data.projectId,
          authorId: data.authorId,
          templateId: data.templateId ?? null,
          title: data.title,
          slug,
          excerpt: data.excerpt,
          content: data.content,
          status,
          publishedAt: status === 'PUBLISHED' ? data.publishedAt ?? new Date() : null,
        });
      } catch (error) {
        // Concurrent create with the same slug — assertUnique passed both
        // callers but the DB's unique index caught the race. Convert the raw
        // Prisma error into the same friendly conflict the assertion uses
        // (QA finding #16).
        throw CmsService.toBlogSlugConflict(error);
      }
    }

    try {
      return await prisma.cmsBlog.create({
        data: {
          projectId: data.projectId,
          authorId: data.authorId,
          templateId: data.templateId ?? null,
          title: data.title,
          slug,
          excerpt: data.excerpt,
          content: toJsonValue(data.content),
          featuredImage: toNullableJsonValue(data.featuredImage),
          seo: toNullableJsonValue(data.seo),
          tags: data.tags ?? [],
          categories: data.categories ?? [],
          status,
          publishedAt: status === 'PUBLISHED' ? data.publishedAt ?? new Date() : null,
        },
        include: {
          author: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          template: true,
          project: true,
        },
      });
    } catch (error) {
      // Same race window on the modern path. P2002 → ConflictError; everything
      // else falls through to the legacy-column fallback below.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw CmsService.toBlogSlugConflict(error);
      }
      if (!isMissingCmsBlogColumnError(error)) {
        throw error;
      }

      CmsService.cmsBlogExtendedColumnsExist = false;
      return CmsService.createLegacyBlog({
        projectId: data.projectId,
        authorId: data.authorId,
        templateId: data.templateId ?? null,
        title: data.title,
        slug,
        excerpt: data.excerpt,
        content: data.content,
        status,
        publishedAt: status === 'PUBLISHED' ? data.publishedAt ?? new Date() : null,
      });
    }
  }

  static async getBlogs(projectId: string, status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED') {
    if (!(await CmsService.hasCmsBlogExtendedColumns())) {
      const blogs = await prisma.cmsBlog.findMany({
        where: {
          projectId,
          ...(status ? { status } : {}),
        },
        select: CmsService.legacyBlogSelect,
        orderBy: {
          createdAt: 'desc',
        },
      });

      return blogs.map(CmsService.withLegacyBlogDefaults);
    }

    try {
      return await prisma.cmsBlog.findMany({
        where: {
          projectId,
          ...(status ? { status } : {}),
        },
        include: {
          author: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          template: true,
          project: true,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });
    } catch (error) {
      if (!isMissingCmsBlogColumnError(error)) {
        throw error;
      }

      CmsService.cmsBlogExtendedColumnsExist = false;
      const blogs = await prisma.cmsBlog.findMany({
        where: {
          projectId,
          ...(status ? { status } : {}),
        },
        select: CmsService.legacyBlogSelect,
        orderBy: {
          createdAt: 'desc',
        },
      });

      return blogs.map(CmsService.withLegacyBlogDefaults);
    }
  }

  static async getBlog(id: string) {
    if (!(await CmsService.hasCmsBlogExtendedColumns())) {
      const blog = await prisma.cmsBlog.findUnique({
        where: { id },
        select: CmsService.legacyBlogSelect,
      });

      return blog ? CmsService.withLegacyBlogDefaults(blog) : null;
    }

    try {
      return await prisma.cmsBlog.findUnique({
        where: { id },
        include: {
          author: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          template: true,
          project: true,
        },
      });
    } catch (error) {
      if (!isMissingCmsBlogColumnError(error)) {
        throw error;
      }

      CmsService.cmsBlogExtendedColumnsExist = false;
      const blog = await prisma.cmsBlog.findUnique({
        where: { id },
        select: CmsService.legacyBlogSelect,
      });

      return blog ? CmsService.withLegacyBlogDefaults(blog) : null;
    }
  }

  static async updateBlog(
    id: string,
    data: {
      title?: string;
      slug?: string;
      excerpt?: string;
      content?: unknown;
      templateId?: string | null;
      featuredImage?: unknown;
      seo?: unknown;
      tags?: string[];
      categories?: string[];
      status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
      publishedAt?: Date | null;
    }
  ) {
    const updateData: Record<string, unknown> = { ...data };
    const existingBlog = await prisma.cmsBlog.findUnique({
      where: { id },
      select: {
        id: true,
        projectId: true,
        title: true,
        slug: true,
        excerpt: true,
        content: true,
        featuredImage: true,
        status: true,
      },
    });

    if (!existingBlog) {
      throw new Error('Blog not found');
    }

    if (data.title || data.slug) {
      updateData.slug = slugify(data.slug ?? data.title ?? '');
    }

    const nextSlug = (updateData.slug as string | undefined) ?? existingBlog.slug;
    if (!nextSlug) {
      throw new Error('Slug is required');
    }

    await CmsPublicService.assertUniqueBlogSlug(existingBlog.projectId, nextSlug, id);

    if (Object.prototype.hasOwnProperty.call(data, 'templateId')) {
      updateData.templateId = data.templateId ?? null;
    }

    if (data.status === 'PUBLISHED') {
      updateData.publishedAt = data.publishedAt ?? new Date();
    }

    if (data.status && data.status !== 'PUBLISHED') {
      updateData.publishedAt = null;
    }

    if (Object.prototype.hasOwnProperty.call(data, 'content')) {
      updateData.content = toJsonValue(data.content);
    }

    const nextStatus = data.status ?? existingBlog.status;
    const nextTitle = data.title ?? existingBlog.title;
    const nextExcerpt =
      Object.prototype.hasOwnProperty.call(data, 'excerpt') ? data.excerpt : existingBlog.excerpt ?? undefined;
    const nextContent =
      Object.prototype.hasOwnProperty.call(data, 'content') ? data.content : existingBlog.content;
    const nextFeaturedImage =
      Object.prototype.hasOwnProperty.call(data, 'featuredImage') ? data.featuredImage : existingBlog.featuredImage;

    if (nextStatus === 'PUBLISHED') {
      CmsPublicService.validatePublishableBlog({
        title: nextTitle,
        slug: nextSlug,
        excerpt: nextExcerpt,
        content: nextContent,
        featuredImage: nextFeaturedImage,
      });
    } else {
      CmsPublicService.validateContentBlocks(nextContent);
    }

    const hasExtendedColumns = await CmsService.hasCmsBlogExtendedColumns();

    if (hasExtendedColumns && Object.prototype.hasOwnProperty.call(data, 'featuredImage')) {
      updateData.featuredImage = toNullableJsonValue(data.featuredImage);
    }

    if (hasExtendedColumns && Object.prototype.hasOwnProperty.call(data, 'seo')) {
      updateData.seo = toNullableJsonValue(data.seo);
    }

    if (!hasExtendedColumns) {
      delete updateData.featuredImage;
      delete updateData.seo;
      delete updateData.tags;
      delete updateData.categories;
    }

    if (!hasExtendedColumns) {
      return CmsService.updateLegacyBlog(id, {
        title: data.title,
        slug: updateData.slug as string | undefined,
        excerpt: data.excerpt,
        content: data.content,
        templateId: data.templateId,
        status: data.status,
        publishedAt: updateData.publishedAt as Date | null | undefined,
      });
    }

    try {
      const blog = await prisma.cmsBlog.update({
        where: { id },
        data: updateData,
        include: {
          author: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          template: true,
          project: true,
        },
      });

      return blog;
    } catch (error) {
      if (!isMissingCmsBlogColumnError(error)) {
        throw error;
      }

      CmsService.cmsBlogExtendedColumnsExist = false;
      return CmsService.updateLegacyBlog(id, {
        title: data.title,
        slug: updateData.slug as string | undefined,
        excerpt: data.excerpt,
        content: data.content,
        templateId: data.templateId,
        status: data.status,
        publishedAt: updateData.publishedAt as Date | null | undefined,
      });
    }
  }

  static async deleteBlog(id: string, actingUserId?: string) {
    // Best-effort metadata snapshot for the audit row. If the blog is
    // already gone the delete still no-ops cleanly.
    const blog = await prisma.cmsBlog.findUnique({
      where: { id },
      select: { title: true, slug: true, projectId: true },
    }).catch(() => null);

    let result: { id: string } | unknown;
    if (!(await CmsService.hasCmsBlogExtendedColumns())) {
      await prisma.$executeRaw`DELETE FROM "cms_blogs" WHERE "id" = ${id}`;
      result = { id };
    } else {
      try {
        result = await prisma.cmsBlog.delete({ where: { id } });
      } catch (error) {
        if (!isMissingCmsBlogColumnError(error)) {
          throw error;
        }
        CmsService.cmsBlogExtendedColumnsExist = false;
        await prisma.$executeRaw`DELETE FROM "cms_blogs" WHERE "id" = ${id}`;
        result = { id };
      }
    }

    if (blog && actingUserId) {
      const { logActivity } = await import('./activity.service');
      await logActivity({
        userId: actingUserId,
        action: 'deleted_cms_blog',
        targetType: 'cms_blog',
        targetId: id,
        details: { title: blog.title, slug: blog.slug, projectId: blog.projectId },
      }).catch(() => { /* non-blocking */ });
    }

    return result;
  }

  static async getPublishedBlogsByApiKey(apiKey: string) {
    const project = await prisma.cmsContentProject.findFirst({
      where: { apiKey, isActive: true },
    });

    if (!project) {
      throw new Error('Invalid API key or inactive project');
    }

    if (!(await CmsService.hasCmsBlogExtendedColumns())) {
      const blogs = await prisma.cmsBlog.findMany({
        where: {
          projectId: project.id,
          status: 'PUBLISHED',
        },
        select: {
          ...CmsService.legacyBlogSelect,
          project: false,
        },
        orderBy: {
          publishedAt: 'desc',
        },
      });

      return blogs.map(CmsService.withLegacyBlogDefaults);
    }

    try {
      return await prisma.cmsBlog.findMany({
        where: {
          projectId: project.id,
          status: 'PUBLISHED',
        },
        include: {
          author: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          template: true,
        },
        orderBy: {
          publishedAt: 'desc',
        },
      });
    } catch (error) {
      if (!isMissingCmsBlogColumnError(error)) {
        throw error;
      }

      CmsService.cmsBlogExtendedColumnsExist = false;
      const blogs = await prisma.cmsBlog.findMany({
        where: {
          projectId: project.id,
          status: 'PUBLISHED',
        },
        select: {
          ...CmsService.legacyBlogSelect,
          project: false,
        },
        orderBy: {
          publishedAt: 'desc',
        },
      });

      return blogs.map(CmsService.withLegacyBlogDefaults);
    }
  }

  static async getPublishedBlogBySlug(apiKey: string, slug: string) {
    const project = await prisma.cmsContentProject.findFirst({
      where: { apiKey, isActive: true },
    });

    if (!project) {
      throw new Error('Invalid API key or inactive project');
    }

    if (!(await CmsService.hasCmsBlogExtendedColumns())) {
      const blog = await prisma.cmsBlog.findFirst({
        where: {
          projectId: project.id,
          slug,
          status: 'PUBLISHED',
        },
        select: {
          ...CmsService.legacyBlogSelect,
          project: false,
        },
      });

      return blog ? CmsService.withLegacyBlogDefaults(blog) : null;
    }

    try {
      return await prisma.cmsBlog.findFirst({
        where: {
          projectId: project.id,
          slug,
          status: 'PUBLISHED',
        },
        include: {
          author: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          template: true,
        },
      });
    } catch (error) {
      if (!isMissingCmsBlogColumnError(error)) {
        throw error;
      }

      CmsService.cmsBlogExtendedColumnsExist = false;
      const blog = await prisma.cmsBlog.findFirst({
        where: {
          projectId: project.id,
          slug,
          status: 'PUBLISHED',
        },
        select: {
          ...CmsService.legacyBlogSelect,
          project: false,
        },
      });

      return blog ? CmsService.withLegacyBlogDefaults(blog) : null;
    }
  }

  static async getMediaAssets(projectId: string) {
    if (!(await CmsService.hasCmsMediaAssetsTable())) {
      return [];
    }

    try {
      return await prisma.cmsMediaAsset.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      if (!isMissingCmsMediaAssetsTableError(error)) {
        throw error;
      }

      CmsService.cmsMediaAssetsTableExists = false;
      return [];
    }
  }

  static async uploadMedia(projectId: string, files: Array<UploadedFile | UploadedFilePayload>) {
    if (!(await CmsService.hasCmsMediaAssetsTable())) {
      throw new Error('CMS media storage is not available until the database migration is applied');
    }

    const assets = [];

    for (const file of files) {
      const storedFile = await CmsService.persistUploadedFile(file);

      try {
        const asset = await prisma.cmsMediaAsset.create({
          data: {
            projectId,
            filename: storedFile.filename,
            originalName: storedFile.originalName,
            mimeType: storedFile.mimeType,
            size: storedFile.size,
            url: `/uploads/cms/${storedFile.filename}`,
            metadata: {},
          },
        });
        assets.push(asset);
      } catch (error) {
        if (!isMissingCmsMediaAssetsTableError(error)) {
          throw error;
        }

        CmsService.cmsMediaAssetsTableExists = false;
        throw new Error('CMS media storage is not available until the database migration is applied');
      }
    }

    return assets;
  }

  static async deleteMedia(projectId: string, assetId: string) {
    const asset = await prisma.cmsMediaAsset.findFirst({
      where: {
        id: assetId,
        projectId,
      },
    });

    if (!asset) {
      throw new Error('Media asset not found');
    }

    return prisma.cmsMediaAsset.delete({
      where: {
        id: assetId,
      },
    });
  }
}
