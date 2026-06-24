/**
 * Structured application logger (2026-06-01 hardening pass).
 *
 * Replaces the ~130 ad-hoc `console.*` calls + morgan with a single
 * pino logger that emits newline-delimited JSON in production (parseable
 * by any aggregator — Datadog, Loki, CloudWatch) and pretty-prints in
 * development.
 *
 * Three things this gives us that console.* could not:
 *   1. Structured fields (level, time, service, env, requestId) on every
 *      line, so logs are queryable instead of grep-only.
 *   2. A dedicated `securityLogger` channel tagged `kind:"security"` so
 *      auth failures, lockouts, token-reuse, and authz denials are
 *      trivially alertable — previously these left ZERO trace.
 *   3. Automatic redaction of secret-bearing fields so a careless log
 *      call can't leak a token/password/api key.
 *
 * Usage:
 *   import { logger, securityLogger } from '../lib/logger';
 *   logger.error({ err, taskId }, 'failed to close task');
 *   securityLogger.warn({ event: 'login_failed', email, ip }, 'login failed');
 */

import pino from 'pino';
import { env } from '../config/env';

const isProd = env.NODE_ENV === 'production';
// Silent under any test runner. We check the runtime VITEST flag in
// addition to NODE_ENV because some suites stub NODE_ENV='production' to
// exercise prod-only branches — without the VITEST check those would
// flip the logger on and flood test output.
const isTest = env.NODE_ENV === 'test' || process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';

/**
 * Paths whose values pino redacts to `[Redacted]` before writing. Covers
 * the shapes secrets travel in: request headers (auth/cookie), and any
 * field literally named like a credential anywhere in the logged object.
 */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'headers.authorization',
  'headers.cookie',
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'apiKeyHash',
  'enrollmentToken',
  'secret',
  'jwt',
  '*.password',
  '*.token',
  '*.apiKey',
  '*.secret',
];

export const logger = pino({
  level: env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
  // Silence logs entirely during unit tests to keep CI output clean —
  // tests assert behaviour, not log lines.
  enabled: !isTest,
  base: { service: 'command-center-api', env: env.NODE_ENV },
  redact: { paths: REDACT_PATHS, censor: '[Redacted]' },
  // Pretty output in dev; raw JSON in prod. `pino-pretty` is a devDep.
  transport: isProd
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,service,env' } },
});

/**
 * Security-event channel. Every line is tagged `kind:"security"` so an
 * alert rule can match `kind=security AND level>=warn`. Use for: failed
 * logins, account lockouts, refresh-token reuse, JWT rejections, authz
 * denials, rate-limit trips, webhook signature failures.
 *
 * These were the CRITICAL audit gap — an attacker probing the system
 * previously left no trace at all.
 */
export const securityLogger = logger.child({ kind: 'security' });
