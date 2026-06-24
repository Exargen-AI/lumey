import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import path from 'path';

import { env } from './config/env';
import { logger } from './lib/logger';
import { corsOptions } from './config/cors';
import { errorHandler } from './middleware/errorHandler';
import { apiLimiter } from './middleware/rateLimiter';
import { requireOrigin } from './middleware/requireOrigin';
import { stripDangerousKeys } from './middleware/stripDangerousKeys';
import prisma from './config/database';
import { syncPermissionDefinitions } from './services/permissionSync.service';
import { seedAgentUsers } from './seed/agentUsers.seed';

import authRoutes from './routes/auth.routes';
import rbacRoutes from './routes/rbac.routes';
import projectRoutes from './routes/project.routes';
import taskRoutes from './routes/task.routes';
import milestoneRoutes from './routes/milestone.routes';
import decisionRoutes from './routes/decision.routes';
import projectAckRoutes from './routes/projectAcknowledgment.routes';
import deliverableRoutes from './routes/deliverable.routes';
import projectDocumentRoutes from './routes/projectDocument.routes';
import statusUpdateRoutes from './routes/statusUpdate.routes';
import userRoutes from './routes/user.routes';
import activityRoutes from './routes/activity.routes';
import analyticsRoutes from './routes/analytics.routes';
import adminRoutes from './routes/admin.routes';
import dailyUpdateRoutes from './routes/dailyUpdate.routes';
import sprintRoutes from './routes/sprint.routes';
import customFieldRoutes from './routes/customField.routes';
import agentRoutes from './routes/agent.routes';
import githubIntegrationRoutes from './routes/githubIntegration.routes';
import projectIngestionRoutes from './routes/projectIngestion.routes';
import projectForecastRoutes from './routes/projectForecast.routes';
import clientActionsRoutes from './routes/clientActions.routes';
import recentProgressRoutes from './routes/recentProgress.routes';
import currentSprintRoutes from './routes/currentSprint.routes';
import todayRoutes from './routes/today.routes';
import openapiRoutes from './routes/openapi.routes';

import { ModuleRegistry, ConfigEntitlements } from './kernel';
import { commentsModule } from './modules/comments';
import { notificationsModule } from './modules/notifications';
import { agentRuntimeModule } from './modules/agent-runtime';

const app = express();

// ── Kernel: capability modules ──────────────────────────────────────────
// Modules register here and are mounted by entitlement, in dependency order.
// M0 migrates `comments` as the first module; the rest follow incrementally.
// `mount` is synchronous (slots into the route section below); `boot` runs
// each module's init hook during bootstrap, before the listener opens.
const registry = new ModuleRegistry(new ConfigEntitlements());
registry.register(commentsModule);
registry.register(notificationsModule);
registry.register(agentRuntimeModule);

// Middleware stack — Security hardened
//
// `connect-src` matters for the cross-origin Vercel ↔ Railway production
// setup (QA finding H-C2): when CSP is set without an explicit connect-src,
// browsers fall back to `default-src 'self'`, which BLOCKS the SPA's XHR
// from the Vercel domain to the Railway backend domain. Symptom in prod:
// every fetch fails silently with a CSP violation in the console. We add
// the backend's own public URL plus every entry in CORS_ORIGIN so the
// frontend hostname can talk back, and also include the Railway internal
// proxy host fallback for first-deploy debugging.
const corsOriginList = env.CORS_ORIGIN
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const cspConnectSrc = ["'self'", ...corsOriginList];
if (env.BACKEND_PUBLIC_URL) cspConnectSrc.push(env.BACKEND_PUBLIC_URL);

app.use(helmet({
  crossOriginResourcePolicy: false,
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  contentSecurityPolicy: env.NODE_ENV === 'production' ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      // Connect-src includes self + the configured frontend origin(s) so
      // the SPA's fetch to /api/v1/* isn't blocked by a stricter default.
      connectSrc: cspConnectSrc,
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
    },
  } : false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  frameguard: { action: 'deny' },
}));
// Required so req.ip honors a single trusted reverse proxy (Heroku/Render/
// Cloudflare/Nginx in front). Without this, x-forwarded-for is consulted
// regardless of source — meaning an attacker on a direct internet socket can
// forge their own IP into legal acknowledgment rows (QA finding #48). One
// hop is enough for our typical PaaS deployment; tighten further if you put
// multiple proxies in front.
app.set('trust proxy', env.TRUSTED_PROXY_HOPS);

app.use(cors(corsOptions));
// Structured request logging (2026-06-01 hardening — replaces morgan's
// freeform text). Emits one JSON line per request with a stable
// `requestId` (honours an inbound `x-request-id` for cross-service
// correlation, else mints a UUID) so logs are queryable + traceable.
app.use(
  pinoHttp({
    logger,
    genReqId: (req, res) => {
      const incoming = req.headers['x-request-id'];
      const id = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
      res.setHeader('x-request-id', id);
      return id;
    },
    // Quieter health/readiness probes — they fire constantly and carry
    // no signal. Everything else logs at info; 4xx/5xx escalate.
    autoLogging: {
      ignore: (req) => req.url === '/api/v1/health' || req.url === '/api/v1/ready',
    },
    customLogLevel: (_req, res, err) =>
      err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
  }),
);
// Tight cap on /auth so a 25MB email payload can't burn bcrypt CPU before
// validation kicks in (QA finding #6/#17). Mounted ahead of the catch-all
// 25MB parser so it wins for /auth/* paths.
app.use('/api/v1/auth', express.json({ limit: '8kb' }));
// GitHub webhook needs the RAW body Buffer for HMAC verification — the
// default JSON parser consumes the buffer before the handler sees it. We
// capture it onto req.rawBody only for the webhook path so memory cost is
// minimal. 1MB cap matches GitHub's max webhook payload size.
app.use('/api/v1/integrations/github/webhook', express.json({
  limit: '1mb',
  verify: (req, _res, buf) => { (req as unknown as { rawBody: Buffer }).rawBody = Buffer.from(buf); },
}));
app.use(express.json({ limit: '25mb' }));
// Defense-in-depth against prototype-pollution payloads. Sits AFTER all
// JSON parsers (so it runs on every parsed body) and BEFORE any handler /
// validator. Round 2 finding R3.
app.use(stripDangerousKeys);
app.use(cookieParser());
// CSRF smoke filter: state-changing requests without an Origin (or Referer)
// header are refused with 403. Sits after cookieParser so refresh-cookie
// flows still work when Origin IS sent (the common case). See requireOrigin
// for the carve-outs (public CMS, /uploads, GET/HEAD/OPTIONS).
app.use(requireOrigin);
app.use(apiLimiter);
app.use(
  '/uploads',
  express.static(path.resolve(process.cwd(), 'uploads'), {
    setHeaders: (res) => {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader(
        'Cache-Control',
        env.NODE_ENV === 'production'
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=0, must-revalidate'
      );
    },
  })
);

// Liveness — "the process is up". Cheap; never touches the DB so a
// transient DB blip doesn't get the pod killed by the orchestrator.
app.get('/api/v1/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

// Readiness — "the process can serve traffic" (2026-06-01 hardening).
// Pings the DB with a trivial `SELECT 1`; returns 503 when the DB is
// unreachable so the load balancer / k8s readiness gate stops routing
// to a pod whose Postgres connection is dead instead of serving errors.
app.get('/api/v1/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ success: true, data: { status: 'ready' } });
  } catch (err) {
    logger.error({ err }, 'readiness probe failed: DB unreachable');
    res.status(503).json({ success: false, error: { code: 'NOT_READY', message: 'Database unreachable' } });
  }
});

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/rbac', rbacRoutes);
app.use('/api/v1/projects', projectRoutes);
app.use('/api/v1', taskRoutes);
app.use('/api/v1', milestoneRoutes);
app.use('/api/v1', decisionRoutes);
app.use('/api/v1', projectAckRoutes);
app.use('/api/v1', deliverableRoutes);
app.use('/api/v1', projectDocumentRoutes);
// Kernel-managed capability modules (M0: comments). Mounted in dependency
// order, gated by entitlement.
registry.mount(app);
app.use('/api/v1', statusUpdateRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1', activityRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1', dailyUpdateRoutes);
app.use('/api/v1', sprintRoutes);
app.use('/api/v1', customFieldRoutes);
app.use('/api/v1', agentRoutes);
// 2026-05-23 — OpenAPI spec serving. Mounted alongside the other API
// routes at /api/v1/openapi.json + /api/v1/docs. Documents the agent
// control plane endpoints (Layer 2) + extends to additional surfaces
// as they're registered. Public — exposing the spec doesn't grant
// access, just describes what's there.
app.use('/api/v1', openapiRoutes);
app.use('/api/v1', githubIntegrationRoutes);
app.use('/api/v1', projectIngestionRoutes);
app.use('/api/v1', projectForecastRoutes);
app.use('/api/v1', clientActionsRoutes);
app.use('/api/v1', recentProgressRoutes);
app.use('/api/v1', currentSprintRoutes);
// "Done today" daily-wrap-up endpoint — role-aware visibility computed
// inside the service.
app.use('/api/v1', todayRoutes);

// Error handler (must be last)
app.use(errorHandler);

let server: ReturnType<typeof app.listen>;

let shuttingDown = false;
const shutdown = async (signal?: string) => {
  // Guard against double-fire (SIGTERM then SIGINT, or a handler racing
  // an uncaught-exception exit).
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down gracefully');
  // 2026-06-01 hardening — DRAIN in-flight requests before tearing down
  // the DB. Previously `server.close()` was fire-and-forget and
  // `prisma.$disconnect()` + `process.exit(0)` ran immediately, killing
  // any request mid-flight on every deploy/scale event. Now we await the
  // close (no new connections accepted, existing ones drain) with a hard
  // 10s ceiling so a hung keep-alive socket can't block the deploy.
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => {
      logger.warn('shutdown drain timed out after 10s — forcing close');
      resolve();
    }, 10_000);
    if (typeof (t as any).unref === 'function') (t as any).unref();
    if (server) server.close(() => { clearTimeout(t); resolve(); });
    else { clearTimeout(t); resolve(); }
  });
  await prisma.$disconnect();
  process.exit(0);
};

async function bootstrap() {
  // Idempotently sync the permission catalog so newly-introduced permissions
  // (e.g. the deliverable.* set) land in production without manual seeding.
  // Only inserts rows that don't yet exist — admin RBAC tweaks are preserved.
  const permSync = await syncPermissionDefinitions();
  if (permSync.inserted > 0) {
    logger.info({ inserted: permSync.inserted, total: permSync.total }, 'permission sync');
  }

  // Idempotently provision Manjari (the v1 agent user) if MANJARI_PASSWORD
  // is set in the environment. Skipped silently otherwise — the seed itself
  // checks the env var and returns early without logging anything sensitive.
  // Same non-fatal pattern as the onboarding seed: a failure is logged but
  // does not block server startup.
  try {
    await seedAgentUsers();
  } catch (err) {
    logger.warn({ err }, 'agent user seed failed (non-fatal)');
  }

  // Boot capability modules (init hooks / event subscriptions) before the
  // listener opens, so subscriptions are live before the first request.
  await registry.boot();
  logger.info({ modules: registry.enabledModuleIds() }, 'kernel modules enabled');

  server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'server listening');
  });

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

// 2026-06-01 hardening — process-level safety net. Previously an
// unhandled rejection or uncaught exception (e.g. inside a background
// `void runSweep()`) crashed with Node's default warning and no
// structured cause. Now we log it on the security/error channel and, for
// a truly uncaught exception (unknown process state), exit so the
// orchestrator restarts a clean instance.
process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'unhandledRejection (process kept alive)');
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaughtException — exiting for a clean restart');
  // Best-effort drain, then hard exit. Don't await indefinitely.
  void shutdown('uncaughtException').finally(() => process.exit(1));
});

bootstrap().catch(async (error) => {
  logger.fatal({ err: error }, 'failed to start server');
  await prisma.$disconnect();
  process.exit(1);
});

export default app;
