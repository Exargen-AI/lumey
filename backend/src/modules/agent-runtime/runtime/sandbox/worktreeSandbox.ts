/**
 * WorktreeSandbox — the local-dev Sandbox: a git worktree (or a plain temp dir)
 * with path-guarded fs and bounded, shell-free exec.
 *
 * A git worktree gives each run its own checkout of the repo at a ref, sharing
 * the object store but isolated on disk — cheap to create, cheap to throw away.
 * For non-git workspaces and tests, `forDir` wraps a plain directory with the
 * same guarantees.
 *
 * Isolation here is *process + path* level (good enough for trusted local dev).
 * Untrusted execution must move to a container sandbox (dropped caps, read-only
 * rootfs, controlled egress) — same `Sandbox` contract, stronger boundary.
 */
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  type ExecOptions,
  type ExecResult,
  type Sandbox,
  SandboxPathError,
} from './sandbox';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT = 1_000_000;

export interface WorktreeSandboxOptions {
  /** The repo to attach the worktree to (required for `create`). */
  readonly repoPath?: string;
  /** Whether `dispose` should `git worktree remove` (we created a worktree). */
  readonly isWorktree?: boolean;
  /** Whether `dispose` may delete `root` (we created the directory). */
  readonly owned?: boolean;
}

export class WorktreeSandbox implements Sandbox {
  readonly root: string;
  private readonly repoPath?: string;
  private readonly isWorktree: boolean;
  private readonly owned: boolean;
  private disposed = false;

  constructor(root: string, opts: WorktreeSandboxOptions = {}) {
    this.root = path.resolve(root);
    this.repoPath = opts.repoPath;
    this.isWorktree = opts.isWorktree ?? false;
    this.owned = opts.owned ?? false;
  }

  /** Add a detached git worktree for `ref` under a fresh temp dir and wrap it. */
  static async create(opts: { repoPath: string; ref?: string; baseDir?: string }): Promise<WorktreeSandbox> {
    const base = opts.baseDir ?? path.join(os.tmpdir(), 'lumey-sandboxes');
    await fs.mkdir(base, { recursive: true });
    const dir = await fs.mkdtemp(path.join(base, 'run-'));
    const ref = opts.ref ?? 'HEAD';
    const res = await runGit(opts.repoPath, ['worktree', 'add', '--detach', dir, ref]);
    if (res.exitCode !== 0) {
      await fs.rm(dir, { recursive: true, force: true });
      throw new Error(`git worktree add failed: ${res.stderr.trim() || res.stdout.trim()}`);
    }
    return new WorktreeSandbox(dir, { repoPath: opts.repoPath, isWorktree: true, owned: true });
  }

  /** Wrap an existing plain directory (no git) with the same guarantees. */
  static forDir(dir: string, opts: { owned?: boolean } = {}): WorktreeSandbox {
    return new WorktreeSandbox(dir, { owned: opts.owned ?? false });
  }

  resolve(relPath: string): string {
    const abs = path.resolve(this.root, relPath);
    const rel = path.relative(this.root, abs);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      throw new SandboxPathError(relPath);
    }
    return abs;
  }

  async readFile(relPath: string): Promise<string> {
    return fs.readFile(this.resolve(relPath), 'utf8');
  }

  async writeFile(relPath: string, content: string): Promise<void> {
    const abs = this.resolve(relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
  }

  async list(relDir: string): Promise<string[]> {
    return fs.readdir(this.resolve(relDir || '.'));
  }

  exec(command: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
    const cwd = opts.cwd ? this.resolve(opts.cwd) : this.root;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxBytes = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;

    return new Promise<ExecResult>((resolve, reject) => {
      const child = spawn(command, args, { cwd, shell: false });
      let stdout = '';
      let stderr = '';
      let truncated = false;
      let timedOut = false;
      let settled = false;

      const cap = (buf: string, chunk: Buffer): string => {
        if (buf.length >= maxBytes) {
          truncated = true;
          return buf;
        }
        const next = buf + chunk.toString('utf8');
        if (next.length > maxBytes) {
          truncated = true;
          return next.slice(0, maxBytes);
        }
        return next;
      };

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);

      const onAbort = () => child.kill('SIGKILL');
      opts.signal?.addEventListener('abort', onAbort, { once: true });

      const cleanup = () => {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
      };

      child.stdout?.on('data', (c: Buffer) => {
        stdout = cap(stdout, c);
      });
      child.stderr?.on('data', (c: Buffer) => {
        stderr = cap(stderr, c);
      });
      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ stdout, stderr, exitCode: timedOut ? null : code, timedOut, truncated });
      });
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.isWorktree && this.repoPath) {
      await runGit(this.repoPath, ['worktree', 'remove', '--force', this.root]).catch(() => undefined);
    } else if (this.owned) {
      await fs.rm(this.root, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

function runGit(repoPath: string, args: string[]): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', repoPath, ...args], { shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
    child.stderr?.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) =>
      resolve({ stdout, stderr, exitCode: code, timedOut: false, truncated: false }),
    );
  });
}
