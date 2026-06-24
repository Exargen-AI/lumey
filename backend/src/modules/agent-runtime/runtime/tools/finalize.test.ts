import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { WorktreeSandbox } from '../sandbox/worktreeSandbox';
import { createRunTestsTool, createGitCommitTool } from './finalize';
import type { ToolContext } from './types';

const NODE = process.execPath;

function git(cwd: string, args: string[]): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const c = spawn('git', args, { cwd, stdio: 'ignore' });
    c.on('error', reject);
    c.on('close', resolve);
  });
}

describe('run_tests', () => {
  let dir: string;
  let ctx: ToolContext;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lumey-rt-'));
    ctx = { sandbox: WorktreeSandbox.forDir(dir, { owned: true }) };
  });
  afterEach(async () => {
    await ctx.sandbox.dispose();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('reports PASS for a zero-exit command', async () => {
    const tool = createRunTestsTool();
    const out = await tool.handler({ command: `${NODE} -e "process.exit(0)"` }, ctx);
    expect(out.content).toContain('PASS');
    expect((out.data as { ok: boolean }).ok).toBe(true);
  });

  it('reports FAIL for a non-zero exit', async () => {
    const tool = createRunTestsTool();
    const out = await tool.handler({ command: `${NODE} -e "process.exit(1)"` }, ctx);
    expect(out.content).toContain('FAIL');
    expect((out.data as { ok: boolean }).ok).toBe(false);
  });

  it('blocks a command that violates the guardrail', async () => {
    const tool = createRunTestsTool();
    await expect(tool.handler({ command: 'sudo rm -rf /' }, ctx)).rejects.toThrow(/guardrail|allowlist/);
  });
});

describe('git_commit', () => {
  let repo: string;
  let ctx: ToolContext;

  beforeEach(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'lumey-gc-'));
    await git(repo, ['init', '-q']);
    await git(repo, ['config', 'user.email', 't@t.t']);
    await git(repo, ['config', 'user.name', 'T']);
    await fs.writeFile(path.join(repo, 'README.md'), '# repo\n');
    await git(repo, ['add', '.']);
    await git(repo, ['commit', '-qm', 'init']);
    ctx = { sandbox: WorktreeSandbox.forDir(repo, { owned: true }) };
  });
  afterEach(async () => {
    await fs.rm(repo, { recursive: true, force: true });
  });

  it('commits changes onto the run branch and returns the sha', async () => {
    await ctx.sandbox.writeFile('feature.ts', 'export const x = 1;');
    const tool = createGitCommitTool({ branch: 'lumey/run-abc' });
    const out = await tool.handler({ message: 'add feature' }, ctx);
    const data = out.data as { ok: boolean; branch: string; sha: string };
    expect(data.ok).toBe(true);
    expect(data.branch).toBe('lumey/run-abc');
    expect(data.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(out.content).toContain('lumey/run-abc');
  });

  it('returns ok:false when there is nothing to commit', async () => {
    const tool = createGitCommitTool({ branch: 'lumey/run-empty' });
    const out = await tool.handler({ message: 'noop' }, ctx);
    expect((out.data as { ok: boolean }).ok).toBe(false);
    expect(out.content).toMatch(/commit failed/);
  });

  it('returns ok:false in a non-git workspace', async () => {
    const plain = await fs.mkdtemp(path.join(os.tmpdir(), 'lumey-nogit-'));
    try {
      const out = await createGitCommitTool({ branch: 'b' }).handler({ message: 'm' }, { sandbox: WorktreeSandbox.forDir(plain, { owned: true }) });
      expect((out.data as { ok: boolean }).ok).toBe(false);
    } finally {
      await fs.rm(plain, { recursive: true, force: true });
    }
  });
});
