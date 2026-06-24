import { z } from 'zod';
import { registry, ErrorResponse, successEnvelope } from './registry';

/**
 * 2026-05-23 — OpenAPI specs for the Layer 2 / agent control endpoints.
 *
 * Each call to `registry.registerPath(...)` documents one endpoint with
 * its parameters, request body, response shapes, and security
 * requirements. The agent runtime (and any future external agent
 * integration) reads the resulting `/openapi.json` to discover what's
 * callable + how.
 */

/* ─── Shared task schema (used in next-task + knowledge-pack responses) ─── */

const AcceptanceCriterionSchema = z
  .object({
    text: z.string().openapi({ example: 'Tests added + green in CI' }),
    done: z.boolean().openapi({ example: false }),
  })
  .openapi('AcceptanceCriterion', {
    description:
      'One acceptance-criterion item. The Done-gate refuses to mark a task DONE while any AC has `done: false`.',
  });

const NextTaskSchema = z
  .object({
    id: z.string().uuid(),
    taskNumber: z.number().int(),
    title: z.string(),
    description: z.string().nullable(),
    status: z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']),
    priority: z.enum(['P0', 'P1', 'P2', 'P3']),
    projectId: z.string().uuid(),
    projectSlug: z.string(),
    sprintId: z.string().uuid().nullable(),
    dueDate: z.string().datetime().nullable(),
    storyPoints: z.number().int().nullable(),
    acceptanceCriteria: z.array(AcceptanceCriterionSchema).openapi({
      description:
        'The Done definition for this task. Agents should read these before starting work — the move to DONE will be refused until every item is checked.',
    }),
    blockingTaskIds: z
      .array(z.string().uuid())
      .openapi({
        description:
          'Tasks that THIS task blocks. When the agent finishes, these become unblocked. Read-only metadata.',
      }),
  })
  .openapi('NextTask');

const NextTaskResultSchema = z
  .object({
    task: NextTaskSchema,
    rationale: z
      .string()
      .openapi({
        example: 'priority P1 · in active sprint · due 2026-05-30',
        description:
          'Short human-readable explanation of why this task was selected over others. Suitable to surface in runtime logs or the agent prompt.',
      }),
  })
  .openapi('NextTaskResult');

/* ─── GET /agents/me/next-task ─── */

registry.registerPath({
  method: 'get',
  path: '/agents/me/next-task',
  description: [
    "Returns the single highest-priority, unblocked, ready-to-work task assigned to the calling agent.",
    '',
    'Selection contract:',
    '1. Task is assigned to the calling agent (`assigneeId === me`).',
    '2. Status is `BACKLOG`, `TODO`, or `IN_PROGRESS` (DONE is finished; IN_REVIEW is human-only).',
    '3. `isBlocked === false` (the team has not flagged the task as gated).',
    '4. All incoming `BLOCKS` dependencies are satisfied (every blocker task is DONE).',
    '5. Sprint preference: tasks in the active sprint outrank same-priority tasks not in the sprint.',
    '6. Priority order: P0 > P1 > P2 > P3.',
    '7. Tiebreak by `dueDate` ascending, then `createdAt` ascending for stability.',
    '',
    'Returns `{ data: null }` when nothing is ready — the runtime should idle / poll later.',
    '',
    'Auth: agent-only. Calling as a human returns 403.',
  ].join('\n'),
  summary: 'Get the agent\'s next task',
  tags: ['Layer 2: Agent control'],
  responses: {
    200: {
      description: 'Next task selected, OR null when nothing is ready.',
      content: {
        'application/json': {
          schema: successEnvelope(NextTaskResultSchema.nullable()),
        },
      },
    },
    403: {
      description: 'Caller is not an agent (`userType !== AGENT`).',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    401: {
      description: 'Missing or invalid Authorization header.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

/* ─── GET /agents/me/knowledge-pack/:projectSlug ─── */

registry.registerPath({
  method: 'get',
  path: '/agents/me/knowledge-pack/{projectSlug}',
  description: [
    'Bundles every piece of project context an agent needs to act on a task into ONE response. Designed for prompt-budget callers — the runtime fetches one response per task instead of hitting 5 endpoints.',
    '',
    'Includes:',
    '- Project identity + phase + health + GitHub integration metadata',
    '- Active project members (with userType so the agent knows who else is an agent)',
    '- Last 30 days of activity, capped at 100 entries',
    '- Active sprint + its tasks (with acceptance criteria so the agent sees what Done looks like)',
    "- The agent's own assigned tasks (ordered by priority + due date)",
    '- 20 most recent decisions',
    '- 50 most recent project documents (metadata only — fetch body separately)',
    '',
    'Auth: agent-only + must be a project member.',
  ].join('\n'),
  summary: 'Knowledge pack for a project',
  tags: ['Layer 2: Agent control'],
  parameters: [
    {
      name: 'projectSlug',
      in: 'path',
      required: true,
      schema: { type: 'string' },
      description: 'The project slug (e.g. `exargen-com`)',
    },
  ],
  responses: {
    200: {
      description: 'Knowledge pack for the project.',
      content: {
        'application/json': {
          schema: successEnvelope(
            z.object({}).passthrough().openapi('AgentKnowledgePack', {
              description:
                'Project context bundle. See agentKnowledgePack.service.ts for the full shape; documenting every field here would duplicate the type definition.',
            }),
          ),
        },
      },
    },
    403: {
      description: 'Caller is not an agent, or is not a project member.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    404: {
      description: 'Project slug not found.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});

/* ─── POST /agents/me/budget-increment ─── */

const BudgetIncrementRequestSchema = z
  .object({
    usdCents: z
      .number()
      .int()
      .nonnegative()
      .max(100_000)
      .openapi({
        example: 250,
        description:
          'Cents spent on this task. Capped at 100,000 ($1000) per single increment to catch runtime bugs.',
      }),
  })
  .openapi('BudgetIncrementRequest');

const BudgetIncrementResponseSchema = z
  .object({
    usedUsdCents: z.number().int(),
    monthlyUsdCents: z.number().int().nullable(),
    over: z
      .boolean()
      .openapi({
        description:
          'True when the agent has exceeded its monthly budget. The runtime should use this signal to refuse to spawn the next container.',
      }),
  })
  .openapi('BudgetIncrementResponse');

registry.registerPath({
  method: 'post',
  path: '/agents/me/budget-increment',
  summary: 'Record API spend for a completed task',
  description: [
    "Increments the calling agent's `agentBudgetUsedUsdCents` by the supplied amount. The runtime calls this once per task with the cents spent on the AI provider's API.",
    '',
    "Returns the new totals and an `over: boolean` flag that's true when the agent has exceeded its monthly budget — the runtime should use this signal to refuse next-container spawns.",
    '',
    'Auth: agent-only.',
    '',
    'Idempotency: send `Idempotency-Key` to safely retry. Without it, double-increments are possible on network retry.',
  ].join('\n'),
  tags: ['Layer 2: Agent control'],
  parameters: [{ $ref: '#/components/parameters/IdempotencyKey' }],
  request: {
    body: {
      content: {
        'application/json': { schema: BudgetIncrementRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: 'Budget incremented. Returns the new total + over-flag.',
      content: {
        'application/json': { schema: successEnvelope(BudgetIncrementResponseSchema) },
      },
    },
    400: {
      description: 'usdCents is negative, NaN, or exceeds the 100,000 sanity cap.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
    403: {
      description: 'Caller is not an agent.',
      content: { 'application/json': { schema: ErrorResponse } },
    },
  },
});
