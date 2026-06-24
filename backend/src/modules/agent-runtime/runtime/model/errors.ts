/**
 * Typed model-client failures. Every error carries a `retryable` flag so the
 * LoopController (M2.7) can back off on transient faults and fail fast on
 * permanent ones, and an optional HTTP `status` for diagnostics/trace. The
 * client never throws a bare string or a raw `fetch` error — callers always get
 * one of these.
 */

function truncate(body: string, max = 300): string {
  return body.length > max ? `${body.slice(0, max)}…` : body;
}

export class ModelError extends Error {
  /** Whether a back-off retry could plausibly succeed. */
  readonly retryable: boolean;
  /** HTTP status, when the failure came from an HTTP response. */
  readonly status?: number;

  constructor(message: string, opts: { retryable: boolean; status?: number; cause?: unknown }) {
    super(message);
    this.name = new.target.name;
    this.retryable = opts.retryable;
    this.status = opts.status;
    if (opts.cause !== undefined) {
      (this as { cause?: unknown }).cause = opts.cause;
    }
  }
}

/** 401/403 — bad/missing credentials. Never retried. */
export class ModelAuthError extends ModelError {
  constructor(status: number) {
    super(`model auth failed (${status})`, { retryable: false, status });
  }
}

/** 429 — rate limited. Retried with back-off. */
export class ModelRateLimitError extends ModelError {
  constructor(status = 429) {
    super('model rate limited', { retryable: true, status });
  }
}

/** 5xx — backend down/overloaded. Retried with back-off. */
export class ModelUnavailableError extends ModelError {
  constructor(status: number) {
    super(`model backend unavailable (${status})`, { retryable: true, status });
  }
}

/** 4xx other than 401/403/429 — the request itself is bad. Never retried. */
export class ModelRequestError extends ModelError {
  constructor(status: number, body?: string) {
    super(`model rejected request (${status})${body ? `: ${truncate(body)}` : ''}`, {
      retryable: false,
      status,
    });
  }
}

/** Client-side timeout (our deadline, not the caller's cancel). Retried. */
export class ModelTimeoutError extends ModelError {
  constructor(ms: number) {
    super(`model request timed out after ${ms}ms`, { retryable: true });
  }
}

/** Transport-level failure (DNS, connection reset, …). Retried. */
export class ModelTransportError extends ModelError {
  constructor(cause: unknown) {
    super(`model transport error: ${cause instanceof Error ? cause.message : String(cause)}`, {
      retryable: true,
      cause,
    });
  }
}

/** A 2xx response we couldn't make sense of (no choices, bad JSON). Never retried. */
export class ModelProtocolError extends ModelError {
  constructor(message: string) {
    super(`model protocol error: ${message}`, { retryable: false });
  }
}
