/**
 * HttpModelClient — a model-agnostic inference client over **raw HTTP**, no
 * vendor SDK. It speaks the OpenAI-compatible `/chat/completions` wire format,
 * which is the de-facto standard exposed by local servers (vLLM, Ollama,
 * llama.cpp) and frontier gateways alike. Point it at a `baseUrl` + `model` and
 * it works; swapping models is config, never code.
 *
 * What it owns: request/response mapping to our runtime-neutral types, a
 * deadline (timeout), bounded exponential-backoff retries on *retryable*
 * failures only, honest error classification, and SSE streaming.
 *
 * What it deliberately does NOT own: arg parsing/validation (ToolRunner, M2.5),
 * prompt assembly/caching (ContextEngine, M2.6), and routing between backends
 * (RoutingPolicy, later). This stays a thin, testable transport.
 */
import {
  ModelAuthError,
  ModelProtocolError,
  ModelRateLimitError,
  ModelRequestError,
  ModelTimeoutError,
  ModelTransportError,
  ModelUnavailableError,
} from './errors';
import type {
  ChatMessage,
  CompletionRequest,
  FinishReason,
  ModelClient,
  ModelResponse,
  ModelStreamChunk,
  ModelToolCall,
  TokenUsage,
} from './types';

export interface HttpModelClientConfig {
  /** Base URL of an OpenAI-compatible server, e.g. `http://localhost:11434/v1`. */
  baseUrl: string;
  /** Model id to request, e.g. `llama3.1` or `gpt-4o-mini`. */
  model: string;
  /** Bearer token. Omitted for most local servers; required by frontier gateways. */
  apiKey?: string;
  /** Per-request deadline in ms. Default 60_000. */
  timeoutMs?: number;
  /** Retry attempts on retryable failures (total tries = maxRetries + 1). Default 2. */
  maxRetries?: number;
  /** Base back-off in ms; doubles each attempt. Default 250. */
  retryBaseMs?: number;
  /** Extra headers (e.g. a gateway org id). */
  headers?: Record<string, string>;
  /** Injectable fetch (tests / custom transport). Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable sleep (deterministic retry tests). Defaults to a real timer. */
  sleepImpl?: (ms: number) => Promise<void>;
}

const DEFAULTS = { timeoutMs: 60_000, maxRetries: 2, retryBaseMs: 250 } as const;

function mapFinishReason(raw: unknown): FinishReason {
  switch (raw) {
    case 'stop':
    case 'length':
    case 'content_filter':
      return raw;
    case 'tool_calls':
    case 'function_call':
      return 'tool_calls';
    default:
      return 'unknown';
  }
}

/** Our neutral messages → OpenAI-compatible wire messages. */
function toWireMessages(messages: readonly ChatMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        })),
      };
    }
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    }
    return m.name ? { role: m.role, content: m.content, name: m.name } : { role: m.role, content: m.content };
  });
}

function buildBody(cfg: HttpModelClientConfig, req: CompletionRequest, stream: boolean): string {
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: toWireMessages(req.messages),
    stream,
  };
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    if (req.toolChoice) body.tool_choice = req.toolChoice;
  }
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
  if (req.stop?.length) body.stop = req.stop;
  if (stream) body.stream_options = { include_usage: true };
  return JSON.stringify(body);
}

function parseToolCalls(raw: unknown): ModelToolCall[] {
  if (!Array.isArray(raw)) return [];
  const calls: ModelToolCall[] = [];
  for (const tc of raw) {
    const fn = (tc as { function?: { name?: unknown; arguments?: unknown } }).function;
    if (!fn || typeof fn.name !== 'string') continue;
    calls.push({
      id: String((tc as { id?: unknown }).id ?? `call_${calls.length}`),
      name: fn.name,
      arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
    });
  }
  return calls;
}

function parseUsage(raw: unknown): TokenUsage {
  const u = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
  return {
    promptTokens: num(u.prompt_tokens),
    completionTokens: num(u.completion_tokens),
    totalTokens: num(u.total_tokens),
  };
}

export class HttpModelClient implements ModelClient {
  readonly model: string;
  private readonly cfg: Required<Pick<HttpModelClientConfig, 'timeoutMs' | 'maxRetries' | 'retryBaseMs'>> &
    HttpModelClientConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(config: HttpModelClientConfig) {
    if (!config.baseUrl) throw new Error('HttpModelClient: baseUrl is required');
    if (!config.model) throw new Error('HttpModelClient: model is required');
    this.cfg = { ...DEFAULTS, ...config };
    this.model = config.model;
    const f = config.fetchImpl ?? globalThis.fetch;
    if (!f) throw new Error('HttpModelClient: no fetch available; pass fetchImpl');
    this.fetchImpl = f;
    this.sleep = config.sleepImpl ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async complete(req: CompletionRequest): Promise<ModelResponse> {
    const res = await this.send(buildBody(this.cfg, req, false), req.signal);
    let json: unknown;
    try {
      json = await res.json();
    } catch (e) {
      throw new ModelProtocolError(`response was not JSON: ${e instanceof Error ? e.message : String(e)}`);
    }
    const choice = (json as { choices?: unknown[] }).choices?.[0] as
      | { message?: { content?: unknown; tool_calls?: unknown }; finish_reason?: unknown }
      | undefined;
    if (!choice?.message) throw new ModelProtocolError('response had no choices[0].message');
    return {
      content: typeof choice.message.content === 'string' ? choice.message.content : '',
      toolCalls: parseToolCalls(choice.message.tool_calls),
      finishReason: mapFinishReason(choice.finish_reason),
      usage: parseUsage((json as { usage?: unknown }).usage),
      model: typeof (json as { model?: unknown }).model === 'string' ? (json as { model: string }).model : this.model,
    };
  }

  async *stream(req: CompletionRequest): AsyncIterable<ModelStreamChunk> {
    const res = await this.send(buildBody(this.cfg, req, true), req.signal);
    if (!res.body) throw new ModelProtocolError('streaming response had no body');
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const bytes of res.body as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(bytes as Uint8Array, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;
        const chunk = this.parseStreamLine(data);
        if (chunk) yield chunk;
      }
    }
  }

  private parseStreamLine(data: string): ModelStreamChunk | null {
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return null; // tolerate keep-alive / non-JSON lines
    }
    const choice = (json as { choices?: unknown[] }).choices?.[0] as
      | { delta?: { content?: unknown }; finish_reason?: unknown }
      | undefined;
    if (!choice) return null;
    const delta = typeof choice.delta?.content === 'string' ? choice.delta.content : '';
    const finishReason = choice.finish_reason != null ? mapFinishReason(choice.finish_reason) : undefined;
    if (!delta && !finishReason) return null;
    return finishReason ? { delta, finishReason } : { delta };
  }

  /** One HTTP exchange with deadline + bounded retry on retryable failures. */
  private async send(body: string, callerSignal?: AbortSignal): Promise<Response> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.cfg.maxRetries; attempt++) {
      try {
        return await this.attempt(body, callerSignal);
      } catch (e) {
        lastErr = e;
        const retryable = e instanceof Object && 'retryable' in e && (e as { retryable: boolean }).retryable;
        if (!retryable || attempt === this.cfg.maxRetries) throw e;
        await this.sleep(this.cfg.retryBaseMs * 2 ** attempt);
      }
    }
    throw lastErr; // unreachable, but keeps the type checker honest
  }

  private async attempt(body: string, callerSignal?: AbortSignal): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.cfg.timeoutMs);
    const onCallerAbort = () => controller.abort();
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true });

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.cfg.apiKey ? { authorization: `Bearer ${this.cfg.apiKey}` } : {}),
          ...this.cfg.headers,
        },
        body,
        signal: controller.signal,
      });
    } catch (e) {
      if (timedOut) throw new ModelTimeoutError(this.cfg.timeoutMs);
      if (callerSignal?.aborted) throw e; // caller cancelled — propagate, don't wrap/retry
      throw new ModelTransportError(e);
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }

    if (res.ok) return res;
    return this.classifyError(res); // always throws (Promise<never>)
  }

  /** Map a non-2xx response to a typed error. Always throws. */
  private async classifyError(res: Response): Promise<never> {
    if (res.status === 401 || res.status === 403) throw new ModelAuthError(res.status);
    if (res.status === 429) throw new ModelRateLimitError(res.status);
    if (res.status >= 500) throw new ModelUnavailableError(res.status);
    const text = await res.text().catch(() => '');
    throw new ModelRequestError(res.status, text);
  }
}
