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
 *     for await (const ev of lumey.runs.events(task.id, run.id)) console.log(ev.type);
 *   }
 *
 * This file is the library's public API surface; its re-exports have no in-repo
 * consumer by design (they're for external integrators), hence the ts-prune
 * directives below.
 */
// ts-prune-ignore-next
export { LumeyClient, type LumeyClientConfig } from './client';
// ts-prune-ignore-next
export { HttpTransport, MockTransport, type Transport, type HttpTransportConfig, type RequestOptions, type HttpMethod } from './transport';
// ts-prune-ignore-next
export { LumeyError, LumeyConnectionError, LumeyAuthError, LumeyUnavailableError, LumeyContractError, BudgetExceededError, ApprovalRequiredError, ClarificationPendingError, errorFromResponse, type LumeyErrorContext } from './errors';
// ts-prune-ignore-next
export { RunStatusSchema, RunStepTypeSchema, TaskRefSchema, AgentRunSummarySchema, RunStepSchema, RunEventSchema, AgentRunDetailSchema, CONTRACT, type RunStatus, type RunStepType, type TaskRef, type AgentRunSummary, type RunStep, type RunEvent, type AgentRunDetail } from './contract/schemas';
// ts-prune-ignore-next
export { toJsonSchema, contractJsonSchema } from './contract/jsonSchema';
// ts-prune-ignore-next
export { estimateCostUsd, type ModelPricing, type RunUsage } from './usage';
