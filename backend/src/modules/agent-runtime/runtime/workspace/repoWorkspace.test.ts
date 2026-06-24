import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { ensureRepoClone } from './repoWorkspace';

function git(cwd: string, args: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const c = spawn('git', args, { cwd });
    let out = '';
    c.stdout?.on('data', (d) => (out += d.toString()));
    c.on('error', reject);
    c.on('close', (code) => resolve({ code, out }));
  });
}

let origin: string;
let cacheRoot: string;
let branch: string;

beforeEach(async () => {
  origin = await fs.mkdtemp(path.join(os.tmpdir(), 'lumey-origin-'));
  cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lumey-cache-'));
  await git(origin, ['init', '-q']);
  await git(origin, ['config', 'user.email', 't@t.t']);
  await git(origin, ['config', 'user.name', 'T']);
  await fs.writeFile(path.join(origin, 'README.md'), '# origin\n');
  await git(origin, ['add', '.']);
  await git(origin, ['commit', '-qm', 'first']);
  branch = (await git(origin, ['rev-parse', '--abbrev-ref', 'HEAD'])).out.trim();
});
afterEach(async () => {
  await fs.rm(origin, { recursive: true, force: true });
  await fs.rm(cacheRoot, { recursive: true, force: true });
});

describe('ensureRepoClone', () => {
  it('clones the repo into the cache when absent', async () => {
    const dir = await ensureRepoClone({ remoteUrl: origin, cacheKey: 'acme/web', cacheRoot });
    expect(dir).toBe(path.join(cacheRoot, 'acme', 'web'));
    expect(await fs.readFile(path.join(dir, 'README.md'), 'utf8')).toContain('origin');
  });

  it('fetches new commits on an existing clone (idempotent path)', async () => {
    const dir = await ensureRepoClone({ remoteUrl: origin, cacheKey: 'acme/web', cacheRoot });
    await fs.writeFile(path.join(origin, 'feature.md'), 'x');
    await git(origin, ['add', '.']);
    await git(origin, ['commit', '-qm', 'second']);

    const dir2 = await ensureRepoClone({ remoteUrl: origin, cacheKey: 'acme/web', cacheRoot });
    expect(dir2).toBe(dir);
    const log = await git(dir2, ['log', '--oneline', `origin/${branch}`]);
    expect(log.out).toContain('second'); // the fetch pulled the new commit
  });

  it('contains a traversal cacheKey within the cache root', async () => {
    const dir = await ensureRepoClone({ remoteUrl: origin, cacheKey: '../../evil', cacheRoot });
    expect(dir.startsWith(cacheRoot)).toBe(true);
  });

  it('throws (cleaning up) when the remote cannot be cloned', async () => {
    await expect(
      ensureRepoClone({ remoteUrl: path.join(os.tmpdir(), 'lumey-does-not-exist-xyz'), cacheKey: 'no/pe', cacheRoot }),
    ).rejects.toThrow(/clone failed/);
    expect(await fs.stat(path.join(cacheRoot, 'no', 'pe')).then(() => true, () => false)).toBe(false);
  });
});
