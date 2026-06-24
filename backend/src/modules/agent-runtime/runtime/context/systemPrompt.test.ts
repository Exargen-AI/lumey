import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from './systemPrompt';
import type { RunContext } from '../../runtimeAdapter';
import type { ModelTool } from '../tools/types';

const TOOLS: ModelTool[] = [
  { name: 'read_file', description: 'Read a file', parameters: {} },
  { name: 'bash', description: 'Run a command', parameters: {} },
];

function ctx(over: Partial<RunContext['task']> = {}): RunContext {
  return {
    runId: 'r1',
    taskId: 't1',
    agentId: 'a1',
    task: { title: 'Add a logout button', description: 'Top-right of the navbar', acceptanceCriteria: ['Given a user, when they click logout, then the session ends'], ...over },
  };
}

describe('buildSystemPrompt', () => {
  it('includes the task, criteria, tools, and operating rules', () => {
    const p = buildSystemPrompt(ctx(), TOOLS);
    expect(p).toContain('Add a logout button');
    expect(p).toContain('Top-right of the navbar');
    expect(p).toContain('Given a user, when they click logout');
    expect(p).toContain('- read_file: Read a file');
    expect(p).toContain('- bash: Run a command');
    expect(p).toContain('request human review');
  });

  it('is byte-stable across calls (prefix-cache friendly)', () => {
    expect(buildSystemPrompt(ctx(), TOOLS)).toBe(buildSystemPrompt(ctx(), TOOLS));
  });

  it('renders object-shaped and missing criteria defensively', () => {
    expect(buildSystemPrompt(ctx({ acceptanceCriteria: [{ text: 'crit-A' }] }), TOOLS)).toContain('- crit-A');
    expect(buildSystemPrompt(ctx({ acceptanceCriteria: null }), TOOLS)).toContain('(none specified)');
  });

  it('omits the description block when there is no description', () => {
    const p = buildSystemPrompt(ctx({ description: null }), TOOLS);
    expect(p).toContain('## Task');
    expect(p).not.toContain('Top-right of the navbar');
  });

  it('handles an empty tool catalog', () => {
    expect(buildSystemPrompt(ctx(), [])).toContain('(no tools available)');
  });
});
