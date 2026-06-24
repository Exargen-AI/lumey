import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '../utils/errors';
import { env } from '../config/env';
import { randomUUID } from 'crypto';
import { logger } from '../lib/logger';

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const errorId = randomUUID().slice(0, 8);
  const isDev = env.NODE_ENV === 'development';

  // 2026-05-23 audit fix: if response headers have already been sent
  // (e.g., a mid-stream PDF download failed), we cannot send a JSON
  // error body. Trying to do so throws "Cannot set headers after they
  // are sent" and the original error is lost. Express's docs explicitly
  // call this case out — the only safe thing is to log + close the
  // connection. Delegating to the default handler via `_next` would
  // cause the same problem; just log and let the socket finish.
  if (res.headersSent) {
    logger.error({ err, errorId, reqId: (req as any).id }, 'error after headers sent (response truncated)');
    res.destroy();
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      error: { code: err.code, message: err.message, errorId },
    });
    return;
  }

  if (err instanceof ZodError) {
    // In production, only show field names, not validation rules
    const details = isDev ? err.flatten() : {
      fieldErrors: Object.fromEntries(
        Object.entries(err.flatten().fieldErrors).map(([k, v]) => [k.replace('body.', ''), ['Invalid value']])
      ),
    };
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details, errorId },
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      // Don't expose field names in production
      const message = isDev
        ? `A record with this ${(err.meta?.target as string[])?.join(', ') || 'field'} already exists`
        : 'A record with this value already exists';
      res.status(409).json({
        success: false,
        error: { code: 'CONFLICT', message, errorId },
      });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Record not found', errorId },
      });
      return;
    }
  }

  if ((err as any)?.type === 'entity.too.large') {
    res.status(413).json({
      success: false,
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Uploaded file is too large', errorId },
    });
    return;
  }

  // 2026-06-01 — structured. errorId is returned to the client AND
  // logged so a user's "error 3f9a1c2b" maps to a single log line; reqId
  // ties it to the full request context from pino-http.
  logger.error({ err, errorId, reqId: (req as any).id, method: req.method, path: req.originalUrl }, 'unhandled error');
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: isDev ? (err.message || 'An unexpected error occurred') : 'An unexpected error occurred',
      errorId,
    },
  });
}
