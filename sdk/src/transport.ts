/**
 * Transport — the HTTP layer the resources sit on. Kept behind an interface so
 * the client can run against a real server (`HttpTransport`) or an in-memory
 * fake (`MockTransport`) with zero code change, which is how the SDK is tested
 * without burning a backend.
 *
 * It owns the cross-cutting concerns every call needs: bearer auth, the
 * `{success,data}` envelope unwrap, a request deadline, bounded retry on
 * *retryable* failures, mapping non-2xx bodies to typed errors, and an
 * **idempotency key on every write** (agents crash and resume constantly).
 */
import { LumeyConnectionError, errorFromResponse, type LumeyError } from './errors';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Override the auto-generated idempotency key for a write. */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface Transport {
  request<T>(method: HttpMethod, path: string, opts?: RequestOptions): Promise<T>;
}

export interface HttpTransportConfig {
  /** API base, including the version prefix, e.g. `http://localhost:3000/api/v1`. */
  baseUrl: string;
  /** Bearer token for the agent/service account. */
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  sleepImpl?: (ms: number) => Promise<void>;
  /** Origin header for the platform's CSRF guard. Defaults to the API's own origin (same-origin). */
  origin?: string;
}

const WRITE_METHODS = new Set<HttpMethod>(['POST', 'PUT', 'PATCH', 'DELETE']);

function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `idem_${Date.now()}_${Math.round(Math.random() * 1e9)}`;
}

function buildQuery(query?: RequestOptions['query']): string {
  if (!query) return '';
  const parts = Object.entries(query)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

export class HttpTransport implements Transport {
  private readonly cfg: Required<Omit<HttpTransportConfig, 'fetchImpl' | 'sleepImpl' | 'origin'>> & HttpTransportConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly origin: string;

  constructor(config: HttpTransportConfig) {
    if (!config.baseUrl) throw new Error('HttpTransport: baseUrl is required');
    this.cfg = { timeoutMs: 30_000, maxRetries: 2, retryBaseMs: 200, ...config };
    const f = config.fetchImpl ?? globalThis.fetch;
    if (!f) throw new Error('HttpTransport: no fetch available; pass fetchImpl');
    this.fetchImpl = f;
    this.sleep = config.sleepImpl ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.origin = config.origin ?? safeOrigin(config.baseUrl);
  }

  async request<T>(method: HttpMethod, path: string, opts: RequestOptions = {}): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.cfg.maxRetries; attempt++) {
      try {
        return await this.attempt<T>(method, path, opts);
      } catch (e) {
        lastErr = e;
        const retryable = (e as LumeyError | undefined)?.retryable;
        if (!retryable || attempt === this.cfg.maxRetries) throw e;
        await this.sleep(this.cfg.retryBaseMs * 2 ** attempt);
      }
    }
    throw lastErr;
  }

  private async attempt<T>(method: HttpMethod, path: string, opts: RequestOptions): Promise<T> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}${path}${buildQuery(opts.query)}`;
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.cfg.token}`,
      accept: 'application/json',
      // writes pass the platform's CSRF origin guard (same-origin by default):
      origin: this.origin,
    };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (WRITE_METHODS.has(method)) headers['idempotency-key'] = opts.idempotencyKey ?? newIdempotencyKey();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      throw new LumeyConnectionError(`request to ${method} ${path} failed`, e);
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }

    const text = await res.text();
    const body = text ? safeJson(text) : undefined;
    if (!res.ok) throw errorFromResponse(res.status, body as { error?: { code?: string } });
    // Unwrap the platform envelope; tolerate a bare body or an empty 204.
    return (body && typeof body === 'object' && 'data' in body ? (body as { data: T }).data : (body as T)) ?? (undefined as T);
  }
}

function safeOrigin(baseUrl: string): string {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return baseUrl;
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** An in-memory transport for tests and a local mock/replay mode. */
export class MockTransport implements Transport {
  readonly calls: { method: HttpMethod; path: string; opts: RequestOptions }[] = [];
  constructor(private readonly handler: (method: HttpMethod, path: string, opts: RequestOptions) => unknown) {}
  async request<T>(method: HttpMethod, path: string, opts: RequestOptions = {}): Promise<T> {
    this.calls.push({ method, path, opts });
    return (await this.handler(method, path, opts)) as T;
  }
}
