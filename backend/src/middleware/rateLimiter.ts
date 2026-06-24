import rateLimit, { type Options } from 'express-rate-limit';
import { env } from '../config/env';
import { securityLogger } from '../lib/logger';

// 2026-06-01 hardening — shared handler so EVERY limiter trip is logged
// on the security channel (previously rate-limit hits were silent, so a
// brute-force or scraping run left no trace). Still returns the
// limiter's configured message/status to the client.
function loggingHandler(name: string) {
  return (req: Parameters<Options['handler']>[0], res: Parameters<Options['handler']>[1], _next: unknown, options: Options) => {
    securityLogger.warn(
      { event: 'rate_limited', limiter: name, ip: req.ip, method: req.method, path: req.originalUrl, userId: (req as any).user?.id },
      'rate limit exceeded',
    );
    res.status(options.statusCode).json(options.message);
  };
}

// Production cap raised from 5 → 200 to accommodate the agent-runtime
// poller. The headless poller's per-task --rm container model issues one
// /auth/login per container boot (the cc CLI in each container has no
// shared token cache), so even a single agent can burn 5 logins in
// seconds during a multi-task work cycle.
//
// Defense-in-depth: per-account brute-force protection still applies via
// User.failedLoginCount + User.lockedUntil (auth.service), which locks
// individual accounts after repeated wrong-password attempts regardless
// of IP. The 200/15min ceiling here only governs how many TOTAL login
// attempts a single IP can make in a window, which is the right shape
// for an operator's laptop running an agent + occasional human logins.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === 'development' ? 50 : 200,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again in 15 minutes.' } },
  standardHeaders: true,
  legacyHeaders: false,
  handler: loggingHandler('authLimiter'),
});

// Rate limit for token refresh — prevent brute force
export const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: env.NODE_ENV === 'development' ? 100 : 30,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many refresh attempts.' } },
  standardHeaders: true,
  legacyHeaders: false,
  handler: loggingHandler('refreshLimiter'),
});

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: env.NODE_ENV === 'development' ? 200 : 100,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down.' } },
  standardHeaders: true,
  legacyHeaders: false,
  handler: loggingHandler('apiLimiter'),
});

// Public CMS routes — anyone with the API key can call these from external
// websites. Tighter ceiling than apiLimiter because there's no auth gate
// upstream to attribute calls to a user; everything is per-IP. The limit
// still allows legitimate consumer sites (a blog rendering 50 articles per
// page-view, for example) plenty of headroom.
export const publicCmsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: env.NODE_ENV === 'development' ? 300 : 60,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. If you\'re an integration, slow your polling.' } },
  standardHeaders: true,
  legacyHeaders: false,
  handler: loggingHandler('publicCmsLimiter'),
});

// 2026-06-01 hardening — per-DEVICE telemetry ingest limiter. The Pulse
// agent heartbeats every 5 min + snapshots hourly, so a healthy device
// sends a handful of requests per hour. Keyed on the authenticated
// device id (set by deviceAuthenticate, which runs first) rather than
// IP, so a whole fleet behind one office NAT isn't throttled as a unit
// AND a single compromised/buggy agent can't flood ingest. Generous
// ceiling (120/5min) absorbs a reconnect storm without ever hitting a
// well-behaved device.
export const deviceTelemetryLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: env.NODE_ENV === 'development' ? 600 : 120,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Telemetry rate exceeded. Back off and retry.' } },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req as any).device?.id ?? req.ip ?? 'unknown',
  handler: loggingHandler('deviceTelemetryLimiter'),
});

// Plan-ingest endpoint guard. /parse is CPU-bound (parses up to 500 KB of
// markdown per call) so even an authenticated member could spam it (QA
// I-L11). Tight ceiling per-window — real ingestion is a once-per-project
// activity, not a hot-path API. Same limiter is applied to /commit since
// each commit walks the parsed tree + DB.
export const ingestLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,  // 5 min
  max: env.NODE_ENV === 'development' ? 60 : 10,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many ingest calls. Plan ingestion is meant to run once per project; pause and try again in a few minutes.' } },
  standardHeaders: true,
  legacyHeaders: false,
  handler: loggingHandler('ingestLimiter'),
});
