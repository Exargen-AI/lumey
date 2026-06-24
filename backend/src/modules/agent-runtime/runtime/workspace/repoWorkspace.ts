/**
 * Workspace clone cache — give each run a fresh worktree of the project's repo
 * without re-cloning every time. A bare-ish clone lives once per repo under a
 * cache root; each run fetches the latest and the WorktreeSandbox checks out a
 * detached worktree from `origin/<branch>`. This retires the single-repo
 * `LUMEY_RUN_REPO_PATH` bridge for real project repos.
 *
 * Auth (for private repos) is supplied per-command via `http.extraheader`, so a
 * token is used at clone/fetch time but **never persisted** into the clone's
 * `.git/config` (the origin URL stays tokenless). The token is redacted from any
 * surfaced git output.
 */
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

export interface GitExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

export interface EnsureCloneInput {
  /** Tokenless remote URL, or a local path/file:// (tests). */
  readonly remoteUrl: string;
  /** Cache identity, e.g. `owner/repo`. */
  readonly cacheKey: string;
  /** Cache root dir. Default `<tmp>/lumey-repos`. */
  readonly cacheRoot?: string;
  /** `Authorization: Bearer <token>`-style header, passed via -c http.extraheader (not persisted). */
  readonly authHeader?: string;
  /** Injectable git runner (tests). */
  readonly exec?: (command: string, args: string[]) => Promise<GitExecResult>;
}

function defaultGitExec(command: string, args: string[]): Promise<GitExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
    child.stderr?.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, exitCode: code }));
  });
}

/** Restrict a cache key to safe path segments (no traversal). */
function safeSegments(key: string): string[] {
  return key
    .split('/')
    .map((s) => s.replace(/[^a-zA-Z0-9._-]/g, '_'))
    .filter((s) => s && s !== '.' && s !== '..');
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

function withAuth(authHeader: string | undefined, args: string[]): string[] {
  return authHeader ? ['-c', `http.extraheader=${authHeader}`, ...args] : args;
}

/**
 * Ensure a current local clone of the repo exists in the cache; return its path.
 * Clones if absent, fetches if present. The returned path is suitable for
 * `WorktreeSandbox.create({ repoPath, ref: 'origin/<branch>' })`.
 */
export async function ensureRepoClone(input: EnsureCloneInput): Promise<string> {
  const exec = input.exec ?? defaultGitExec;
  const cacheRoot = input.cacheRoot ?? path.join(os.tmpdir(), 'lumey-repos');
  const segments = safeSegments(input.cacheKey);
  if (segments.length === 0) throw new Error('ensureRepoClone: invalid cacheKey');
  const dir = path.join(cacheRoot, ...segments);
  const redact = (s: string): string => (input.authHeader ? s.split(input.authHeader).join('***') : s);

  if (await pathExists(path.join(dir, '.git'))) {
    const r = await exec('git', withAuth(input.authHeader, ['-C', dir, 'fetch', '--prune', 'origin']));
    if (r.exitCode !== 0) throw new Error(`git fetch failed: ${redact(r.stderr || r.stdout)}`);
    return dir;
  }

  await fs.mkdir(path.dirname(dir), { recursive: true });
  const r = await exec('git', withAuth(input.authHeader, ['clone', input.remoteUrl, dir]));
  if (r.exitCode !== 0) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    throw new Error(`git clone failed: ${redact(r.stderr || r.stdout)}`);
  }
  return dir;
}
