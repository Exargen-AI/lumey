/**
 * Typed, actionable SDK errors. Seniors trust an SDK whose failures they can
 * branch on: every error says whether a retry could help (`retryable`), carries
 * the HTTP `status` and platform `code` when there was one, and surfaces the
 * `runId`/`traceId` so a failure ties straight back to the trace.
 *
 * The platform's domain errors map to specific classes — an agent can `catch`
 * `ApprovalRequiredError` and park, or `ClarificationPendingError` and ask —
 * instead of string-matching messages.
 */
export interface LumeyErrorContext {
  status?: number;
  code?: string;
  runId?: string;
  traceId?: string;
  retryable?: boolean;
  cause?: unknown;
}

export class LumeyError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly runId?: string;
  readonly traceId?: string;
  readonly retryable: boolean;

  constructor(message: string, ctx: LumeyErrorContext = {}) {
    super(message);
    this.name = new.target.name;
    this.status = ctx.status;
    this.code = ctx.code;
    this.runId = ctx.runId;
    this.traceId = ctx.traceId;
    this.retryable = ctx.retryable ?? false;
    if (ctx.cause !== undefined) (this as { cause?: unknown }).cause = ctx.cause;
  }
}

/** The request never reached a response (network/DNS/timeout). Retryable. */
export class LumeyConnectionError extends LumeyError {
  constructor(message: string, cause?: unknown) {
    super(message, { retryable: true, cause });
  }
}

/** 401/403 — bad or missing credentials. Not retryable. */
export class LumeyAuthError extends LumeyError {}

/** 429 / 5xx — transient platform fault. Retryable. */
export class LumeyUnavailableError extends LumeyError {}

/** The model/agent exhausted its token or step budget. */
export class BudgetExceededError extends LumeyError {}

/** A risky action needs human approval before it can proceed. */
export class ApprovalRequiredError extends LumeyError {}

/** The agent asked a question and must wait for a human answer. */
export class ClarificationPendingError extends LumeyError {}

/** A response did not match the contract schema (server/SDK drift). Not retryable. */
export class LumeyContractError extends LumeyError {}

const CODE_MAP: Record<string, new (m: string, c?: LumeyErrorContext) => LumeyError> = {
  BUDGET_EXCEEDED: BudgetExceededError,
  APPROVAL_REQUIRED: ApprovalRequiredError,
  CLARIFICATION_PENDING: ClarificationPendingError,
};

/** Map an HTTP status + platform error body to the most specific error class. */
export function errorFromResponse(
  status: number,
  body: { error?: { code?: string; message?: string; runId?: string; traceId?: string } } | undefined,
): LumeyError {
  const err = body?.error;
  const ctx: LumeyErrorContext = {
    status,
    code: err?.code,
    runId: err?.runId,
    traceId: err?.traceId,
    retryable: status === 429 || status >= 500,
  };
  const message = err?.message ?? `request failed (${status})`;

  if (err?.code && CODE_MAP[err.code]) return new CODE_MAP[err.code](message, ctx);
  if (status === 401 || status === 403) return new LumeyAuthError(message, ctx);
  if (status === 429 || status >= 500) return new LumeyUnavailableError(message, ctx);
  return new LumeyError(message, ctx);
}
