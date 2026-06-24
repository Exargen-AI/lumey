import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { z } from 'zod';
import { WorktreeSandbox } from '../sandbox/worktreeSandbox';
import { ToolRunner } from './toolRunner';
import { readFileTool, writeFileTool } from './builtins';
import type { ToolContext, ToolDefinition } from './types';

const boomTool: ToolDefinition<Record<string, never>> = {
  name: 'boom',
  description: 'always fails',
  mutates: false,
  schema: z.object({}),
  handler: async () => {
    throw new Error('kaboom');
  },
};

let dir: string;
let ctx: ToolContext;
let runner: ToolRunner;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lumey-runner-'));
  ctx = { sandbox: WorktreeSandbox.forDir(dir, { owned: true }) };
  runner = new ToolRunner([readFileTool, writeFileTool, boomTool]);
});
afterEach(async () => {
  await ctx.sandbox.dispose();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('ToolRunner', () => {
  it('rejects duplicate tool names at construction', () => {
    expect(() => new ToolRunner([readFileTool, readFileTool])).toThrow(/duplicate/);
  });

  it('advertises the registered tools to the model', () => {
    expect(runner.list().map((t) => t.name).sort()).toEqual(['boom', 'read_file', 'write_file']);
    expect(runner.has('read_file')).toBe(true);
  });

  it('runs a tool successfully', async () => {
    await ctx.sandbox.writeFile('x.txt', 'data');
    const res = await runner.run({ id: 'c1', name: 'read_file', arguments: '{"path":"x.txt"}' }, ctx);
    expect(res).toMatchObject({ callId: 'c1', name: 'read_file', ok: true, content: 'data' });
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns ok:false for an unknown tool', async () => {
    const res = await runner.run({ id: 'c2', name: 'nope', arguments: '{}' }, ctx);
    expect(res.ok).toBe(false);
    expect(res.content).toMatch(/unknown tool/);
  });

  it('returns ok:false for malformed JSON arguments', async () => {
    const res = await runner.run({ id: 'c3', name: 'read_file', arguments: '{not json' }, ctx);
    expect(res.ok).toBe(false);
    expect(res.content).toMatch(/invalid JSON/);
  });

  it('returns ok:false for arguments that fail schema validation', async () => {
    const res = await runner.run({ id: 'c4', name: 'read_file', arguments: '{}' }, ctx);
    expect(res.ok).toBe(false);
    expect(res.content).toMatch(/invalid arguments/);
  });

  it('converts a handler throw into an ok:false result, not a crash', async () => {
    const res = await runner.run({ id: 'c5', name: 'boom', arguments: '{}' }, ctx);
    expect(res.ok).toBe(false);
    expect(res.content).toBe('kaboom');
  });

  it('short-circuits when the run is already cancelled', async () => {
    const ac = new AbortController();
    ac.abort();
    const res = await runner.run({ id: 'c6', name: 'read_file', arguments: '{"path":"x"}' }, { ...ctx, signal: ac.signal });
    expect(res.ok).toBe(false);
    expect(res.content).toMatch(/cancelled/);
  });

  it('runs a batch in order', async () => {
    const results = await runner.runAll(
      [
        { id: 'a', name: 'write_file', arguments: '{"path":"b.txt","content":"hi"}' },
        { id: 'b', name: 'read_file', arguments: '{"path":"b.txt"}' },
      ],
      ctx,
    );
    expect(results.map((r) => r.callId)).toEqual(['a', 'b']);
    expect(results[1].content).toBe('hi');
  });
});
