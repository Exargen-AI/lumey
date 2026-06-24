import { Request, Response, NextFunction } from 'express';

/**
 * Refuses state-changing requests that arrive without an `Origin` header
 * (QA finding #34). Modern browsers send Origin on every cross-origin AND
 * same-origin POST/PUT/PATCH/DELETE — its absence is a strong signal the
 * request was crafted by `<form>`-style CSRF, a CLI replay, or a non-browser
 * tool that hasn't earned trust. Refresh and login are public flows so they
 * still need to work pre-auth, but the rest of the API does not.
 *
 * GET / HEAD / OPTIONS are read-only or preflight, so we let them through.
 * Public CMS endpoints (rendered by external sites with API keys) are also
 * skipped — those use a per-project API key for auth.
 */
// Public paths plus inbound webhooks. GitHub's webhook POST doesn't carry
// an Origin header (User-Agent is `GitHub-Hookshot/...`); the trust boundary
// for that endpoint is HMAC verification inside the handler, not Origin.
//
// QA A-M4: previously `/uploads` and `/api/v1/health` were here too, which
// was fine in practice (both are read-only) but inherited the carve-out
// for any future PUT/DELETE mounted under those prefixes. Removed them
// from the carve-out — reads already pass via the GET/HEAD/OPTIONS short-
// circuit below, and any state-changing operation under those paths now
// has to satisfy Origin like every other mutation.
const PUBLIC_PATH_PREFIXES = [
  '/api/v1/cms/public',
  '/api/v1/integrations/github/webhook',
  // Pulse org-level GitHub webhook (Wave 3, PR #33). Same posture as
  // the per-project webhook above: HMAC verification inside the
  // handler is the trust boundary.
  '/api/v1/webhooks/github/pulse',
  // 2026-05-28b — Pulse Windows agent endpoints. The agent is server-
  // to-server (axios from Node, no browser, no cookies). Auth is via
  // `Authorization: Device <key>` (per-device API key, hashed in DB)
  // for heartbeat/snapshot, and via the single-use enrollment token in
  // the body for enroll. Neither has any browser-cookie attack
  // surface, so the Origin CSRF check doesn't apply.
  '/api/v1/devices/',
];

export function requireOrigin(req: Request, res: Response, next: NextFunction) {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }

  if (PUBLIC_PATH_PREFIXES.some((p) => req.path.startsWith(p))) {
    return next();
  }

  // Origin OR Referer is acceptable. Some CLI tools (curl) explicitly omit
  // both, but legitimate browser fetches always set at least one. Cookies
  // require credentials anyway, so a missing Origin on a cookie-bearing
  // mutation is a CSRF smoke signal.
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  if (!origin && !referer) {
    res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Origin header required for this request' },
    });
    return;
  }
  next();
}
