import { describe, it, expect } from 'vitest';
import { referenceGitProvider } from './referenceProvider';

describe('referenceGitProvider', () => {
  it('produces a deterministic ref from the branch', async () => {
    const a = await referenceGitProvider.openPullRequest({ branch: 'lumey/run-1', base: 'main', title: 't', body: '' });
    const b = await referenceGitProvider.openPullRequest({ branch: 'lumey/run-1', base: 'main', title: 'x', body: 'y' });
    expect(a).toEqual(b); // same branch → same ref, regardless of title/body
    expect(a.externalId).toMatch(/^local\/sandbox#\d+$/);
    expect(a.url).toContain('lumey.local/pull/');
    expect(a.branch).toBe('lumey/run-1');
    expect(a.number).toBeGreaterThan(0);
  });

  it('differs by branch', async () => {
    const a = await referenceGitProvider.openPullRequest({ branch: 'a', base: 'main', title: '', body: '' });
    const b = await referenceGitProvider.openPullRequest({ branch: 'b', base: 'main', title: '', body: '' });
    expect(a.externalId).not.toBe(b.externalId);
  });
});
