import { Router } from 'express';
import { authenticate } from '../middleware/authenticate';
import { authorize } from '../middleware/authorize';
import { projectAccess } from '../middleware/projectAccess';
import { projectScopedResourceAccess } from '../middleware/projectScopedResourceAccess';
import { validate } from '../middleware/validate';
import * as handler from '../handlers/projectDocument.handler';
import {
  presignUploadSchema,
  confirmUploadSchema,
  listDocumentsSchema,
  getDocumentDownloadSchema,
  deleteDocumentSchema,
  agentDocumentDownloadSchema,
} from '../validators/projectDocument.schema';

const router = Router();

/* ─────────────────────────────────────────────────────────────────────────────
   Project Documents — S3-backed reference material.

   Two surfaces:
     - Project-scoped (humans):  /projects/:id/documents/...
     - Agent-only:               /agents/me/projects/:projectSlug/documents/...

   The agent path addresses by slug to match the knowledge-pack envelope
   the runtime already consumes. Both paths share the same service layer.
   ───────────────────────────────────────────────────────────────────────── */

// ── Project-scoped (humans) ───────────────────────────────────────────

// Upload phase 1: get a presigned PUT URL. Backend creates a PENDING
// row; client PUTs bytes directly to S3.
router.post(
  '/projects/:id/documents/presigned-upload',
  authenticate,
  projectAccess,
  authorize('document.upload'),
  validate(presignUploadSchema),
  handler.presignUploadHandler,
);

// Upload phase 2: client confirms the S3 PUT completed. Server head-
// checks S3 and flips the row from PENDING → READY.
router.post(
  '/projects/:id/documents/:docId/confirm',
  authenticate,
  projectScopedResourceAccess('projectDocument', 'docId'),
  authorize('document.upload'), // confirm is paired with upload, not separate
  validate(confirmUploadSchema),
  handler.confirmUploadHandler,
);

// List all READY documents on a project (visible to anyone with project access
// + document.read; clients have document.read).
router.get(
  '/projects/:id/documents',
  authenticate,
  projectAccess,
  authorize('document.read'),
  validate(listDocumentsSchema),
  handler.listDocumentsHandler,
);

// Generate a presigned GET URL for one document. The frontend follows
// the URL to download from S3 directly; bytes don't traverse this API.
router.get(
  '/projects/:id/documents/:docId/download',
  authenticate,
  projectScopedResourceAccess('projectDocument', 'docId'),
  authorize('document.read'),
  validate(getDocumentDownloadSchema),
  handler.getDocumentDownloadHandler,
);

// Soft-delete. Service layer further restricts to uploader OR
// document.delete holder; the route just verifies the caller is in
// the project.
router.delete(
  '/projects/:id/documents/:docId',
  authenticate,
  projectScopedResourceAccess('projectDocument', 'docId'),
  validate(deleteDocumentSchema),
  handler.deleteDocumentHandler,
);

// ── Agent-only ─────────────────────────────────────────────────────────

// Agent download. The agent runtime calls this from `cc docs fetch`
// after seeing the documents list in the knowledge pack. Project is
// addressed by slug (the agent doesn't know UUIDs); the handler
// re-resolves to a projectId and re-checks membership.
router.get(
  '/agents/me/projects/:projectSlug/documents/:docId/download',
  authenticate,
  validate(agentDocumentDownloadSchema),
  handler.agentDocumentDownloadHandler,
);

export default router;
