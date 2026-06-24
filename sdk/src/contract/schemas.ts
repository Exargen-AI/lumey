/**
 * The contract — the single source of truth for the Lumey Platform SDK. Every
 * wire type the SDK reads or writes is a `zod` schema here; the TypeScript types
 * are *inferred* from the schemas (never hand-written), and the Python client is
 * generated from the JSON-Schema these produce (`jsonSchema.ts`). One source,
 * two clients, zero drift.
 *
 * The schemas are deliberately **runtime-neutral** — they describe the platform
 * contract, not any agent runtime. The same client serves our `native` runtime,
 * a third-party agent, or a human tool.
 */
import { z } from 'zod';

export const RunStatusSchema = z.enum([
  'QUEUED',
  'RUNNING',
  'AWAITING_REVIEW',
  'AWAITING_INPUT',
  'BLOCKED',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunStepTypeSchema = z.enum(['PLAN', 'TOOL_CALL', 'EDIT', 'COMMAND', 'TEST', 'REVIEW_REQUEST']);
export type RunStepType = z.infer<typeof RunStepTypeSchema>;

/** A task the agent can pick up. Permissive — the platform may add fields. */
export const TaskRefSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    status: z.string(),
    projectId: z.string().optional(),
    agentPoolRole: z.string().nullable().optional(),
  })
  .passthrough();
export type TaskRef = z.infer<typeof TaskRefSchema>;

export const AgentRunSummarySchema = z.object({
  id: z.string(),
  taskId: z.string(),
  agentId: z.string(),
  status: RunStatusSchema,
  model: z.string().nullable(),
  summary: z.string().nullable(),
  error: z.string().nullable(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type AgentRunSummary = z.infer<typeof AgentRunSummarySchema>;

export const RunStepSchema = z.object({
  id: z.string(),
  seq: z.number(),
  type: RunStepTypeSchema,
  status: z.string(),
  title: z.string(),
  detail: z.string().nullable(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
});
export type RunStep = z.infer<typeof RunStepSchema>;

export const RunEventSchema = z.object({
  id: z.string(),
  seq: z.number(),
  type: z.string(),
  payload: z.unknown(),
  at: z.string(),
});
export type RunEvent = z.infer<typeof RunEventSchema>;

export const AgentRunDetailSchema = AgentRunSummarySchema.extend({
  steps: z.array(RunStepSchema),
  events: z.array(RunEventSchema),
});
export type AgentRunDetail = z.infer<typeof AgentRunDetailSchema>;

/** The named contract surface — also what `jsonSchema.ts` exports for codegen. */
export const CONTRACT = {
  RunStatus: RunStatusSchema,
  RunStepType: RunStepTypeSchema,
  TaskRef: TaskRefSchema,
  AgentRunSummary: AgentRunSummarySchema,
  RunStep: RunStepSchema,
  RunEvent: RunEventSchema,
  AgentRunDetail: AgentRunDetailSchema,
} as const;
