import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import {
  analyzeTopic,
  generateBlog,
  createDraft,
  getHistory,
  getImages,
  deleteSearch,
  clearSearches,
} from '../handlers/contentEngine.handler';

const router = Router();

// All content engine endpoints require authentication + the use permission.
// Project-scoped under /content-engine/:projectId to align with the CMS URL
// structure (/cms/projects/:projectId/...) on the frontend.

router.use(authenticate);
router.use(authorize('cms.content_engine.use'));

// POST /content-engine/:projectId/analyze
// Searches a topic via the AI provider and returns trend analysis.
router.post('/:projectId/analyze', analyzeTopic);

// POST /content-engine/:projectId/generate-blog
// Generates a full blog draft from a prior analysis result.
router.post('/:projectId/generate-blog', generateBlog);

// POST /content-engine/:projectId/create-draft
// Promotes a generated draft into the CMS as a DRAFT blog.
router.post('/:projectId/create-draft', createDraft);

// GET /content-engine/:projectId/history
// Returns recent search history for a CMS project.
router.get('/:projectId/history', getHistory);

// GET /content-engine/:projectId/images?query=keyword
// Fetches royalty-free images from Wikimedia Commons (no API key required).
router.get('/:projectId/images', getImages);

// DELETE /content-engine/:projectId/searches/:searchId — delete one search record
router.delete('/:projectId/searches/:searchId', deleteSearch);

// DELETE /content-engine/:projectId/searches — clear all searches for a project
router.delete('/:projectId/searches', clearSearches);

export default router;
