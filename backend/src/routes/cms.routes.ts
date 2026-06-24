import { Router } from 'express';
import multer from 'multer';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { publicCmsLimiter } from '../middleware/rateLimiter';
import * as cmsHandlers from '../handlers/cmsHandlers';

const router = Router();

/**
 * Multipart upload handler for CMS media. QA finding H-C4: previously
 * uploads were arriving as base64 inside JSON through the catch-all
 * 25MB JSON parser — wasteful (base64 ~33% inflation, all in memory)
 * and undocumented. Now multer parses multipart/form-data with file
 * limits and a MIME allowlist. The base64-in-JSON branch in
 * `uploadMedia` is kept as a backward-compat fallback but should be
 * deprecated in a follow-up.
 *
 * Limits: 10MB per file, 10 files per request. MIME allowlist covers
 * the formats CMS users actually need; everything else is rejected at
 * the parser level so the handler never sees the bytes.
 */
const ALLOWED_UPLOAD_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'video/mp4',
  'video/webm',
]);
const cmsUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,  // 10 MB per file
    files: 10,
    fields: 20,
  },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_UPLOAD_MIMES.has(file.mimetype)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${file.mimetype}`));
  },
});

// Content Project Routes
router.post(
  '/projects',
  authenticate,
  authorize('cms.project.create'),
  cmsHandlers.createContentProject
);

router.get(
  '/projects',
  authenticate,
  authorize('cms.project.view'),
  cmsHandlers.getContentProjects
);

router.get(
  '/projects/:id',
  authenticate,
  authorize('cms.project.view'),
  cmsHandlers.getContentProject
);

router.put(
  '/projects/:id',
  authenticate,
  authorize('cms.project.edit'),
  cmsHandlers.updateContentProject
);

router.delete(
  '/projects/:id',
  authenticate,
  authorize('cms.project.delete'),
  cmsHandlers.deleteContentProject
);

router.post(
  '/projects/:id/regenerate-api-key',
  authenticate,
  authorize('cms.apikey.manage'),
  cmsHandlers.regenerateApiKey
);

// Template Routes
router.post(
  '/projects/:projectId/templates',
  authenticate,
  authorize('cms.template.create'),
  cmsHandlers.createTemplate
);

router.get(
  '/projects/:projectId/templates',
  authenticate,
  authorize('cms.template.view'),
  cmsHandlers.getTemplates
);

router.get(
  '/templates/:id',
  authenticate,
  authorize('cms.template.view'),
  cmsHandlers.getTemplate
);

router.put(
  '/templates/:id',
  authenticate,
  authorize('cms.template.edit'),
  cmsHandlers.updateTemplate
);

router.delete(
  '/templates/:id',
  authenticate,
  authorize('cms.template.delete'),
  cmsHandlers.deleteTemplate
);

// Blog Routes
router.post(
  '/projects/:projectId/blogs',
  authenticate,
  authorize('cms.blog.create'),
  cmsHandlers.createBlog
);

router.get(
  '/projects/:projectId/blogs',
  authenticate,
  authorize('cms.blog.view'),
  cmsHandlers.getBlogs
);

router.get(
  '/blogs/:id',
  authenticate,
  authorize('cms.blog.view'),
  cmsHandlers.getBlog
);

router.put(
  '/blogs/:id',
  authenticate,
  authorize('cms.blog.edit'),
  cmsHandlers.updateBlog
);

router.delete(
  '/blogs/:id',
  authenticate,
  authorize('cms.blog.delete'),
  cmsHandlers.deleteBlog
);

// Media Asset Routes
router.get(
  '/projects/:projectId/media',
  authenticate,
  authorize('cms.project.view'),
  cmsHandlers.getMediaAssets
);

router.post(
  '/projects/:projectId/media/upload',
  authenticate,
  authorize('cms.project.edit'),
  // Accept up to 10 files in the `files[]` field. The handler also still
  // supports base64-in-JSON for legacy callers, but multipart is now
  // the primary path.
  cmsUpload.array('files', 10),
  cmsHandlers.uploadMedia
);

router.delete(
  '/projects/:projectId/media/:assetId',
  authenticate,
  authorize('cms.project.edit'),
  cmsHandlers.deleteMedia
);

// Public API Routes (for external websites - no authentication required)
// Public routes — keyed by API key, no user auth. Rate-limit per IP to make
// scraping/enumeration painful while allowing legitimate site rendering.
router.get('/public/blogs',                publicCmsLimiter, cmsHandlers.getPublicBlogs);
router.get('/public/:apiKey/blogs/:slug',  publicCmsLimiter, cmsHandlers.getPublicBlog);
router.get('/public/:apiKey/blogs/id/:id', publicCmsLimiter, cmsHandlers.getPublicBlogById);
router.get('/public/tags',                 publicCmsLimiter, cmsHandlers.getPublicTags);
router.get('/public/categories',           publicCmsLimiter, cmsHandlers.getPublicCategories);
router.get('/public/authors',              publicCmsLimiter, cmsHandlers.getPublicAuthors);
router.get('/public/assets/:id',           publicCmsLimiter, cmsHandlers.getPublicAsset);

export default router;
