import { describe, it, expect, vi } from 'vitest';
import { createGitHubProvider, type GitHubExecResult } from './githubProvider';

const okExec = vi.fn(async (): Promise<GitHubExecResult> => ({ stdout: '', stderr: '', exitCode: 0 }));

function fakeFetch(status: number, body: unknown) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return Object.assign(fn, { calls });
}

const INPUT = { branch: 'lumey/run-1', base: 'main', title: 'Add feature', body: 'done' };

describe('createGitHubProvider', () => {
  it('pushes the branch and opens a PR, mapping the response to a neutral ref', async () => {
    const exec = vi.fn(async (): Promise<GitHubExecResult> => ({ stdout: '', stderr: '', exitCode: 0 }));
    const f = fakeFetch(201, { number: 42, html_url: 'https://github.com/o/r/pull/42' });
    const provider = createGitHubProvider({ exec, token: 'ghtok', owner: 'o', repo: 'r', fetchImpl: f });

    const ref = await provider.openPullRequest(INPUT);

    expect(ref).toEqual({ externalId: 'o/r#42', url: 'https://github.com/o/r/pull/42', number: 42, branch: 'lumey/run-1' });
    // pushed the branch with an authenticated remote
    expect(exec).toHaveBeenCalledWith('git', ['push', expect.stringContaining('x-access-token:ghtok@github.com/o/r.git'), 'lumey/run-1:lumey/run-1']);
    // called the pulls API with the right body
    expect(f.calls[0].url).toBe('https://api.github.com/repos/o/r/pulls');
    const sent = JSON.parse(f.calls[0].init.body as string);
    expect(sent).toMatchObject({ title: 'Add feature', head: 'lumey/run-1', base: 'main', body: 'done' });
    expect((f.calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer ghtok');
  });

  it('throws (with the token redacted) when the push fails', async () => {
    const exec = vi.fn(async (): Promise<GitHubExecResult> => ({ stdout: '', stderr: 'fatal: https://x-access-token:ghtok@github.com/o/r.git denied', exitCode: 128 }));
    const provider = createGitHubProvider({ exec, token: 'ghtok', owner: 'o', repo: 'r', fetchImpl: fakeFetch(201, {}) });
    const err = await provider.openPullRequest(INPUT).then(
      () => null,
      (e: Error) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toMatch(/git push failed/);
    expect(err!.message).not.toContain('ghtok'); // token redacted
  });

  it('surfaces a GitHub API error (e.g. PR already exists)', async () => {
    const provider = createGitHubProvider({ exec: okExec, token: 't', owner: 'o', repo: 'r', fetchImpl: fakeFetch(422, 'A pull request already exists') });
    await expect(provider.openPullRequest(INPUT)).rejects.toThrow(/GitHub PR create failed \(422\)/);
  });

  it('requires a token, owner, and repo', () => {
    expect(() => createGitHubProvider({ exec: okExec, token: '', owner: 'o', repo: 'r' })).toThrow(/token/);
    expect(() => createGitHubProvider({ exec: okExec, token: 't', owner: '', repo: 'r' })).toThrow(/owner and repo/);
  });
});
