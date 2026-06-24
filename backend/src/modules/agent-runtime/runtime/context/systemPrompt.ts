/**
 * The system prompt — the stable prefix of every turn. It is built once per run
 * from the task context + tool catalog and then never changes, which is exactly
 * what makes prefix caching work: identical leading bytes across turns let the
 * model (and any KV cache) reuse the prompt instead of re-encoding it.
 *
 * Therefore: NOTHING dynamic goes here — no timestamps, no per-turn state, no
 * counters. Per-turn material is appended to the transcript, never folded into
 * this prefix.
 */
import type { Prisma } from '@prisma/client';
import type { RunContext } from '../../runtimeAdapter';
import type { ModelTool } from '../tools/types';

function renderAcceptanceCriteria(raw: Prisma.JsonValue): string {
  if (Array.isArray(raw)) {
    const items = raw
      .map((c) => (typeof c === 'string' ? c : typeof c === 'object' && c && 'text' in c ? String((c as { text: unknown }).text) : JSON.stringify(c)))
      .filter(Boolean);
    return items.length ? items.map((c) => `- ${c}`).join('\n') : '(none specified)';
  }
  if (raw == null) return '(none specified)';
  return `- ${typeof raw === 'string' ? raw : JSON.stringify(raw)}`;
}

export interface SystemPromptOptions {
  /** Override the agent role/identity line. */
  readonly persona?: string;
}

const DEFAULT_PERSONA =
  'You are Lumey, an autonomous software engineer. You complete a single task by reading the workspace, making minimal correct changes through tools, verifying with tests, and then requesting human review.';

export function buildSystemPrompt(ctx: RunContext, tools: readonly ModelTool[], opts: SystemPromptOptions = {}): string {
  const toolLines = tools.map((t) => `- ${t.name}: ${t.description}`).join('\n') || '- (no tools available)';
  const lines: string[] = [opts.persona ?? DEFAULT_PERSONA, '', '## Task', ctx.task.title];
  if (ctx.task.description?.trim()) lines.push('', ctx.task.description.trim());
  lines.push(
    '',
    '## Acceptance criteria',
    renderAcceptanceCriteria(ctx.task.acceptanceCriteria),
    '',
    '## Tools',
    'Call tools to act on the workspace. Available tools:',
    toolLines,
    '',
    '## Operating rules',
    '- Stay inside the workspace; never touch paths outside it.',
    '- Make the smallest change that satisfies the acceptance criteria.',
    '- Read before you edit; verify with tests before requesting review.',
    '- If the task is ambiguous or blocked, ask for clarification rather than guessing.',
    '- When the work is complete and verified, stop and request human review.',
  );
  return lines.join('\n');
}
