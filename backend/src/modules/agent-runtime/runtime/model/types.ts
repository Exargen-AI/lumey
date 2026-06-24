/**
 * The ModelClient contract — the only place the in-house runtime touches an
 * inference backend. One method does the work: `complete(req) → ModelResponse`,
 * with `stream(req)` for token-by-token UI rendering.
 *
 * Deliberately model-agnostic: nothing here names a model family or a vendor.
 * A model is a *dependency* (config: a URL + a model id); the runtime is ours.
 * The wire format we speak is the OpenAI-compatible chat-completions shape that
 * local servers (vLLM, Ollama, llama.cpp) and frontier gateways all expose — so
 * one client serves both `LocalModelClient` and `FrontierModelClient`.
 */

/** Conversation roles, following the OpenAI-compatible chat wire format. */
export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  readonly role: ChatRole;
  /** Text content. Empty string is valid (e.g. an assistant turn that is purely tool calls). */
  readonly content: string;
  /** Present on assistant messages that invoked tools. */
  readonly toolCalls?: readonly ModelToolCall[];
  /** Present on `tool` messages — the id of the call this result answers. */
  readonly toolCallId?: string;
  /** Optional name (the tool's name on `tool` messages). */
  readonly name?: string;
}

/**
 * A tool the model may call. `parameters` is a JSON-Schema object; the runtime
 * (ToolRunner, M2.5) owns validating the model's arguments against it. The
 * schema is runtime-neutral — no vendor wrapper leaks through this type.
 */
export interface ToolSchema {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}

/**
 * A tool call the model emitted. `arguments` is the raw JSON string exactly as
 * the model produced it — parsing + schema validation is ToolRunner's job, not
 * the transport's, so a malformed call is a guardrail decision, not a parse crash.
 */
export interface ModelToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
}

/** Why the model stopped. Mapped from the backend's `finish_reason`. */
export type FinishReason = 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'unknown';

export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export interface CompletionRequest {
  readonly messages: readonly ChatMessage[];
  /** Tools the model may call this turn. */
  readonly tools?: readonly ToolSchema[];
  /** Force / forbid / free-choice tool use. Default backend behaviour when omitted. */
  readonly toolChoice?: 'auto' | 'none' | 'required';
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly stop?: readonly string[];
  /** Cooperative cancellation — wired to the run's cancel path by the LoopController (M2.7). */
  readonly signal?: AbortSignal;
}

export interface ModelResponse {
  /** Assistant text; may be empty when the turn is purely tool calls. */
  readonly content: string;
  readonly toolCalls: readonly ModelToolCall[];
  readonly finishReason: FinishReason;
  readonly usage: TokenUsage;
  /** The model the backend reports it actually served. */
  readonly model: string;
}

/** One incremental slice of a streamed completion. */
export interface ModelStreamChunk {
  /** Incremental assistant text for this chunk (may be empty). */
  readonly delta: string;
  /** Set on the terminal chunk. */
  readonly finishReason?: FinishReason;
}

export interface ModelClient {
  /** The model id this client is configured to request. */
  readonly model: string;
  /** A full, buffered completion — the path the agentic loop uses for tool-calling turns. */
  complete(req: CompletionRequest): Promise<ModelResponse>;
  /** Token-by-token streaming — for live UI rendering of assistant text. */
  stream(req: CompletionRequest): AsyncIterable<ModelStreamChunk>;
}
