import { randomUUID } from 'crypto';
import type { DocCategory, DocStatus, UserRole } from '@prisma/client';
import prisma from '../config/database';
import { env } from '../config/env';
import {
  signUploadUrl,
  signDownloadUrl,
  buildDocumentS3Key,
  assertS3Configured,
  objectExists,
  S3_BUCKET,
} from '../integrations/s3';
import { logActivity } from './activity.service';
import { ForbiddenError, NotFoundError, ValidationError } from '../utils/errors';

/**
 * Project Documents service.
 *
 * Three audiences:
 *   - Humans uploading/browsing from the admin/client UI
 *   - Agents fetching context from the knowledge-pack listing
 *   - The cleanup worker that hard-deletes S3 objects after the
 *     soft-delete grace period (not implemented yet — Phase 2 of the
 *     docs feature)
 *
 * The service handles permissions, S3 key computation, and PENDING →
 * READY → DELETED lifecycle. Route handlers stay thin: parse + auth +
 * call service + render response.
 */

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Allowed MIME types. Conservatively narrow — this bucket is for
 * human-readable project context. If we want to accept more, add here;
 * we deliberately reject anything executable.
 */
const ALLOWED_CONTENT_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/svg+xml',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',       // .xlsx
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
]);

/**
 * Sanitise the user-provided filename so it's safe as part of an S3 key
 * and a Content-Disposition header. Keeps the original extension; strips
 * path separators and shell metachars; collapses whitespace.
 */
function sanitiseFilename(input: string): string {
  const cleaned = input
    .replace(/[/\\]/g, '_')           // path separators
    .replace(/[^A-Za-z0-9._\-\s]/g, '') // dangerous metachars
    .replace(/\s+/g, '_')              // whitespace → underscore
    .replace(/^\.+/, '')               // leading dots
    .slice(0, 200);                    // cap length (S3 keys can be longer; we don't need it)
  return cleaned || 'file';
}

/**
 * Confirm the user is a member of the project. We don't check the
 * specific role here — the routes upstream gate that with `authorize`.
 * This is the second layer that catches "permission granted, but not on
 * THIS project".
 */
async function assertProjectMember(projectId: string, userId: string): Promise<void> {
  const membership = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId, projectId } },
  });
  if (!membership) {
    // Also allow callers who hold project.view_all globally — they don't
    // need explicit per-project membership (matches the pattern in
    // taskAccess middleware).
    const actor = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (actor?.role !== 'SUPER_ADMIN' && actor?.role !== 'ADMIN') {
      throw new ForbiddenError('Not a member of this project');
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────

export interface PresignUploadInput {
  projectId: string;
  uploaderId: string;
  title: string;
  description?: string | null;
  category?: DocCategory;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export interface PresignUploadResult {
  document: {
    id: string;
    projectId: string;
    title: string;
    description: string | null;
    category: DocCategory;
    filename: string;
    contentType: string;
    sizeBytes: number;
    status: DocStatus;
    uploadedAt: Date;
  };
  uploadUrl: string;
  /** Seconds until the upload URL expires. Echo so clients can wire retry/abort UI. */
  expiresIn: number;
}

/**
 * Create a PENDING ProjectDocument row and return a presigned PUT URL
 * the client uses to upload the bytes directly to S3. After upload, the
 * client calls confirmUpload() to flip the row to READY.
 *
 * Validates content type, size, and project membership. Throws structured
 * errors on each failure mode — handlers translate to HTTP statuses.
 */
export async function presignUpload(input: PresignUploadInput): Promise<PresignUploadResult> {
  assertS3Configured();
  await assertProjectMember(input.projectId, input.uploaderId);

  // ── Validate inputs ──
  if (!input.title?.trim()) {
    throw new ValidationError('Title is required');
  }
  if (input.title.length > 200) {
    throw new ValidationError('Title must be 200 characters or fewer');
  }
  if (!input.filename?.trim()) {
    throw new ValidationError('Filename is required');
  }
  if (input.sizeBytes <= 0) {
    throw new ValidationError('File size must be positive');
  }
  if (input.sizeBytes > env.DOCUMENTS_MAX_BYTES) {
    const mb = Math.round(env.DOCUMENTS_MAX_BYTES / (1024 * 1024));
    throw new ValidationError(`File exceeds the ${mb} MB limit`);
  }
  if (!ALLOWED_CONTENT_TYPES.has(input.contentType)) {
    throw new ValidationError(
      `Content type ${input.contentType} is not allowed. Accepted: PDF, plain text, Markdown, CSV, JSON, images, .docx, .xlsx, .pptx.`,
    );
  }

  // ── Confirm the project exists (the membership check above can't
  //    distinguish "project doesn't exist" from "you're not on it" for
  //    non-admins; do it explicitly so 404s are honest) ──
  const project = await prisma.project.findUnique({
    where: { id: input.projectId },
    select: { id: true },
  });
  if (!project) throw new NotFoundError('Project');

  // ── Compose the S3 key + presigned URL ──
  const docId = randomUUID();
  const safeFilename = sanitiseFilename(input.filename);
  const s3Key = buildDocumentS3Key(input.projectId, docId, safeFilename);

  const uploadUrl = await signUploadUrl({
    key: s3Key,
    contentType: input.contentType,
    sizeBytes: input.sizeBytes,
  });

  // ── Create the PENDING row. If the client never confirms, the daily
  //    sweep removes orphaned PENDING rows older than 24h. ──
  const document = await prisma.projectDocument.create({
    data: {
      id: docId,
      projectId: input.projectId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      category: input.category ?? 'OTHER',
      s3Bucket: S3_BUCKET(),
      s3Key,
      filename: safeFilename,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      status: 'PENDING',
      uploadedById: input.uploaderId,
    },
    select: {
      id: true, projectId: true, title: true, description: true, category: true,
      filename: true, contentType: true, sizeBytes: true, status: true, uploadedAt: true,
    },
  });

  return {
    document,
    uploadUrl,
    expiresIn: env.S3_PRESIGNED_TTL_SECONDS,
  };
}

/**
 * Flip a PENDING document to READY after the client confirms the S3 PUT
 * completed. Verifies the upload actually landed via HeadObject before
 * trusting the client — guards against a malicious client confirming
 * without ever uploading. Also self-heals if a transient S3 error left
 * the row in PENDING but the object is fine.
 */
export async function confirmUpload(docId: string, userId: string) {
  const doc = await prisma.projectDocument.findUnique({ where: { id: docId } });
  if (!doc) throw new NotFoundError('Document');
  // Anyone who can read the project can confirm — but in practice only
  // the uploader has the URL anyway. Keep the membership check.
  await assertProjectMember(doc.projectId, userId);

  if (doc.status === 'READY') return doc;       // idempotent
  if (doc.status === 'DELETED') {
    throw new ValidationError('Document has been deleted; cannot confirm.');
  }

  // Verify the bytes actually exist in S3
  const exists = await objectExists(doc.s3Key);
  if (!exists) {
    throw new ValidationError(
      'Upload not found in storage. Either it never completed or it expired before confirm; please retry.',
    );
  }

  const updated = await prisma.projectDocument.update({
    where: { id: docId },
    data: { status: 'READY' },
  });

  await logActivity({
    userId,
    projectId: doc.projectId,
    action: 'uploaded_document',
    targetType: 'document',
    targetId: doc.id,
    details: { title: doc.title, category: doc.category, sizeBytes: doc.sizeBytes },
  });

  return updated;
}

export interface DocumentListItem {
  id: string;
  title: string;
  description: string | null;
  category: DocCategory;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: Date;
  uploadedBy: { id: string; name: string };
}

export async function listProjectDocuments(
  projectId: string,
  userId: string,
): Promise<DocumentListItem[]> {
  await assertProjectMember(projectId, userId);

  const rows = await prisma.projectDocument.findMany({
    where: { projectId, status: 'READY' },
    orderBy: { uploadedAt: 'desc' },
    select: {
      id: true, title: true, description: true, category: true,
      filename: true, contentType: true, sizeBytes: true, uploadedAt: true,
      uploadedBy: { select: { id: true, name: true } },
    },
  });

  return rows;
}

/**
 * Issue a presigned GET URL for a single document. Used by both the
 * admin UI (human download) and the agent runtime (programmatic fetch).
 * Routes that need different authz semantics use the same service
 * function — the membership check below is identical for humans and
 * agents, since agent users are also ProjectMembers.
 */
export async function getDocumentDownloadUrl(
  docId: string,
  userId: string,
): Promise<{ url: string; filename: string; contentType: string; sizeBytes: number; expiresIn: number }> {
  const doc = await prisma.projectDocument.findUnique({
    where: { id: docId },
    select: {
      id: true, projectId: true, s3Key: true, status: true,
      filename: true, contentType: true, sizeBytes: true,
    },
  });
  if (!doc) throw new NotFoundError('Document');
  if (doc.status !== 'READY') {
    throw new NotFoundError('Document'); // hide PENDING/DELETED from non-uploaders
  }
  await assertProjectMember(doc.projectId, userId);

  const url = await signDownloadUrl({
    key: doc.s3Key,
    filename: doc.filename,
    contentType: doc.contentType,
  });

  return {
    url,
    filename: doc.filename,
    contentType: doc.contentType,
    sizeBytes: doc.sizeBytes,
    expiresIn: env.S3_PRESIGNED_TTL_SECONDS,
  };
}

/**
 * Soft-delete a document. The row's status flips to DELETED with a
 * tombstone timestamp; the S3 object is cleaned up later by the
 * background sweep. Permission: uploader OR caller has document.delete.
 */
export async function softDeleteDocument(
  docId: string,
  userId: string,
  userRole: UserRole,
  /** Does the caller hold the document.delete permission? Checked in the route layer
   *  and passed in so the service stays role-table-agnostic. */
  canDeleteAny: boolean,
): Promise<void> {
  const doc = await prisma.projectDocument.findUnique({
    where: { id: docId },
    select: { id: true, projectId: true, uploadedById: true, status: true, title: true },
  });
  if (!doc) throw new NotFoundError('Document');
  if (doc.status === 'DELETED') return; // idempotent

  await assertProjectMember(doc.projectId, userId);

  const isUploader = doc.uploadedById === userId;
  const isSuperAdmin = userRole === 'SUPER_ADMIN';
  if (!isUploader && !canDeleteAny && !isSuperAdmin) {
    throw new ForbiddenError('Only the uploader or a project admin can delete this document');
  }

  await prisma.projectDocument.update({
    where: { id: docId },
    data: { status: 'DELETED', deletedAt: new Date() },
  });

  await logActivity({
    userId,
    projectId: doc.projectId,
    action: 'deleted_document',
    targetType: 'document',
    targetId: doc.id,
    details: { title: doc.title },
  });
}
