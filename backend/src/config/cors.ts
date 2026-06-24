import { CorsOptionsDelegate } from 'cors';
import type { Request } from 'express';
import { env } from './env';

const allowedOrigins = env.CORS_ORIGIN
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const normalizeOrigin = (origin: string) => origin.replace(/\/$/, '');

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const matchesConfiguredOrigin = (origin: string) => {
  const normalizedOrigin = normalizeOrigin(origin);

  return allowedOrigins.some((allowedOrigin) => {
    if (!allowedOrigin) {
      return false;
    }

    if (allowedOrigin === '*') {
      return true;
    }

    const normalizedAllowedOrigin = normalizeOrigin(allowedOrigin);

    if (!normalizedAllowedOrigin.includes('*')) {
      return normalizedAllowedOrigin === normalizedOrigin;
    }

    const pattern = `^${escapeRegex(normalizedAllowedOrigin).replace(/\\\*/g, '.*')}$`;
    return new RegExp(pattern, 'i').test(normalizedOrigin);
  });
};

const isLocalDevelopmentOrigin = (origin: string) => {
  try {
    const parsed = new URL(origin);
    return ['localhost', '127.0.0.1'].includes(parsed.hostname);
  } catch {
    return false;
  }
};

const publicCorsPaths = ['/api/v1/cms/public', '/api/v1/public', '/uploads'];

const baseOptions = {
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

export const corsOptions: CorsOptionsDelegate<Request> = (req, callback) => {
  const origin = req.header('Origin');
  const isPublicPath = publicCorsPaths.some((path) => req.path.startsWith(path));

  if (!origin) {
    callback(null, {
      ...baseOptions,
      origin: true,
      credentials: !isPublicPath,
    });
    return;
  }

  if (isPublicPath) {
    callback(null, {
      ...baseOptions,
      origin: true,
      credentials: false,
    });
    return;
  }

  const isAllowed =
    matchesConfiguredOrigin(origin) ||
    (env.NODE_ENV !== 'production' && isLocalDevelopmentOrigin(origin));

  callback(null, {
    ...baseOptions,
    origin: isAllowed,
    credentials: isAllowed,
  });
};
