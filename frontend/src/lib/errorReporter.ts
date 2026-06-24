/**
 * Frontend error reporter (2026-06-01 enterprise hardening).
 *
 * Env-gated, dependency-free, and Sentry-ready. It is a complete NO-OP
 * unless `VITE_ERROR_REPORTING_DSN` is set, so local dev and any deploy
 * that hasn't configured a collector pays zero cost and transmits nothing.
 *
 * Why no @sentry/react dependency? The audit asked for a reporting *hook*
 * that's ready for Sentry, not a Sentry integration that bloats the bundle
 * and demands a live DSN to build. This module is the seam:
 *
 *   Transport priority
 *     1. If a Sentry SDK has been loaded onto `window.Sentry` (e.g. a
 *        future loader <script> or an `@sentry/react` install that calls
 *        Sentry.init), we delegate to `Sentry.captureException` and become
 *        a thin adapter — no rewrite needed.
 *     2. Otherwise we POST a compact JSON envelope to the configured
 *        DSN/ingest URL via `navigator.sendBeacon` (survives page unload),
 *        falling back to `fetch(..., { keepalive: true })`.
 *
 * Privacy: we never attach the auth token, cookies, or credentials to the
 * collector, and we strip the query string + hash from the reported URL
 * (those can carry tokens/PII). Reporting must NEVER throw — every path is
 * wrapped so a failing collector can't take down the app.
 */

type ErrorSource =
  | 'error-boundary'
  | 'window.onerror'
  | 'unhandledrejection'
  | 'api'
  | 'manual';

interface ReportContext {
  source?: ErrorSource;
  /** React component stack from an ErrorBoundary, if available. */
  componentStack?: string;
  /** Extra JSON-serialisable tags. Must not contain secrets/PII. */
  extra?: Record<string, unknown>;
}

const DSN = ((import.meta.env.VITE_ERROR_REPORTING_DSN as string | undefined) ?? '').trim();
const RELEASE = ((import.meta.env.VITE_APP_RELEASE as string | undefined) ?? '').trim() || 'unknown';
const ENVIRONMENT = (import.meta.env.MODE as string | undefined) || 'production';

/** True only when a collector endpoint is configured. */
export function isErrorReportingEnabled(): boolean {
  return DSN.length > 0;
}

// ─── Flood control ─────────────────────────────────────────────────────
// A render-throw can fire every frame. Suppress identical signatures
// (message + first stack frame) inside a short window so an error loop
// can't hammer the collector or the network.
const recent = new Map<string, number>();
const DEDUP_WINDOW_MS = 5000;

function signature(message: string, stackHead: string): string {
  return `${message}::${stackHead}`;
}

function shouldSend(sig: string, now: number): boolean {
  // Opportunistic prune so the map can't grow without bound.
  if (recent.size > 100) {
    for (const [k, t] of recent) {
      if (now - t > DEDUP_WINDOW_MS) recent.delete(k);
    }
  }
  const last = recent.get(sig);
  if (last !== undefined && now - last < DEDUP_WINDOW_MS) return false;
  recent.set(sig, now);
  return true;
}

/** Drop query + hash — they can carry tokens/PII. */
function scrubUrl(href: string): string {
  try {
    const u = new URL(href);
    return u.origin + u.pathname;
  } catch {
    return href.split('?')[0] ?? href;
  }
}

function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string') return new Error(value);
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error(String(value));
  }
}

/**
 * Report an arbitrary error. No-op unless reporting is enabled. Safe to
 * call with anything (Error, string, rejection reason, …).
 */
export function reportError(error: unknown, context: ReportContext = {}): void {
  const err = toError(error);

  // Always surface in the console during dev for local debugging,
  // independent of whether a collector is configured.
  if (import.meta.env.DEV) {
    console.error('[errorReporter]', context.source ?? 'manual', err);
  }

  if (!isErrorReportingEnabled()) return;

  const now = Date.now();
  const stack = err.stack ?? '';
  const stackHead = stack.split('\n').slice(0, 2).join(' ').slice(0, 300);
  if (!shouldSend(signature(err.message, stackHead), now)) return;

  // 1) Sentry adapter path.
  const sentry = (window as unknown as { Sentry?: { captureException?: (e: unknown, hint?: unknown) => void } }).Sentry;
  if (sentry && typeof sentry.captureException === 'function') {
    try {
      sentry.captureException(err, {
        tags: { source: context.source ?? 'manual', release: RELEASE, environment: ENVIRONMENT },
        extra: { componentStack: context.componentStack, ...context.extra },
      });
      return;
    } catch {
      // fall through to beacon transport
    }
  }

  // 2) Beacon/fetch transport.
  send({
    message: err.message,
    name: err.name,
    stack: stack.slice(0, 4000),
    source: context.source ?? 'manual',
    componentStack: context.componentStack?.slice(0, 4000),
    release: RELEASE,
    environment: ENVIRONMENT,
    url: scrubUrl(typeof window !== 'undefined' ? window.location.href : ''),
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    timestamp: new Date(now).toISOString(),
    extra: context.extra,
  });
}

function send(payload: unknown): void {
  let body: string;
  try {
    body = JSON.stringify(payload);
  } catch {
    return;
  }

  // sendBeacon survives page unload — best for errors that precede a crash.
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon(DSN, blob)) return;
    }
  } catch {
    // fall through to fetch
  }

  try {
    void fetch(DSN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'omit', // never send cookies to the collector
      mode: 'cors',
    }).catch(() => {
      /* swallow — reporting must never throw */
    });
  } catch {
    /* swallow */
  }
}

/** Adapter for `<ErrorBoundary onError={...}>`. */
export function reportBoundaryError(error: Error, info: { componentStack?: string | null }): void {
  reportError(error, {
    source: 'error-boundary',
    componentStack: info.componentStack ?? undefined,
  });
}

/**
 * Report an axios-style API failure. Only server-side failures (5xx) and
 * network errors (no response) are reported — 4xx are expected
 * client/validation/auth conditions and would just be noise.
 */
export function reportApiError(error: {
  response?: { status?: number };
  config?: { url?: string; method?: string };
  message?: string;
}): void {
  const status = error?.response?.status;
  const isNetworkError = status === undefined;
  const isServerError = typeof status === 'number' && status >= 500;
  if (!isNetworkError && !isServerError) return;

  reportError(toError(error?.message ?? 'API request failed'), {
    source: 'api',
    extra: {
      status: status ?? 'network-error',
      url: error?.config?.url,
      method: error?.config?.method,
    },
  });
}

// ─── Global handlers ───────────────────────────────────────────────────
let installed = false;

/**
 * Install global `error` + `unhandledrejection` listeners once. Call from
 * the app entry point. Safe to call when reporting is disabled — the
 * listeners simply forward to `reportError`, which no-ops.
 */
export function initErrorReporting(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (event: ErrorEvent) => {
    // Resource-load failures (img/script) surface here with no `error`
    // object — those aren't actionable JS exceptions, so skip them.
    if (event.error) reportError(event.error, { source: 'window.onerror' });
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    reportError(event.reason, { source: 'unhandledrejection' });
  });
}

/** Test-only: reset the dedup cache + installed flag. */
export function __resetErrorReporterForTests(): void {
  recent.clear();
  installed = false;
}
