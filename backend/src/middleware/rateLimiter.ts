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
