import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { WorktreeSandbox } from '../sandbox/worktreeSandbox';
import {
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirTool,
  grepTool,
  createBashTool,
  defaultTools,
} from './builtins';
import type { ToolContext } from './types';

let dir: string;
let ctx: ToolContext;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lumey-tools-'));
  ctx = { sandbox: WorktreeSandbox.forDir(dir, { owned: true }) };
});
afterEach(async () => {
  await ctx.sandbox.dispose();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('read_file / write_file', () => {
  it('writes then reads back', async () => {
    await writeFileTool.handler({ path: 'a.ts', content: 'export const x = 1;' }, ctx);
    const out = await readFileTool.handler({ path: 'a.ts' }, ctx);
    expect(out.content).toBe('export const x = 1;');
  });
});

describe('edit_file', () => {
  beforeEach(async () => {
    await ctx.sandbox.writeFile('f.ts', 'a = 1; b = 1; c = 2;');
  });

  it('replaces a unique substring', async () => {
    await editFileTool.handler({ path: 'f.ts', find: 'c = 2', replace: 'c = 9' }, ctx);
    expect(await ctx.sandbox.readFile('f.ts')).toBe('a = 1; b = 1; c = 9;');
  });

  it('throws when the substring is missing', async () => {
    await expect(editFileTool.handler({ path: 'f.ts', find: 'zzz', replace: 'x' }, ctx)).rejects.toThrow(/not found/);
  });

  it('throws on a non-unique substring unless replaceAll', async () => {
    await expect(editFileTool.handler({ path: 'f.ts', find: '= 1', replace: '= 7' }, ctx)).rejects.toThrow(/not unique/);
    await editFileTool.handler({ path: 'f.ts', find: '= 1', replace: '= 7', replaceAll: true }, ctx);
    expect(await ctx.sandbox.readFile('f.ts')).toBe('a = 7; b = 7; c = 2;');
  });
});

describe('list_dir', () => {
  it('lists entries', async () => {
    await ctx.sandbox.writeFile('one.txt', '');
    await ctx.sandbox.writeFile('two.txt', '');
    const out = await listDirTool.handler({}, ctx);
    expect((out.data as { entries: string[] }).entries.sort()).toEqual(['one.txt', 'two.txt']);
  });
});

describe('grep', () => {
  it('finds matching lines and skips noisy dirs', async () => {
    await ctx.sandbox.writeFile('src/a.ts', 'const TODO = 1;\nconst ok = 2;');
    await ctx.sandbox.writeFile('node_modules/dep/index.js', 'const TODO = 99;');
    const out = await grepTool.handler({ pattern: 'TODO' }, ctx);
    expect(out.content).toContain('src/a.ts:1:');
    expect(out.content).not.toContain('node_modules');
    expect((out.data as { count: number }).count).toBe(1);
  });

  it('throws on an invalid regex', async () => {
    await expect(grepTool.handler({ pattern: '(' }, ctx)).rejects.toThrow(/invalid regex/);
  });
});

describe('bash', () => {
  const bash = createBashTool({ allowedBinaries: ['echo', 'node'] });

  it('runs an allowed command and reports the exit code', async () => {
    const out = await bash.handler({ command: 'echo hello' }, ctx);
    expect(out.content).toContain('exit 0');
    expect(out.content).toContain('hello');
  });

  it('throws when the command is blocked by a guardrail', async () => {
    await expect(bash.handler({ command: 'sudo rm -rf /' }, ctx)).rejects.toThrow(/guardrail|allowlist/);
  });
});

describe('defaultTools', () => {
  it('bundles the six built-in tools', () => {
    expect(defaultTools().map((t) => t.name).sort()).toEqual(
      ['bash', 'edit_file', 'grep', 'list_dir', 'read_file', 'write_file'],
    );
  });
});
