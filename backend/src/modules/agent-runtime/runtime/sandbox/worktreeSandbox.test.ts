import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { WorktreeSandbox } from './worktreeSandbox';
import { SandboxPathError } from './sandbox';

const NODE = process.execPath;

function git(cwd: string, args: string[]): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const c = spawn('git', args, { cwd, stdio: 'ignore' });
    c.on('error', reject);
    c.on('close', resolve);
  });
}

describe('WorktreeSandbox (plain dir)', () => {
  let dir: string;
  let sb: WorktreeSandbox;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lumey-sb-'));
    sb = WorktreeSandbox.forDir(dir, { owned: true });
  });
  afterEach(async () => {
    await sb.dispose();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('writes and reads files, creating parent dirs', async () => {
    await sb.writeFile('src/deep/a.txt', 'hello');
    expect(await sb.readFile('src/deep/a.txt')).toBe('hello');
  });

  it('lists directory entries', async () => {
    await sb.writeFile('a.txt', '1');
    await sb.writeFile('b.txt', '2');
    expect((await sb.list('.')).sort()).toEqual(['a.txt', 'b.txt']);
  });

  it('blocks path traversal and absolute paths', () => {
    expect(() => sb.resolve('../escape')).toThrow(SandboxPathError);
    expect(() => sb.resolve('/etc/passwd')).toThrow(SandboxPathError);
    expect(() => sb.resolve('a/../../b')).toThrow(SandboxPathError);
  });

  it('runs a process and captures stdout + exit code', async () => {
    const res = await sb.exec(NODE, ['-e', "process.stdout.write('hi')"]);
    expect(res.stdout).toBe('hi');
    expect(res.exitCode).toBe(0);
    expect(res.timedOut).toBe(false);
  });

  it('reports a non-zero exit without throwing', async () => {
    const res = await sb.exec(NODE, ['-e', 'process.exit(3)']);
    expect(res.exitCode).toBe(3);
  });

  it('kills a process that exceeds the timeout', async () => {
    const res = await sb.exec(NODE, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 60 });
    expect(res.timedOut).toBe(true);
    expect(res.exitCode).toBeNull();
  });

  it('truncates output past the byte cap', async () => {
    const res = await sb.exec(NODE, ['-e', "process.stdout.write('x'.repeat(5000))"], { maxOutputBytes: 100 });
    expect(res.stdout.length).toBe(100);
    expect(res.truncated).toBe(true);
  });

  it('kills a process when the caller aborts', async () => {
    const ac = new AbortController();
    const p = sb.exec(NODE, ['-e', 'setInterval(()=>{},1000)'], { signal: ac.signal });
    ac.abort();
    const res = await p;
    expect(res.exitCode).toBeNull();
  });
});

describe('WorktreeSandbox (git worktree lifecycle)', () => {
  it('creates a worktree at HEAD and removes it on dispose', async () => {
    const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'lumey-repo-'));
    try {
      await git(repo, ['init', '-q']);
      await git(repo, ['config', 'user.email', 't@t.t']);
      await git(repo, ['config', 'user.name', 'T']);
      await fs.writeFile(path.join(repo, 'README.md'), '# hi\n');
      await git(repo, ['add', '.']);
      await git(repo, ['commit', '-qm', 'init']);

      const sb = await WorktreeSandbox.create({ repoPath: repo });
      expect(await sb.readFile('README.md')).toBe('# hi\n');
      const worktreeRoot = sb.root;
      expect(worktreeRoot).not.toBe(repo);

      await sb.dispose();
      await expect(fs.stat(worktreeRoot)).rejects.toThrow(); // gone
    } finally {
      await fs.rm(repo, { recursive: true, force: true });
    }
  });
});
