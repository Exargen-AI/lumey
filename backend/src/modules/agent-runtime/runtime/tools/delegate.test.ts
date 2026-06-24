import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { createDelegateTool } from './delegate';
import { ToolRunner } from './toolRunner';
import { defaultTools } from './builtins';
import { WorktreeSandbox } from '../sandbox/worktreeSandbox';
import type { ModelClient, ModelResponse, ModelToolCall } from '../model/types';
import type { ToolContext } from './types';

const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 5 };
const say = (content: string): ModelResponse => ({ content, toolCalls: [], finishReason: 'stop', usage, model: 'mock' });
const callTool = (id: string, name: string, args: string): ModelResponse => {
  const calls: ModelToolCall[] = [{ id, name, arguments: args }];
  return { content: '', toolCalls: calls, finishReason: 'tool_calls', usage, model: 'mock' };
};

/** A model that plays a fixed script (repeating the last response). */
class ScriptedModel implements ModelClient {
  readonly model = 'mock';
  private i = 0;
  constructor(private readonly script: ModelResponse[]) {}
  async complete(): Promise<ModelResponse> {
    return this.script[Math.min(this.i++, this.script.length - 1)];
  }
  async *stream(): AsyncIterable<never> {
    throw new Error('unused');
  }
}

let dir: string;
let ctx: ToolContext;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lumey-delegate-'));
  ctx = { sandbox: WorktreeSandbox.forDir(dir, { owned: true }) };
});
afterEach(async () => {
  await ctx.sandbox.dispose();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('delegate (multi-agent worker)', () => {
  it('runs a worker that operates on the SHARED workspace and reports back', async () => {
    const model = new ScriptedModel([
      callTool('w', 'write_file', '{"path":"sub.txt","content":"from worker"}'),
      say('Created sub.txt as requested.'),
    ]);
    const tool = createDelegateTool({ model, makeSubTools: () => new ToolRunner(defaultTools()) });

    const out = await tool.handler({ objective: 'create sub.txt' }, ctx);

    // the worker's edit landed in the lead's sandbox (coordination via filesystem)
    expect(await ctx.sandbox.readFile('sub.txt')).toBe('from worker');
    expect(out.content).toContain('Created sub.txt');
    expect((out.data as { status: string }).status).toBe('AWAITING_REVIEW');
  });

  it('gives workers no `delegate` tool (depth-1, no recursion)', () => {
    const model = new ScriptedModel([say('done')]);
    let captured: ToolRunner | undefined;
    const tool = createDelegateTool({
      model,
      makeSubTools: () => {
        captured = new ToolRunner(defaultTools());
        return captured;
      },
    });
    // building a worker toolset must never expose `delegate`
    return tool.handler({ objective: 'noop' }, ctx).then(() => {
      expect(captured?.has('delegate')).toBe(false);
      expect(captured?.has('open_pr')).toBe(false); // nor the finalize tools
      expect(captured?.has('read_file')).toBe(true); // but the coding tools, yes
    });
  });

  it('bounds the worker with a small step budget', async () => {
    // a worker that never stops calling a tool stops at the budget, not forever
    const model = new ScriptedModel([callTool('c', 'list_dir', '{}')]);
    const tool = createDelegateTool({ model, makeSubTools: () => new ToolRunner(defaultTools()), budget: { maxSteps: 3 } });
    const out = await tool.handler({ objective: 'loop forever' }, ctx);
    expect((out.data as { turns: number }).turns).toBe(3);
  });
});
