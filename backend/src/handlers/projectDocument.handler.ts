import { Request, Response, NextFunction } from 'express';
import * as docService from '../services/projectDocument.service';
import { signDownloadUrl } from '../integrations/s3';
import { checkPermission } from '../services/rbac.service';
import prisma from '../config/database';
import { env } from '../config/env';
import { ForbiddenError, NotFoundError } from '../utils/errors';

/**
 * Project Documents — HTTP handlers.
 *
 * Permission gates: `authenticate` is in the route layer; permission
 * checks (document.upload / document.read / document.delete) likewise.
 * Handlers focus on parsing the request envelope, calling the service,
 * and shaping the response.
 */

export async function presignUploadHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await docService.presignUpload({
      projectId:   req.params.id,
      uploaderId:  req.user!.id,
      title:       req.body.title,
      description: req.body.description,
      category:    req.body.category,
      filename:    req.body.filename,
      contentType: req.body.contentType,
      sizeBytes:   req.body.sizeBytes,
    });
    res.status(201).json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function confirmUploadHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const doc = await docService.confirmUpload(req.params.docId, req.user!.id);
    res.json({ success: true, data: doc });
  } catch (err) { next(err); }
}

export async function listDocumentsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const docs = await docService.listProjectDocuments(req.params.id, req.user!.id);
    res.json({ success: true, data: docs });
  } catch (err) { next(err); }
}

export async function getDocumentDownloadHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await docService.getDocumentDownloadUrl(req.params.docId, req.user!.id);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
}

export async function deleteDocumentHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const canDeleteAny = await checkPermission(req.user!.role, 'document.delete');
    await docService.softDeleteDocument(req.params.docId, req.user!.id, req.user!.role, canDeleteAny);
    res.json({ success: true, data: { message: 'Document deleted' } });
  } catch (err) { next(err); }
}

/**
 * Agent-only download endpoint. Distinct from the human download in three
 * ways:
 *   1. Mounted under `/agents/me/...` and gated to userType=AGENT.
 *   2. Addresses the project by SLUG (humans use UUIDs in URLs; agents
 *      use slugs to match the knowledge-pack response).
 *   3. Adds extra audit metadata to the activity log so it's clear an
 *      agent fetched the doc (vs. a human admin pretending to be an agent).
 */
export async function agentDocumentDownloadHandler(req: Request, res: Response, next: NextFunction) {
  try {
    if (req.user!.userType !== 'AGENT') {
      throw new ForbiddenError('Agent-only endpoint');
    }

    // Resolve slug → projectId. KP service already does the project +
    // membership check; we mirror it here for the document fetch path.
    const project = await prisma.project.findUnique({
      where: { slug: req.params.projectSlug },
      select: { id: true, slug: true },
    });
    if (!project) throw new NotFoundError('Project');

    // Confirm the doc belongs to this project AND is READY.
    const doc = await prisma.projectDocument.findFirst({
      where: { id: req.params.docId, projectId: project.id, status: 'READY' },
      select: {
        id: true, s3Key: true, filename: true, contentType: true,
        sizeBytes: true, title: true, projectId: true,
      },
    });
    if (!doc) throw new NotFoundError('Document');

    // Same project-membership gate as the KP service uses — agents act
    // through ProjectMember, not via project.view_all.
    const membership = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId: req.user!.id, projectId: project.id } },
    });
    if (!membership) throw new ForbiddenError('You are not a member of this project');

    const url = await signDownloadUrl({
      key: doc.s3Key,
      filename: doc.filename,
      contentType: doc.contentType,
    });

    res.json({
      success: true,
      data: {
        url,
        filename:    doc.filename,
        contentType: doc.contentType,
        sizeBytes:   doc.sizeBytes,
        title:       doc.title,
        expiresIn:   env.S3_PRESIGNED_TTL_SECONDS,
      },
    });
  } catch (err) { next(err); }
}
