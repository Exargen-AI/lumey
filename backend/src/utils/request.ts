import type { Request } from 'express';

// Best-effort IP capture. `req.ip` respects the Express trust-proxy setting; we
// also try common forwarded headers as a fallback. Returns null if nothing
// useful is available. Used for legally-defensible signature/acknowledgment
// records where we want IP forensics on every signing event.
export function captureIp(req: Request): string | null {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  return req.ip || null;
}

export function captureUserAgent(req: Request): string | null {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' ? ua : null;
}
