/**
 * `ask_human` — the agent's escape hatch when it genuinely cannot proceed
 * without a human decision (an ambiguous requirement, a missing credential, a
 * judgement call the acceptance criteria don't settle).
 *
 * It is a **control tool**, not a sandbox action: the {@link LoopController}
 * intercepts a call to it *before* dispatch, opens a clarification request, and
 * parks the run on AWAITING_INPUT until a human answers. The handler below
 * therefore never executes in normal operation — it exists only so the tool is
 * advertised to the model with a typed schema, and it throws if ever reached
 * (which would mean the loop wasn't wired with a clarification gate).
 *
 * Only the lead agent gets this tool. Sub-agents report back to the lead, so
 * they never address a human directly.
 */
import { z } from 'zod';
import type { ToolDefinition, ToolOutput } from './types';

/** The tool name the loop watches for. Single source of truth. */
export const ASK_HUMAN_TOOL = 'ask_human';

export const askHumanTool: ToolDefinition<{ question: string }> = {
  name: ASK_HUMAN_TOOL,
  description:
    'Ask a human a question and PAUSE until they answer. Use ONLY when you are truly blocked on a decision you cannot make from the task, the code, or the acceptance criteria (ambiguous requirement, missing access, a judgement call). Ask one clear, specific question on its own — do not call other tools in the same turn. Prefer making a reasonable decision and proceeding; asking stops the run and waits on a person.',
  mutates: false,
  schema: z.object({
    question: z.string().min(1).describe('A single, specific question for the human, with enough context to answer it.'),
  }),
  async handler(): Promise<ToolOutput> {
    // Unreachable: the loop handles ask_human before dispatch. If we get here,
    // the run wasn't given a clarification gate — fail loudly rather than
    // silently swallow the agent's question.
    throw new Error('ask_human must be handled by the loop (no clarification gate wired)');
  },
};
