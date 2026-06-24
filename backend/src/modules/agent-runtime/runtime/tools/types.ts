/**
 * Tool contracts. A tool is the only way the agent acts on the world — every
 * action it can take is a declared, schema-validated, guardable tool. Promoting
 * an action to a tool is what gives the harness a hook to audit, gate, or
 * parallelize it.
 *
 * A tool's argument schema is a single `zod` type: it both validates the
 * model's arguments and (via `schema.ts`) generates the JSON-Schema we advertise
 * to the model. One source of truth, no drift.
 */
import type { z } from 'zod';
import type { Sandbox } from '../sandbox/sandbox';

/** What a tool handler receives: the sandbox to act in, plus cancellation. */
export interface ToolContext {
  readonly sandbox: Sandbox;
  readonly signal?: AbortSignal;
}

/** A tool's return value — `content` is fed back to the model; `data` is for the trace. */
export interface ToolOutput {
  /** Text the model sees as the tool result. */
  readonly content: string;
  /** Optional structured payload recorded on the run trace. */
  readonly data?: unknown;
}

export interface ToolDefinition<A = unknown> {
  readonly name: string;
  readonly description: string;
  /** Argument schema — validates input AND generates the model-facing JSON-Schema. */
  readonly schema: z.ZodType<A>;
  /** True if the tool can change the workspace (write/edit/bash). Drives guardrails + trace. */
  readonly mutates: boolean;
  handler(args: A, ctx: ToolContext): Promise<ToolOutput>;
}

/** A model-emitted tool call (mirrors `ModelToolCall`). */
export interface ToolCall {
  readonly id: string;
  readonly name: string;
  /** Raw JSON arguments string, exactly as the model produced it. */
  readonly arguments: string;
}

/** The outcome of running one tool call — always produced, never thrown. */
export interface ToolResult {
  readonly callId: string;
  readonly name: string;
  readonly ok: boolean;
  /** Result text (on success) or error message (on failure) — both go to the model. */
  readonly content: string;
  readonly data?: unknown;
  readonly durationMs: number;
}

/** The model-facing advertisement of a tool. */
export interface ModelTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
}
