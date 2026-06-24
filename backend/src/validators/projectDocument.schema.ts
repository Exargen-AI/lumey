import { z } from 'zod';
import { DocCategory } from '@prisma/client';

/**
 * Project Documents — request validators. Bytes never pass through the
 * API server; clients PUT directly to S3 via the presigned URL we hand
 * back. These schemas describe only the small JSON envelopes around
 * that upload.
 */

export const presignUploadSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    title:       z.string().min(1).max(200),
    description: z.string().max(2000).nullable().optional(),
    category:    z.nativeEnum(DocCategory).optional(),
    filename:    z.string().min(1).max(255),
    contentType: z.string().min(1).max(150),
    // sizeBytes is also enforced server-side against DOCUMENTS_MAX_BYTES,
    // but bounding the request here gives a fast rejection of obviously-
    // bogus values without spending a round trip on S3 signing.
    sizeBytes:   z.number().int().positive().max(2_147_483_647), // 2 GiB ceiling on the wire
  }),
});

export const confirmUploadSchema = z.object({
  params: z.object({
    id:    z.string().uuid(),
    docId: z.string().uuid(),
  }),
  body: z.object({}).optional().default({}),
});

export const listDocumentsSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
});

export const getDocumentDownloadSchema = z.object({
  params: z.object({
    id:    z.string().uuid(),
    docId: z.string().uuid(),
  }),
});

export const deleteDocumentSchema = z.object({
  params: z.object({
    id:    z.string().uuid(),
    docId: z.string().uuid(),
  }),
});

export const agentDocumentDownloadSchema = z.object({
  params: z.object({
    projectSlug: z.string().min(1).max(200),
    docId:       z.string().uuid(),
  }),
});
