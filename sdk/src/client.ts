/**
 * LumeyClient — the typed entry point. Resources mirror the platform surface:
 * pull work (`tasks`), drive runs (`runs`). Each method validates the response
 * against the contract, so an agent gets typed data or a `LumeyContractError`
 * (server/SDK drift) — never a silently-wrong object.
 *
 * Construct it with connection config (builds an `HttpTransport`) or inject a
 * `Transport` directly (a mock, a replay log, a custom edge).
 */
import { z } from 'zod';
import {
  AgentRunDetailSchema,
  AgentRunSummarySchema,
  TaskRefSchema,
  type AgentRunDetail,
  type AgentRunSummary,
  type TaskRef,
} from './contract/schemas';
import { LumeyContractError } from './errors';
import { HttpTransport, type Transport } from './transport';

function parse<T>(schema: z.ZodType<T>, data: unknown, what: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new LumeyContractError(`response did not match the contract for ${what}: ${result.error.issues.map((i) => i.message).join('; ')}`);
  }
  return result.data;
}

/** Pull work from the agent control plane. */
class TasksResource {
  constructor(private readonly t: Transport) {}

  /** The next ready task for the authenticated agent, or `null` if none. */
  async next(opts: { signal?: AbortSignal } = {}): Promise<TaskRef | null> {
    const data = await this.t.request<unknown>('GET', '/agents/me/next-task', { signal: opts.signal });
    if (data == null) return null;
    return parse(TaskRefSchema, data, 'tasks.next');
  }
}

/** Create, observe, and stop agent runs. */
class RunsResource {
  constructor(private readonly t: Transport) {}

  /** Dispatch an agent run against a task. */
  async start(taskId: string, opts: { idempotencyKey?: string; signal?: AbortSignal } = {}): Promise<AgentRunSummary> {
    const data = await this.t.request<unknown>('POST', `/tasks/${taskId}/runs`, { body: {}, idempotencyKey: opts.idempotencyKey, signal: opts.signal });
    return parse(AgentRunSummarySchema, data, 'runs.start');
  }

  /** The task's runs, newest first. */
  async list(taskId: string, opts: { signal?: AbortSignal } = {}): Promise<AgentRunSummary[]> {
    const data = await this.t.request<unknown>('GET', `/tasks/${taskId}/runs`, { signal: opts.signal });
    return parse(z.array(AgentRunSummarySchema), data, 'runs.list');
  }

  /** One run with its steps + trace. */
  async get(taskId: string, runId: string, opts: { signal?: AbortSignal } = {}): Promise<AgentRunDetail> {
    const data = await this.t.request<unknown>('GET', `/tasks/${taskId}/runs/${runId}`, { signal: opts.signal });
    return parse(AgentRunDetailSchema, data, 'runs.get');
  }

  /** Cancel an in-flight run. */
  async cancel(taskId: string, runId: string, opts: { idempotencyKey?: string; signal?: AbortSignal } = {}): Promise<void> {
    await this.t.request<unknown>('POST', `/tasks/${taskId}/runs/${runId}/cancel`, { body: {}, idempotencyKey: opts.idempotencyKey, signal: opts.signal });
  }
}

export interface LumeyClientConfig {
  /** API base, including the version prefix, e.g. `http://localhost:3000/api/v1`. */
  baseUrl: string;
  /** Bearer token for the agent/service account. */
  token: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  /** Origin header for the platform's CSRF guard. Defaults to the API's own origin. */
  origin?: string;
}

export class LumeyClient {
  readonly tasks: TasksResource;
  readonly runs: RunsResource;

  constructor(config: LumeyClientConfig | { transport: Transport }) {
    const transport = 'transport' in config ? config.transport : new HttpTransport(config);
    this.tasks = new TasksResource(transport);
    this.runs = new RunsResource(transport);
  }
}
