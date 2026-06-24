/**
 * `delegate` — multi-agent via the tool seam (orchestrator-worker / hub-and-spoke).
 * The lead agent calls this to hand a focused sub-objective to a *worker*: a
 * fresh LoopController with its OWN isolated context (just the objective — no
 * inherited transcript, which is what avoids the "context pollution" that wrecks
 * flat-context multi-agent), a tool subset, the SHARED sandbox (workers
 * coordinate through the filesystem), and a small budget. The worker's summary
 * is returned to the lead.
 *
 * Two deliberate guardrails: workers get NO `delegate` tool (depth-1, no
 * recursion) and NO finalize tools (only the lead opens a PR / requests review).
 * Delegation is expensive (it's a whole extra loop), so it's opt-in and bounded.
 */
import { z } from 'zod';
import { LoopController, type LoopBudget } from '../loop/loopController';
import { InMemoryRecorder } from '../loop/inMemoryRecorder';
import { ContextEngine } from '../context/contextEngine';
import type { ModelClient } from '../model/types';
import type { ToolRunner } from './toolRunner';
import type { ModelTool, ToolContext, ToolDefinition, ToolOutput } from './types';

function buildSubAgentPrompt(objective: string, tools: readonly ModelTool[]): string {
  const toolLines = tools.map((t) => `- ${t.name}: ${t.description}`).join('\n') || '- (no tools available)';
  return [
    'You are a sub-agent: a lead agent delegated you one focused objective. Complete ONLY this objective in the shared workspace, then stop and report — concisely — what you did and what you found. You are not the lead; do not open PRs or request review.',
    '',
    '## Objective',
    objective,
    '',
    '## Tools',
    toolLines,
    '',
    '## Rules',
    '- Stay inside the workspace; make the smallest change that meets the objective.',
    '- Read before you edit; prefer reporting findings over sweeping changes.',
    '- When the objective is met, stop and summarize your result for the lead agent.',
  ].join('\n');
}

export interface DelegateOptions {
  /** The model the worker runs on (same as the lead, by default). */
  readonly model: ModelClient;
  /** Build a FRESH tool set per worker — must NOT include `delegate` (no recursion). */
  readonly makeSubTools: () => ToolRunner;
  /** Worker budget — kept small; delegation is for *focused* subtasks. */
  readonly budget?: LoopBudget;
}

export function createDelegateTool(opts: DelegateOptions): ToolDefinition<{ objective: string }> {
  const budget = opts.budget ?? { maxSteps: 8, maxTokens: 60_000 };
  return {
    name: 'delegate',
    description:
      'Delegate a single, separable sub-objective to a sub-agent that works in the same workspace and reports back (e.g. "investigate how auth is wired", "add unit tests for module X"). Use for work that is genuinely independent; it costs an extra agent loop.',
    mutates: true,
    schema: z.object({ objective: z.string().describe('One self-contained objective for the sub-agent.') }),
    async handler({ objective }, { sandbox, signal }: ToolContext): Promise<ToolOutput> {
      const tools = opts.makeSubTools();
      const context = new ContextEngine(buildSubAgentPrompt(objective, tools.list()));
      const recorder = new InMemoryRecorder();
      const loop = new LoopController({ model: opts.model, tools, context, sandbox, recorder, budget, signal });
      const outcome = await loop.run();
      return {
        content: `Sub-agent (${outcome.status}, ${outcome.turns} turn(s)) for "${objective}":\n${outcome.summary ?? '(no summary)'}`,
        data: { status: outcome.status, turns: outcome.turns, steps: recorder.steps.length, tokens: outcome.tokensUsed },
      };
    },
  };
}
