/**
 * The operations manifest — the canonical list of SDK operations (method, path,
 * params, response shape). It is the second half of the contract: `schemas.ts`
 * describes the *types*, this describes the *operations*. Together they are the
 * single source the Python client is generated from and the TypeScript client
 * is checked against (see `client.drift.test.ts`), so neither client can drift.
 */
import type { CONTRACT } from './schemas';

export type ContractType = keyof typeof CONTRACT;

export type ResponseShape =
  | { readonly kind: 'object'; readonly type: ContractType }
  | { readonly kind: 'array'; readonly type: ContractType }
  | { readonly kind: 'nullable'; readonly type: ContractType }
  | { readonly kind: 'void' };

export interface Operation {
  /** Dotted id, e.g. `runs.start`. */
  readonly id: string;
  /** Resource namespace on the client, e.g. `runs`. */
  readonly resource: string;
  /** Method name on the resource, e.g. `start`. */
  readonly method: string;
  readonly http: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Path template with `{param}` placeholders. */
  readonly path: string;
  /** Path params in order. */
  readonly params: readonly string[];
  /** Writes carry an idempotency key. */
  readonly write: boolean;
  readonly response: ResponseShape;
  readonly summary: string;
}

export const OPERATIONS: readonly Operation[] = [
  {
    id: 'tasks.next',
    resource: 'tasks',
    method: 'next',
    http: 'GET',
    path: '/agents/me/next-task',
    params: [],
    write: false,
    response: { kind: 'nullable', type: 'TaskRef' },
    summary: 'The next ready task for the authenticated agent, or null.',
  },
  {
    id: 'runs.start',
    resource: 'runs',
    method: 'start',
    http: 'POST',
    path: '/tasks/{taskId}/runs',
    params: ['taskId'],
    write: true,
    response: { kind: 'object', type: 'AgentRunSummary' },
    summary: 'Dispatch an agent run against a task.',
  },
  {
    id: 'runs.list',
    resource: 'runs',
    method: 'list',
    http: 'GET',
    path: '/tasks/{taskId}/runs',
    params: ['taskId'],
    write: false,
    response: { kind: 'array', type: 'AgentRunSummary' },
    summary: "The task's runs, newest first.",
  },
  {
    id: 'runs.get',
    resource: 'runs',
    method: 'get',
    http: 'GET',
    path: '/tasks/{taskId}/runs/{runId}',
    params: ['taskId', 'runId'],
    write: false,
    response: { kind: 'object', type: 'AgentRunDetail' },
    summary: 'One run with its steps and trace.',
  },
  {
    id: 'runs.cancel',
    resource: 'runs',
    method: 'cancel',
    http: 'POST',
    path: '/tasks/{taskId}/runs/{runId}/cancel',
    params: ['taskId', 'runId'],
    write: true,
    response: { kind: 'void' },
    summary: 'Cancel an in-flight run.',
  },
] as const;

/** Fill a path template with ordered or named params. */
export function fillPath(path: string, values: Record<string, string>): string {
  return path.replace(/\{(\w+)\}/g, (_, k) => {
    if (!(k in values)) throw new Error(`missing path param: ${k}`);
    return encodeURIComponent(values[k]);
  });
}
