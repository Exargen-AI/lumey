/**
 * The Lumey Platform SDK — the typed client agents and integrations use to talk
 * to Lumey. Schema-first (one zod contract → TS types + JSON-Schema for codegen),
 * runtime-neutral, with actionable typed errors and idempotent writes.
 *
 * Quickstart:
 *   const lumey = new LumeyClient({ baseUrl: 'http://localhost:3000/api/v1', token });
 *   const task = await lumey.tasks.next();
 *   if (task) {
 *     const run = await lumey.runs.start(task.id);
 *     const detail = await lumey.runs.get(task.id, run.id);
 *   }
 */
export { LumeyClient, type LumeyClientConfig } from './client';
export { HttpTransport, MockTransport, type Transport, type HttpTransportConfig, type RequestOptions, type HttpMethod } from './transport';
export {
  LumeyError,
  LumeyConnectionError,
  LumeyAuthError,
  LumeyUnavailableError,
  LumeyContractError,
  BudgetExceededError,
  ApprovalRequiredError,
  ClarificationPendingError,
  errorFromResponse,
  type LumeyErrorContext,
} from './errors';
export * from './contract/schemas';
export { toJsonSchema, contractJsonSchema } from './contract/jsonSchema';
